package ws

import (
	"context"
	"encoding/json"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/monitor"
	"github.com/easyssh/server/internal/domain/server"
	pb "github.com/easyssh/server/internal/proto"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"
)

const (
	// 控制帧心跳/超时设置
	wsPongWait  = 60 * time.Second
	wsPingEvery = 50 * time.Second
	wsWriteWait = 10 * time.Second
)

// wsSubscriber WebSocket 订阅者（实现 monitor.MetricsSubscriber 接口）
type wsSubscriber struct {
	id          string
	conn        *websocket.Conn
	writeMu     *sync.Mutex
	serverID    uuid.UUID
	serverRepo  server.Repository
	osPersistMu sync.Mutex
	osPersisted bool
}

func (s *wsSubscriber) ID() string {
	return s.id
}

func (s *wsSubscriber) OnMetrics(metrics *pb.SystemMetrics) {
	s.persistOSIfEmpty(metrics)

	data, err := proto.Marshal(metrics)
	if err != nil {
		log.Printf("[wsSubscriber] 序列化失败: %v", err)
		return
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
	if err := s.conn.WriteMessage(websocket.BinaryMessage, data); err != nil {
		log.Printf("[wsSubscriber] 发送失败: %v", err)
	}
}

func (s *wsSubscriber) persistOSIfEmpty(metrics *pb.SystemMetrics) {
	if s.serverRepo == nil || metrics == nil || metrics.SystemInfo == nil {
		return
	}

	osValue := strings.TrimSpace(metrics.SystemInfo.Os)
	if osValue == "" {
		return
	}

	s.osPersistMu.Lock()
	if s.osPersisted {
		s.osPersistMu.Unlock()
		return
	}
	s.osPersisted = true
	s.osPersistMu.Unlock()

	go func() {
		if err := s.serverRepo.UpdateOSIfEmpty(context.Background(), s.serverID, osValue); err != nil {
			log.Printf("[Monitor] Failed to persist server OS: server_id=%s err=%v", s.serverID, err)
		}
	}()
}

// MonitorHandler WebSocket 监控处理器
type MonitorHandler struct {
	connectionPool   *monitor.ConnectionPool
	serverRepo       server.Repository
	collectorManager *monitor.SharedCollectorManager // 共享采集器管理器
}

// NewMonitorHandler 创建监控处理器
func NewMonitorHandler(connectionPool *monitor.ConnectionPool, serverRepo server.Repository) *MonitorHandler {
	return &MonitorHandler{
		connectionPool:   connectionPool,
		serverRepo:       serverRepo,
		collectorManager: monitor.NewSharedCollectorManager(),
	}
}

// HandleMonitor 处理监控 WebSocket 连接
// WS /api/v1/monitor/server/:server_id?interval=2
func (h *MonitorHandler) HandleMonitor(c *gin.Context) {
	// 从可信作用域获取当前访问主体 ID
	scope, scopeErr := access.FromContext(c.Request.Context())
	exists := scopeErr == nil
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	actorID := scope.Actor().ID

	// 获取服务器 ID
	serverID := c.Param("server_id")
	if serverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server_id required"})
		return
	}
	serverUUID, err := uuid.Parse(serverID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_server_id"})
		return
	}

	lease, leaseErr := access.OpenStream(c.Request.Context(), access.Requirement{Action: protocol.MonitorRead, ServerID: serverID})
	if leaseErr != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "access_denied"})
		return
	}
	defer lease.Close(nil)
	c.Request = c.Request.WithContext(lease.Context())

	// 获取采集间隔（秒），默认为 2 秒
	intervalParam := c.DefaultQuery("interval", "2")
	interval, err := time.ParseDuration(intervalParam + "s")
	if err != nil || interval < time.Second || interval > 10*time.Second {
		// 无效间隔，使用默认值 2 秒
		interval = 2 * time.Second
	}
	log.Printf("[Monitor] 使用采集间隔: %v", interval)

	// 立即升级到 WebSocket
	upgrader := ticketUpgrader(c)
	wsConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[Monitor] Failed to upgrade to WebSocket: %v", err)
		return
	}
	defer wsConn.Close()
	wsConn.SetReadLimit(64 << 10)
	stopSocketCancel := context.AfterFunc(lease.Context(), func() { _ = wsConn.Close() })
	defer stopSocketCancel()

	// 发送握手完成消息
	handshakeMsg := map[string]string{"type": "handshake_complete", "status": "connecting"}
	if data, err := json.Marshal(handshakeMsg); err == nil {
		_ = wsConn.SetWriteDeadline(time.Now().Add(wsWriteWait))
		_ = wsConn.WriteMessage(websocket.TextMessage, data)
	}

	pooledConn, err := h.connectionPool.GetOrCreate(c.Request.Context(), serverID, protocol.MonitorRead)
	if err != nil {
		_ = wsConn.SetWriteDeadline(time.Now().Add(wsWriteWait))
		_ = wsConn.WriteJSON(map[string]string{"type": "error", "message": err.Error()})
		return
	}
	_ = wsConn.SetWriteDeadline(time.Now().Add(wsWriteWait))
	_ = wsConn.WriteJSON(map[string]string{"type": "ready"})

	// 确保在函数退出时释放连接
	defer func() {
		h.connectionPool.Release(pooledConn)
		log.Printf("[Monitor] 释放连接: actorID=%s, serverID=%s", actorID, serverID)
	}()

	log.Printf("Monitor WebSocket connected for server: %s, using pooled connection", serverID)

	// 配置 read deadline 与 pong 处理，便于断线检测
	_ = wsConn.SetReadDeadline(time.Now().Add(wsPongWait))
	// 设置读取大小限制，防止异常消息导致内存压力
	wsConn.SetReadLimit(1 << 20) // 1 MiB
	wsConn.SetPongHandler(func(appData string) error {
		return wsConn.SetReadDeadline(time.Now().Add(wsPongWait))
	})

	// 创建停止通道
	done := make(chan struct{})

	// 统一写锁，避免并发写导致报错
	var writeMu sync.Mutex

	// 创建 WebSocket 订阅者并注册到共享采集器
	subID := uuid.New().String()
	subscriber := &wsSubscriber{
		id:         subID,
		conn:       wsConn,
		writeMu:    &writeMu,
		serverID:   serverUUID,
		serverRepo: h.serverRepo,
	}
	// 使用工厂函数延迟创建 Collector，仅在首个订阅者时才实际创建
	collectorKey := string(access.Current(c.Request.Context()).Actor().Kind) + ":" + access.Current(c.Request.Context()).Actor().SessionID + ":" + serverID
	h.collectorManager.GetOrCreate(collectorKey, func() *monitor.Collector {
		return monitor.NewCollector(c.Request.Context(), serverID, pooledConn.Client)
	}, interval, subscriber)

	// 确保退出时取消订阅
	defer func() {
		h.collectorManager.Unsubscribe(collectorKey, subID)
		log.Printf("[Monitor] 取消订阅: serverID=%s, subID=%s", serverID, subID)
	}()

	// 监听客户端消息（处理 ping/close）
	go func() {
		// 通用消息结构
		type wsMsg struct {
			Type string `json:"type"`
			Ts   int64  `json:"ts,omitempty"`
		}

		for {
			msgType, payload, err := wsConn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("Monitor WebSocket error: %v", err)
				}
				close(done)
				return
			}

			// 仅在 TextMessage 时尝试解析
			if msgType == websocket.TextMessage {
				var m wsMsg
				if err := json.Unmarshal(payload, &m); err != nil {
					continue
				}

				switch m.Type {
				case "ping":
					// 处理 ping 消息
					serverRecvTs := time.Now().UnixMilli()
					resp := map[string]any{
						"type":         "pong",
						"ts":           m.Ts,
						"serverRecvTs": serverRecvTs,
					}
					writeMu.Lock()
					_ = wsConn.SetWriteDeadline(time.Now().Add(wsWriteWait))
					resp["serverSendTs"] = time.Now().UnixMilli()
					b, _ := json.Marshal(resp)
					_ = wsConn.WriteMessage(websocket.TextMessage, b)
					writeMu.Unlock()
				}
			}
		}
	}()

	// 定期发送 WS 控制帧 Ping（浏览器自动回 Pong）
	// 注意：数据采集已由共享采集器处理，这里只负责心跳保活
	pingTicker := time.NewTicker(wsPingEvery)
	defer pingTicker.Stop()

	for {
		select {
		case <-pingTicker.C:
			// 发送控制帧 Ping
			writeMu.Lock()
			_ = wsConn.SetWriteDeadline(time.Now().Add(wsWriteWait))
			err := wsConn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second))
			writeMu.Unlock()
			if err != nil {
				log.Printf("Failed to send ws ping: %v", err)
				return
			}

		case <-done:
			log.Printf("Monitor WebSocket closed for server: %s", serverID)
			return
		}
	}
}

// sendErrorMessage 发送错误消息 (JSON 格式)
func (h *MonitorHandler) sendErrorMessage(conn *websocket.Conn, errorCode, message string) {
	errMsg := &pb.SystemMetrics{
		Timestamp: time.Now().Unix(),
		// 可以添加错误字段到 proto 定义中
	}

	data, _ := proto.Marshal(errMsg)
	_ = conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
	conn.WriteMessage(websocket.BinaryMessage, data)

	time.Sleep(100 * time.Millisecond)
	conn.Close()
}
