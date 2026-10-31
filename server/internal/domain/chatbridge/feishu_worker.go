package chatbridge

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sync/atomic"
	"time"

	larkevent "github.com/larksuite/oapi-sdk-go/v3/event"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher/callback"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
	"gorm.io/gorm"
)

// The SDK can log websocket URLs (including credentials) and full event bodies.
// Health callbacks below expose sanitized diagnostics instead.
type feishuSDKLogger struct{}

func (feishuSDKLogger) Debug(context.Context, ...interface{}) {}
func (feishuSDKLogger) Info(context.Context, ...interface{})  {}
func (feishuSDKLogger) Warn(context.Context, ...interface{})  {}
func (feishuSDKLogger) Error(context.Context, ...interface{}) {}

func feishuString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s *Service) feishuHealth(ctx context.Context, c Connection, online bool, message string) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	values := map[string]any{"last_error": message, "last_poll_at": nil}
	if online {
		values["last_poll_at"] = time.Now().UTC()
	}
	if err := s.db.WithContext(ctx).Model(&Connection{}).Where("id = ? AND enabled = ? AND revision = ?", c.ID, true, c.Revision).Updates(values).Error; err != nil && ctx.Err() == nil {
		log.Printf("chat feishu health update failed for connection %s", c.ID)
	}
}

func (s *Service) listenFeishu(ctx context.Context, c Connection) {
	secret, err := s.token(c)
	if err != nil {
		s.feishuHealth(ctx, c, false, "飞书应用凭据无法解密")
		wait(ctx, 5*time.Second)
		return
	}
	// Acknowledge SDK callbacks promptly. One consumer serializes dispatch, and
	// claims each event in the database before any Agent operation is started.
	queue := make(chan incomingMessage, 256)
	submit := func(message incomingMessage) error {
		if message.requestID == "" || message.externalUserID == "" || message.externalChatID == "" {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case queue <- message:
			return nil
		default:
			return errors.New("飞书消息队列已满，请稍后重试")
		}
	}
	handler := dispatcher.NewEventDispatcher("", "")
	handler.InitConfig(larkevent.WithLogger(feishuSDKLogger{}))
	handler.OnP2MessageReceiveV1(func(_ context.Context, event *larkim.P2MessageReceiveV1) error {
		if event == nil || event.EventV2Base == nil || event.EventV2Base.Header == nil || event.EventV2Base.Header.AppID != c.AppID || event.Event == nil || event.Event.Sender == nil || event.Event.Message == nil {
			return nil
		}
		sender, message := event.Event.Sender, event.Event.Message
		if sender.SenderId == nil || feishuString(sender.SenderType) != "user" || feishuString(message.ChatType) != "p2p" {
			return nil
		}
		var content struct {
			Text string `json:"text"`
		}
		if feishuString(message.MessageType) == "text" {
			if err := json.Unmarshal([]byte(feishuString(message.Content)), &content); err != nil {
				return errors.New("飞书消息内容格式无效")
			}
		}
		userID := feishuString(sender.SenderId.OpenId)
		return submit(incomingMessage{externalUserID: userID, externalChatID: feishuString(message.ChatId), displayName: userID, text: content.Text, requestID: feishuString(message.MessageId)})
	})
	handler.OnP2CardActionTrigger(func(_ context.Context, event *callback.CardActionTriggerEvent) (*callback.CardActionTriggerResponse, error) {
		if event == nil || event.EventV2Base == nil || event.EventV2Base.Header == nil || event.EventV2Base.Header.AppID != c.AppID || event.Event == nil {
			return nil, nil
		}
		action := event.Event
		if action.Operator == nil || action.Context == nil || action.Action == nil || action.Host != "im_message" {
			return nil, nil
		}
		data, ok := action.Action.Value["approval"].(string)
		if !ok || data == "" || event.EventV2Base.Header.EventID == "" {
			return nil, nil
		}
		err := submit(incomingMessage{externalUserID: action.Operator.OpenID, externalChatID: action.Context.OpenChatID, requestID: "callback:" + event.EventV2Base.Header.EventID, callbackID: event.EventV2Base.Header.EventID, callbackData: data})
		if err != nil {
			return nil, err
		}
		return &callback.CardActionTriggerResponse{Toast: &callback.Toast{Type: "info", Content: "已收到，请以会话中的处理结果为准。"}}, nil
	})
	var connected atomic.Bool
	ready := func() { connected.Store(true); s.feishuHealth(ctx, c, true, "") }
	disconnected := func() {
		connected.Store(false)
		s.feishuHealth(ctx, c, false, "飞书长连接已断开，正在重连")
	}
	client := larkws.NewClient(c.AppID, secret, larkws.WithEventHandler(handler), larkws.WithLogger(feishuSDKLogger{}), larkws.WithHttpClient(s.http),
		larkws.WithOnReady(ready), larkws.WithOnReconnected(ready), larkws.WithOnReconnecting(disconnected), larkws.WithOnDisconnected(disconnected),
		larkws.WithOnError(func(error) { disconnected() }))
	done := make(chan error, 1)
	go func() { done <- client.Start(ctx) }()
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = client.CloseAndWait(closeCtx)
	}()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			if ctx.Err() == nil {
				s.feishuHealth(ctx, c, false, "飞书长连接失败，请检查应用凭据、长连接配置及网络")
				wait(ctx, 5*time.Second)
			}
			return
		case <-ticker.C:
			if connected.Load() {
				s.feishuHealth(ctx, c, true, "")
			}
		case message := <-queue:
			if err := s.receiveFeishu(ctx, c, message); err != nil && ctx.Err() == nil {
				log.Printf("chat feishu dispatch failed for connection %s", c.ID)
				s.feishuHealth(ctx, c, connected.Load(), "飞书消息处理失败，请检查数据库和会话状态")
			}
		}
	}
}

func (s *Service) receiveFeishu(ctx context.Context, c Connection, message incomingMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var current Connection
	err := s.db.WithContext(ctx).Where("id = ? AND enabled = ? AND revision = ? AND provider = ?", c.ID, true, c.Revision, ProviderFeishu).First(&current).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	event := ReceivedEvent{ID: stableID(c.ID + ":feishu:" + message.requestID), ConnectionID: c.ID, CreatedAt: time.Now().UTC()}
	var count int64
	if err := s.db.WithContext(ctx).Model(&ReceivedEvent{}).Where("id = ?", event.ID).Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return nil
	}
	// s.mu serializes claims; the primary key also rejects a competing insert.
	// Do not infer a new claim from MySQL's configurable affected-row semantics.
	if err := s.db.WithContext(ctx).Create(&event).Error; err != nil {
		return err
	}
	// Like Telegram's offset, the claim commits before dispatch. A crash may
	// lose a reply, but a duplicate can never replay a server-changing operation.
	calls, err := s.dispatchMessage(ctx, current, message)
	s.enqueue(current, calls)
	return err
}
