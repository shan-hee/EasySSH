package chatbridge

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/runtime"
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

func (s *Service) poll(ctx context.Context, c Connection) {
	credential, revision := c.TokenCipher, c.Revision
	token, err := s.token(c)
	if err != nil {
		s.db.WithContext(ctx).Model(&Connection{}).Where("id = ?", c.ID).UpdateColumn("last_error", "机器人凭据无法解密")
		return
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
	message := incomingMessage{userID: user.ID, chatID: m.Chat.ID, displayName: user.FirstName, text: m.Text, requestID: fmt.Sprint(update.UpdateID)}
	if update.Callback != nil {
		message.callbackID, message.callbackData = update.Callback.ID, update.Callback.Data
	}
	return s.dispatchMessage(ctx, c, message)
}

type incomingMessage struct {
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
		return query.Where("external_user_id = ?", m.externalUserID)
	}
	return query.Where("user_id = ?", m.userID)
}

func (s *Service) dispatchMessage(ctx context.Context, c Connection, m incomingMessage) ([]outgoing, error) {
	text := strings.TrimSpace(m.text)
	if m.callbackID == "" && (strings.HasPrefix(text, "/start bind_") || strings.HasPrefix(text, "/bind ")) {
		code := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(text, "/start bind_"), "/bind "))
		answer, err := s.bind(ctx, c, m, code)
		return reply(m.chatAddress(), answer, nil), err
	}
	var b Binding
	err := bindingQuery(s.db.WithContext(ctx), c, m).First(&b).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return reply(m.chatAddress(), "请先在 EasySSH 生成绑定码，并在机器人私聊中发送 /bind <绑定码> 完成绑定。", nil), nil
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
		if err := s.confirm(boundCtx, b, m.callbackData); err != nil {
			answer = userError(err)
		}
		// Callback acknowledgements are ephemeral; failures never replay approvals.
		if c.Provider == ProviderFeishu {
			return reply(b.chatAddress(), answer, nil), nil
		}
		ack := outgoing{method: "answerCallbackQuery", payload: map[string]any{"callback_query_id": m.callbackID, "text": answer}}
		return append([]outgoing{ack}, reply(b.chatAddress(), answer, nil)...), nil
	}
	answer := ""
	switch text {
	case "/start", "/help":
		answer = "直接发送文字即可与 EasySSH Agent 对话。\n/new 新建会话\n/stop 停止当前任务\n/status 查看状态\n/help 使用说明\n当前仅支持私聊文字。需要执行的操作会显示审批按钮，有效期 10 分钟。"
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
		}
	default:
		return s.ask(ctx, boundCtx, c, &b, text, m.requestID)
	}
	return reply(b.chatAddress(), answer, nil), nil
}

func (s *Service) ask(ctx, boundCtx context.Context, c Connection, b *Binding, text, requestID string) ([]outgoing, error) {
	switch {
	case text == "":
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
	messageID := stableID(c.ID + ":" + requestID)
	err := s.agent.SendUserMessageWithOptions(boundCtx, b.CurrentSessionID, runtime.SendUserMessageInput{Content: text, Context: "消息来源：已绑定的 " + platformName(c) + " 私聊。", MessageID: messageID, PermissionMode: c.PermissionMode})
	if err != nil {
		return reply(b.chatAddress(), userError(err), nil), nil
	}
	calls := reply(b.chatAddress(), "已收到，正在处理。", nil)
	calls[0].statusSessionID = b.CurrentSessionID
	calls[0].statusRequestID = messageID
	return calls, nil
}

func (s *Service) bind(ctx context.Context, c Connection, m incomingMessage, code string) (string, error) {
	answer := ""
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&Connection{}).Where("id = ? AND enabled = ? AND bind_code_hash = ? AND bind_expires_at > ?", c.ID, true, hash(code), time.Now().UTC()).Updates(map[string]any{"bind_code_hash": "", "bind_expires_at": nil})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			answer = "绑定码无效或已过期，请在 EasySSH 中重新生成。"
			return nil
		}
		var existing Binding
		err := bindingQuery(tx, c, m).First(&existing).Error
		if err == nil {
			answer = "此账号已绑定，可以直接发送问题。"
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		b := Binding{ID: uuid.NewString(), ConnectionID: c.ID, UserID: m.userID, ChatID: m.chatID, ExternalUserID: m.externalUserID, ExternalChatID: m.externalChatID, DisplayName: truncate(m.displayName, 100), CreatedAt: time.Now().UTC()}
		if err := tx.Create(&b).Error; err != nil {
			return err
		}
		answer = "绑定成功。你可以直接与 EasySSH Agent 对话，用 /help 查看命令。"
		return nil
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
