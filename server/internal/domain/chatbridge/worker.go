package chatbridge

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/shared/aiprovider"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func (s *Service) Start(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	s.cancel = cancel
	s.wg.Add(2)
	go func() { defer s.wg.Done(); s.run(ctx) }()
	go func() { defer s.wg.Done(); s.sendReplies(ctx) }()
}

func (s *Service) Stop() {
	if s.cancel != nil {
		s.cancel()
		s.wg.Wait()
	}
}

type poller struct {
	revision int64
	token    string
	cancel   context.CancelFunc
	done     chan struct{}
}

// run keeps one receiver per enabled connection and projects Agent results
// back to the corresponding chat platform once per second.
func (s *Service) run(ctx context.Context) {
	pollers := map[string]poller{}
	defer func() {
		for _, p := range pollers {
			p.cancel()
			<-p.done
		}
	}()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	pruned := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		// Event claims only need to outlive Feishu's redelivery window.
		if time.Since(pruned) > time.Hour {
			s.db.WithContext(ctx).Where("created_at < ?", time.Now().UTC().Add(-7*24*time.Hour)).Delete(&ReceivedEvent{})
			pruned = time.Now()
		}
		var connections []Connection
		if err := s.db.WithContext(ctx).Where("enabled = ?", true).Find(&connections).Error; err != nil {
			log.Printf("chat connection lookup failed: %v", err)
			continue
		}
		active := make(map[string]Connection, len(connections))
		for _, c := range connections {
			active[c.ID] = c
		}
		for id, p := range pollers {
			c, exists := active[id]
			finished := false
			select {
			case <-p.done:
				finished = true
			default:
			}
			if !exists || finished || c.Revision != p.revision || c.TokenCipher != p.token {
				p.cancel()
				<-p.done
				delete(pollers, id)
			}
		}
		for id, c := range active {
			if _, exists := pollers[id]; exists {
				continue
			}
			pollCtx, cancel := context.WithCancel(ctx)
			p := poller{revision: c.Revision, token: c.TokenCipher, cancel: cancel, done: make(chan struct{})}
			pollers[id] = p
			go func(c Connection) {
				defer close(p.done)
				if c.Provider == ProviderFeishu {
					s.listenFeishu(pollCtx, c)
				} else {
					s.poll(pollCtx, c)
				}
			}(c)
		}
		if err := s.project(ctx); err != nil && ctx.Err() == nil {
			log.Printf("chat result projection failed: %v", err)
		}
	}
}

