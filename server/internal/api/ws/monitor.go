package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/domain/monitor"
	"github.com/easyssh/server/internal/domain/security"
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
	securityService  security.Service                // 安全配置服务（用于 CORS）
	webDevPort       int                             // 前端开发端口，用于默认同源白名单
	collectorManager *monitor.SharedCollectorManager // 共享采集器管理器
}

// NewMonitorHandler 创建监控处理器
func NewMonitorHandler(connectionPool *monitor.ConnectionPool, serverRepo server.Repository, securityService security.Service, webDevPort int) *MonitorHandler {
	return &MonitorHandler{
		connectionPool:   connectionPool,
		serverRepo:       serverRepo,
		securityService:  securityService,
		webDevPort:       webDevPort,
		collectorManager: monitor.NewSharedCollectorManager(),
	}
}

// getUpgrader 创建 WebSocket upgrader，集成 CORS 配置
func (h *MonitorHandler) getUpgrader() websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			allowed := middleware.IsAllowedOrigin(r, h.securityService, h.webDevPort)
			if !allowed {
				log.Printf("[Monitor] WebSocket connection rejected: origin %s not allowed (host=%s)", r.Header.Get("Origin"), r.Host)
			}
			return allowed
		},
	}
}

// HandleMonitor 处理监控 WebSocket 连接
// WS /api/v1/monitor/server/:server_id?interval=2
func (h *MonitorHandler) HandleMonitor(c *gin.Context) {
	// 从上下文获取用户 ID
	userIDStr, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID := userIDStr.(string)

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

	// 获取采集间隔（秒），默认为 2 秒
	intervalParam := c.DefaultQuery("interval", "2")
	interval, err := time.ParseDuration(intervalParam + "s")
	if err != nil || interval < time.Second || interval > 10*time.Second {
		// 无效间隔，使用默认值 2 秒
		interval = 2 * time.Second
	}
	log.Printf("[Monitor] 使用采集间隔: %v", interval)

	// 立即升级到 WebSocket
	upgrader := h.getUpgrader()
	wsConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[Monitor] Failed to upgrade to WebSocket: %v", err)
		return
	}
	defer wsConn.Close()

	// 发送握手完成消息
	handshakeMsg := map[string]string{"type": "handshake_complete", "status": "connecting"}
	if data, err := json.Marshal(handshakeMsg); err == nil {
		_ = wsConn.SetWriteDeadline(time.Now().Add(wsWriteWait))
		_ = wsConn.WriteMessage(websocket.TextMessage, data)
	}

	// 异步获取或创建 SSH 连接
	log.Printf("[Monitor] 尝试获取连接: userID=%s, serverID=%s", userID, serverID)
	connChan := make(chan *monitor.PooledConnection, 1)
	errChan := make(chan error, 1)

	go func() {
		pooledConn, err := h.connectionPool.GetOrCreate(userID, serverID)
		if err != nil {
			errChan <- err
			return
		}
		connChan <- pooledConn
	}()

	// 等待连接建立或超时
	var pooledConn *monitor.PooledConnection
	select {
	case pooledConn = <-connChan:
		log.Printf("[Monitor] 成功获取连接: userID=%s, serverID=%s, refCount=%d", userID, serverID, pooledConn.GetRefCount())
		// 发送连接就绪消息
		readyMsg := map[string]string{"type": "ready"}
		if data, err := json.Marshal(readyMsg); err == nil {
			_ = wsConn.SetWriteDeadline(time.Now().Add(wsWriteWait))
			_ = wsConn.WriteMessage(websocket.TextMessage, data)
		}
	case err := <-errChan:
		log.Printf("[Monitor] 获取连接失败: %v", err)
		errMsg := map[string]string{"type": "error", "message": err.Error()}
		if data, err := json.Marshal(errMsg); err == nil {
			_ = wsConn.SetWriteDeadline(time.Now().Add(wsWriteWait))
			_ = wsConn.WriteMessage(websocket.TextMessage, data)
		}
		return
	case <-time.After(10 * time.Second):
		log.Printf("[Monitor] 获取连接超时")
		errMsg := map[string]string{"type": "error", "message": "connection timeout"}
		if data, err := json.Marshal(errMsg); err == nil {
			_ = wsConn.SetWriteDeadline(time.Now().Add(wsWriteWait))
			_ = wsConn.WriteMessage(websocket.TextMessage, data)
		}
		return
	}

	// 确保在函数退出时释放连接
	defer func() {
		h.connectionPool.Release(userID, serverID)
		log.Printf("[Monitor] 释放连接: userID=%s, serverID=%s", userID, serverID)
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
	h.collectorManager.GetOrCreate(serverID, func() *monitor.Collector {
		return monitor.NewCollector(pooledConn.Client)
	}, interval, subscriber)

	// 确保退出时取消订阅
	defer func() {
		h.collectorManager.Unsubscribe(serverID, subID)
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
