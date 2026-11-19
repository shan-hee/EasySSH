package chatbridge

import (
	"context"
	"errors"
	"log"
	"regexp"
	"strings"
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

var feishuMentionKey = regexp.MustCompile(`@_user_[0-9]+`)

func feishuGroupText(text string, mentions []*larkim.MentionEvent, botID string) (string, bool) {
	keys := make(map[string]bool)
	for _, mention := range mentions {
		if botID != "" && mention != nil && mention.Id != nil && feishuString(mention.Id.OpenId) == botID && feishuString(mention.Key) != "" {
			keys[*mention.Key] = true
		}
	}
	return feishuMentionKey.ReplaceAllStringFunc(text, func(key string) string {
		if keys[key] {
			return ""
		}
		return key
	}), len(keys) != 0
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
	bot, err := s.inspectFeishuBot(ctx, c.AppID, secret)
	if err != nil {
		s.feishuHealth(ctx, c, false, "无法获取飞书机器人身份，请检查应用凭据和网络")
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
		chatType := feishuString(message.ChatType)
		if sender.SenderId == nil || feishuString(sender.SenderType) != "user" || (chatType != "p2p" && chatType != "group") {
			return nil
		}
		messageID := feishuString(message.MessageId)
		text, resources, parseErr := feishuContent(feishuString(message.MessageType), feishuString(message.Content), messageID)
		if chatType == "group" {
			var mentioned bool
			text, mentioned = feishuGroupText(text, message.Mentions, bot.OpenID)
			if !mentioned {
				return nil
			}
		}
		userID := feishuString(sender.SenderId.OpenId)
		incoming := incomingMessage{group: chatType == "group", externalUserID: userID, externalChatID: feishuString(message.ChatId), displayName: userID, text: text, requestID: messageID}
		parentID := feishuString(message.ParentId)
		if !strings.HasPrefix(strings.TrimSpace(text), "/") && (parentID != "" || len(resources) != 0 || parseErr != nil) {
			incoming.media = &feishuMedia{parentID: parentID, resources: resources, err: parseErr}
		}
		return submit(incoming)
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
	claimed, err := s.claimFeishu(ctx, c, message.requestID)
	if err != nil || !claimed {
		return err
	}
	var binding Binding
	err = bindingQuery(s.db.WithContext(ctx), c, message).First(&binding).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	// Platform I/O stays outside s.mu, as with attachment downloads.
	if err != nil && message.callbackID == "" {
		message.displayName = s.feishuDisplayName(ctx, c, message)
	}
	if media := message.media; media != nil {
		if err == nil {
			boundCtx, err := s.bindingContext(ctx, c, binding)
			if err != nil {
				return nil
			}
			media.bindingID = binding.ID
			if media.err == nil {
				downloadCtx, cancel := context.WithTimeout(boundCtx, time.Minute)
				media.err = s.loadFeishuMedia(downloadCtx, c, message.externalChatID, media)
				cancel()
			}
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var current Connection
	err = s.db.WithContext(ctx).Where("id = ? AND enabled = ? AND revision = ? AND provider = ?", c.ID, true, c.Revision, ProviderFeishu).First(&current).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	calls, err := s.dispatchMessage(ctx, current, message)
	s.enqueue(current, calls)
	return err
}

func (s *Service) claimFeishu(ctx context.Context, c Connection, requestID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var active int64
	if err := s.db.WithContext(ctx).Model(&Connection{}).Where("id = ? AND enabled = ? AND revision = ?", c.ID, true, c.Revision).Count(&active).Error; err != nil || active == 0 {
		return false, err
	}
	event := ReceivedEvent{ID: stableID(c.ID + ":feishu:" + requestID), ConnectionID: c.ID, CreatedAt: time.Now().UTC()}
	var count int64
	if err := s.db.WithContext(ctx).Model(&ReceivedEvent{}).Where("id = ?", event.ID).Count(&count).Error; err != nil {
		return false, err
	}
	if count != 0 {
		return false, nil
	}
	// s.mu serializes claims; the primary key also rejects a competing insert.
	// Do not infer a new claim from MySQL's configurable affected-row semantics.
	if err := s.db.WithContext(ctx).Create(&event).Error; err != nil {
		return false, err
	}
	// Like Telegram's offset, the claim commits before dispatch. A crash may
	// lose a reply, but a duplicate can never replay a server-changing operation.
	return true, nil
}