func wait(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

var telegramCommands = []map[string]string{
	{"command": "new", "description": "新建会话"},
	{"command": "stop", "description": "停止当前任务"},
	{"command": "status", "description": "查看会话状态"},
	{"command": "help", "description": "使用说明"},
}

func (s *Service) poll(ctx context.Context, c Connection) {
	credential, revision := c.TokenCipher, c.Revision
	token, err := s.token(c)
	if err != nil {
		s.db.WithContext(ctx).Model(&Connection{}).Where("id = ?", c.ID).UpdateColumn("last_error", "机器人凭据无法解密")
		return
	}
	// The menu beside the input box; a failure only costs the shortcut.
	if err := s.telegram(ctx, token, "setMyCommands", map[string]any{"commands": telegramCommands}, nil); err != nil && ctx.Err() == nil {
		log.Printf("chat telegram command menu for connection %s: %v", c.ID, err)
	}
	for ctx.Err() == nil {
		var updates []telegramUpdate
		err := s.telegram(ctx, token, "getUpdates", map[string]any{"offset": c.NextUpdateID, "timeout": 25, "limit": 50, "allowed_updates": []string{"message", "callback_query"}}, &updates)
		if ctx.Err() != nil {
			return
		}
		if err == nil {
			var stale bool
			stale, err = s.receive(ctx, &c, credential, revision, updates)
			if stale {
				return
			}
		}
		if err != nil {
			message := "接收消息失败，请检查数据库"
			var apiErr *telegramError
			if errors.As(err, &apiErr) {
				message = apiErr.Error()
			} else if strings.HasPrefix(err.Error(), "Telegram") || strings.HasPrefix(err.Error(), "无法连接 Telegram") {
				message = err.Error()
			}
			s.db.WithContext(ctx).Model(&Connection{}).Where("id = ?", c.ID).UpdateColumn("last_error", message)
			delay := 5 * time.Second
			if apiErr != nil {
				delay = max(delay, time.Duration(apiErr.RetryAfter)*time.Second)
			}
			if !wait(ctx, delay) {
				return
			}
		}
	}
}

// receive commits the polling offset before dispatching. A crash may drop a
// message, but it can never replay one that may already have changed a server.
func (s *Service) receive(ctx context.Context, c *Connection, credential string, revision int64, updates []telegramUpdate) (bool, error) {
	s.mu.Lock()
	var calls []outgoing
	defer func() {
		s.enqueue(*c, calls)
		s.mu.Unlock()
	}()
	var current Connection
	err := s.db.WithContext(ctx).Where("id = ? AND enabled = ? AND token_cipher = ? AND revision = ?", c.ID, true, credential, revision).First(&current).Error
	if err != nil {
		return errors.Is(err, gorm.ErrRecordNotFound), err
	}
	next := current.NextUpdateID
	for _, update := range updates {
		next = max(next, update.UpdateID+1)
	}
	if err := s.db.WithContext(ctx).Model(&Connection{}).Where("id = ?", c.ID).Updates(map[string]any{"next_update_id": next, "last_poll_at": time.Now().UTC(), "last_error": ""}).Error; err != nil {
		return false, err
	}
	current.NextUpdateID = next
	*c = current
	for _, update := range updates {
		replies, err := s.dispatch(ctx, *c, update)
		if err != nil && ctx.Err() == nil {
			log.Printf("chat dispatch failed: %v", err)
		}
		calls = append(calls, replies...)
	}
	return false, nil
}

func privateMessage(update telegramUpdate) (*telegramMessage, telegramUser) {
	m := update.Message
	var user telegramUser
	if m != nil {
		user = m.From
	}
	if update.Callback != nil {
		m, user = update.Callback.Message, update.Callback.From
	}
	if m == nil || m.Chat.Type != "private" || user.ID <= 0 || user.IsBot || m.Chat.ID != user.ID {
		return nil, telegramUser{}
	}
	return m, user
}

func (s *Service) dispatch(ctx context.Context, c Connection, update telegramUpdate) ([]outgoing, error) {
	m, user := privateMessage(update)
	if m == nil {
		return nil, nil
	}
	name := user.FirstName
	if user.Username != "" {
		name += " @" + user.Username
	}
	message := incomingMessage{userID: user.ID, chatID: m.Chat.ID, displayName: strings.TrimSpace(name), text: m.Text, requestID: fmt.Sprint(update.UpdateID)}
	if update.Callback != nil {
		message.callbackID, message.callbackData = update.Callback.ID, update.Callback.Data
	}
	return s.dispatchMessage(ctx, c, message)
}

type incomingMessage struct {
	media                          *feishuMedia
	group                          bool
	userID, chatID                 int64
	externalUserID, externalChatID string
	displayName, text, requestID   string
	callbackID, callbackData       string
}

func (m incomingMessage) chatAddress() any {
	if m.externalChatID != "" {
		return m.externalChatID
	}
	return m.chatID
}

func bindingQuery(db *gorm.DB, c Connection, m incomingMessage) *gorm.DB {
	query := db.Where("connection_id = ? AND revoked_at IS NULL", c.ID)
	if c.Provider == ProviderFeishu {
		return query.Where("external_user_id = ? AND external_chat_id = ?", m.externalUserID, m.externalChatID)
	}
	return query.Where("user_id = ?", m.userID)
}

func (s *Service) dispatchMessage(ctx context.Context, c Connection, m incomingMessage) ([]outgoing, error) {
	text := strings.TrimSpace(m.text)
	var b Binding
	err := bindingQuery(s.db.WithContext(ctx), c, m).First(&b).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if m.callbackID != "" {
			return nil, nil
		}
		answer, err := s.request(ctx, c, m, text)
		return reply(m.chatAddress(), answer, nil), err
	}
	if err != nil {
		return nil, err
	}
	if b.chatAddress() != m.chatAddress() {
		return nil, nil
	}
	boundCtx, err := s.bindingContext(ctx, c, b)
	if err != nil {
		return nil, nil
	}
	if m.callbackID != "" {
		answer := "已处理，请等待结果。"
		requestID, err := s.confirm(boundCtx, b, m.callbackData)
		if err != nil {
			answer = userError(err)
		}
		// The acknowledgement becomes the progress message for the resumed run.
		calls := reply(b.chatAddress(), answer, nil)
		if err == nil && requestID != "" {
			calls[0].bindingID, calls[0].statusSessionID, calls[0].statusRequestID = b.ID, b.CurrentSessionID, requestID
		}
		// Callback acknowledgements are ephemeral; failures never replay approvals.
		if c.Provider == ProviderFeishu {
			return calls, nil
		}
		ack := outgoing{method: "answerCallbackQuery", payload: map[string]any{"callback_query_id": m.callbackID, "text": answer}}
		return append([]outgoing{ack}, calls...), nil
	}
	answer := ""
	switch text {
	case "/start", "/help":
		answer = "发送文字即可与 EasySSH Agent 对话。\n/new 新建会话\n/stop 停止当前任务\n/status 查看状态\n/help 使用说明\n需要执行的操作会显示审批按钮，有效期 10 分钟。"
		if c.Provider == ProviderFeishu {
			answer += "\n支持图片和 UTF-8 文本附件。群内请在图文消息中 @机器人，或回复目标附件并 @机器人。"
		}
	case "/new":
		if b.CurrentSessionID != "" {
			if err := s.agent.CancelSession(boundCtx, b.CurrentSessionID); err != nil && !errors.Is(err, runtime.ErrSessionNotFound) && !errors.Is(err, runtime.ErrSessionClosed) {
				answer = userError(err)
				break
			}
		}
		if err := s.newConversation(boundCtx, c, &b); err != nil {
			answer = userError(err)
		} else {
			answer = "已新建会话，请发送你的问题。"
		}
	case "/stop":
		if b.CurrentSessionID == "" {
			answer = "当前没有会话。"
		} else if err := s.agent.CancelSession(boundCtx, b.CurrentSessionID); err != nil {
			answer = userError(err)
		} else {
			answer = "已请求停止。停止结果以任务实际状态为准，已执行的操作不会自动撤销。"
		}
	case "/status":
		if b.CurrentSessionID == "" {
			answer = "当前没有会话。"
		} else if view, err := s.agent.GetSession(boundCtx, b.CurrentSessionID); err != nil {
			answer = userError(err)
		} else {
			answer = "会话状态：" + statusLabel(view.Status) + "\n会话 ID：" + view.ID
			if view.Status == runtime.SessionStatusRunning {
				if progress, err := s.progressText(boundCtx, view, lastRequestID(view.Messages)); err == nil {
					answer += "\n\n" + progress
				}
			}
		}
	default:
		return s.ask(ctx, boundCtx, c, &b, text, m)
	}
	return reply(b.chatAddress(), answer, nil), nil
}

func (s *Service) ask(ctx, boundCtx context.Context, c Connection, b *Binding, text string, m incomingMessage) ([]outgoing, error) {
	var images []runtime.Attachment
	if media := m.media; media != nil {
		if media.bindingID != b.ID {
			return nil, nil
		}
		if media.err != nil {
			return reply(b.chatAddress(), media.err.Error(), nil), nil
		}
		images = media.images
		if text == "" && (len(images) != 0 || len(media.excerpts) != 0) {
			text = "请分析本条消息中的附件。"
		}
	}
	switch {
	case text == "":
		if c.Provider == ProviderFeishu {
			return reply(b.chatAddress(), "请发送文字、图片或 UTF-8 文本文件。群内也可回复附件并 @机器人 提问。", nil), nil
		}
		return reply(b.chatAddress(), "当前仅支持文字消息，请用文字描述问题。", nil), nil
	case len([]rune(text)) > 8000:
		return reply(b.chatAddress(), "消息过长，请拆分为较短的问题。", nil), nil
	case strings.HasPrefix(text, "/"):
		return reply(b.chatAddress(), "未知命令，请用 /help 查看支持的命令。", nil), nil
	}
	if b.CurrentSessionID == "" {
		if err := s.newConversation(boundCtx, c, b); err != nil {
			return reply(b.chatAddress(), userError(err), nil), nil
		}
	}
	// Persist projection intent before dispatch so results reach the chat even
	// if the service restarts while the Agent is running.
	if err := s.db.WithContext(ctx).Model(&Binding{}).Where("id = ?", b.ID).Update("watching", true).Error; err != nil {
		return nil, err
	}
	// Stable per incoming message; the offset or event claim prevents replay.
	messageID := stableID(c.ID + ":" + m.requestID)
	source := "消息来源：已绑定的 " + platformName(c) + " 私聊。"
	if m.group {
		source = "消息来源：飞书群聊。回复对群内所有成员可见。"
	}
	if m.media != nil && len(m.media.excerpts) != 0 {
		source += "\n\n" + strings.Join(m.media.excerpts, "\n\n")
	}
	err := s.agent.SendUserMessageWithOptions(boundCtx, b.CurrentSessionID, runtime.SendUserMessageInput{Content: text, Attachments: images, Context: source, MessageID: messageID, PermissionMode: c.PermissionMode})
	if err != nil {
		return reply(b.chatAddress(), userError(err), nil), nil
	}
	calls := reply(b.chatAddress(), "已收到，正在处理。", nil)
	calls[0].bindingID = b.ID
	calls[0].statusSessionID = b.CurrentSessionID
	calls[0].statusRequestID = messageID
	return calls, nil
}

const (
	requestTTL  = 24 * time.Hour
	maxRequests = 20
)

// request records an unbound account's access request for the owner to
// approve on the web page. Repeated messages refresh the same request.
func (s *Service) request(ctx context.Context, c Connection, m incomingMessage, text string) (string, error) {
	answer := "已提交接入申请，请等待管理员在 EasySSH「Agent 接入」页面批准。"
	if m.group {
		answer = "已提交本群的接入申请，请等待管理员在 EasySSH「Agent 接入」页面批准。批准后回复对全群可见。"
	}
	now := time.Now().UTC()
	preview := truncate(strings.Join(strings.Fields(text), " "), 100)
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("connection_id = ? AND updated_at <= ?", c.ID, now.Add(-requestTTL)).Delete(&BindRequest{}).Error; err != nil {
			return err
		}
		subject := tx.Model(&BindRequest{}).Where("connection_id = ? AND user_id = ? AND external_user_id = ? AND external_chat_id = ?", c.ID, m.userID, m.externalUserID, m.externalChatID)
		result := subject.Updates(map[string]any{"display_name": truncate(m.displayName, 100), "message": preview, "updated_at": now})
		if result.Error != nil || result.RowsAffected != 0 {
			return result.Error
		}
		var count int64
		if err := tx.Model(&BindRequest{}).Where("connection_id = ?", c.ID).Count(&count).Error; err != nil {
			return err
		}
		if count >= maxRequests {
			answer = "待处理的接入申请过多，请联系管理员先处理已有申请。"
			return nil
		}
		return tx.Create(&BindRequest{ID: uuid.NewString(), ConnectionID: c.ID, UserID: m.userID, ChatID: m.chatID, ExternalUserID: m.externalUserID, ExternalChatID: m.externalChatID,
			IsGroup: m.group, DisplayName: truncate(m.displayName, 100), Message: preview, CreatedAt: now, UpdatedAt: now}).Error
	})
	return answer, err
}

func (s *Service) newConversation(ctx context.Context, c Connection, b *Binding) error {
	view, err := s.agent.CreateSession(ctx, runtime.CreateSessionInput{PermissionMode: c.PermissionMode})
	if err != nil {
		return err
	}
	_ = s.agent.RenameSession(ctx, view.ID, platformName(c)+" · "+c.Name)
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if b.CurrentSessionID != "" {
			if err := tx.Model(&Approval{}).Where("session_id = ? AND used_at IS NULL", b.CurrentSessionID).Update("used_at", time.Now().UTC()).Error; err != nil {
				return err
			}
		}
		return tx.Model(&Binding{}).Where("id = ?", b.ID).Updates(map[string]any{"current_session_id": view.ID, "message_count": 0, "watching": false}).Error
	})
	if err != nil {
		_ = s.agent.DeleteSession(ctx, view.ID)
		return err
	}
	b.CurrentSessionID, b.MessageCount, b.Watching = view.ID, 0, false
	return nil
}

func userError(err error) string {
	var limit *aiprovider.ProviderError
	if errors.As(err, &limit) && (limit.Code == "invalid_attachment" || limit.Code == "ai_context_limit" || limit.Code == "ai_history_limit") {
		return limit.Message + "。可用 /new 新建会话后重试。"
	}
	switch {
	case errors.Is(err, runtime.ErrSessionBusy):
		return "当前任务仍在运行，请等待，或使用 /stop 请求停止。"
	case errors.Is(err, runtime.ErrSessionHasPendingConfirmations):
		return "请先批准或拒绝待审批操作，或用 /stop 停止。"
	case errors.Is(err, runtime.ErrSessionNotFound), errors.Is(err, runtime.ErrSessionClosed):
		return "会话已不可用，请用 /new 新建会话。"
	case errors.Is(err, ErrInvalid):
		return strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": ")
	default:
		return "请求未能完成，请在 EasySSH 网页查看会话和连接状态。不要直接重复执行结果未知的操作。"
	}
}

func statusLabel(status runtime.SessionStatus) string {
	switch status {
	case runtime.SessionStatusRunning:
		return "运行中"
	case runtime.SessionStatusWaitingConfirmation:
		return "等待审批"
	case runtime.SessionStatusIdle:
		return "空闲"
	default:
		return string(status)
	}
}
