package chatbridge

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/shared/protocol"
	"gorm.io/gorm"
)

// sessions selects Agent sessions started by this connection's bindings. Chat
// sessions run as the owner with the binding ID as actor session, so the AI
// runtime's own table already records the link and no copy is kept here.
func (s *Service) sessions(ctx context.Context, c Connection) *gorm.DB {
	return s.db.WithContext(ctx).Table("ai_sessions AS s").
		Joins("JOIN chat_bindings AS b ON b.id = s.actor_session_id").
		Where("b.connection_id = ? AND s.actor_kind = ? AND s.actor_id = ? AND s.deleted_at IS NULL", c.ID, protocol.Owner, c.OwnerID)
}

func (s *Service) Sessions(ctx context.Context, connectionID string) ([]Session, error) {
	c, err := s.connection(ctx, connectionID)
	if err != nil {
		return nil, err
	}
	items := []Session{}
	err = s.sessions(ctx, c).Where("s.message_count > 0").
		Select("s.id, b.id AS binding_id, b.display_name, s.status, s.preview, s.updated_at").
		Order("s.updated_at DESC").Limit(200).Scan(&items).Error
	return items, err
}

// Transcript rebuilds what Telegram received with the same text builders and
// chunking as delivery. Transient acknowledgements such as "已收到" are omitted.
func (s *Service) Transcript(ctx context.Context, connectionID, sessionID string) ([]TranscriptMessage, error) {
	c, err := s.connection(ctx, connectionID)
	if err != nil {
		return nil, err
	}
	var count int64
	if err := s.sessions(ctx, c).Where("s.id = ?", sessionID).Count(&count).Error; err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	view, err := s.agent.GetSession(ctx, sessionID)
	if errors.Is(err, runtime.ErrSessionNotFound) {
		return nil, gorm.ErrRecordNotFound
	}
	if err != nil {
		return nil, err
	}
	var approvals []Approval
	if err := s.db.WithContext(ctx).Where("session_id = ?", sessionID).Find(&approvals).Error; err != nil {
		return nil, err
	}
	offered := make(map[string]string, len(approvals))
	for _, approval := range approvals {
		offered[approval.TaskID] = approval.ID
	}

	type entry struct {
		id       string
		from     string
		at       time.Time
		text     string
		keyboard *telegramKeyboard
	}
	var entries []entry
	for _, message := range view.Messages {
		if strings.TrimSpace(message.Content) == "" {
			continue
		}
		switch message.Role {
		case "user":
			entries = append(entries, entry{id: message.ID, from: "user", at: message.CreatedAt, text: message.Content})
		case "assistant":
			entries = append(entries, entry{id: message.ID, from: "bot", at: message.CreatedAt, text: assistantText(view.ID, message)})
		}
	}
	for _, task := range view.Tasks {
		if approvalID, ok := offered[task.ID]; ok {
			text, keyboard := approvalText(view.ID, task, approvalID)
			entries = append(entries, entry{id: "approval:" + task.ID, from: "bot", at: task.CreatedAt, text: text, keyboard: keyboard})
		}
		if task.Status == runtime.TaskStatusUnknown {
			entries = append(entries, entry{id: "unknown:" + task.ID, from: "bot", at: task.UpdatedAt, text: unknownText(view.ID, task)})
		}
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].at.Before(entries[j].at) })

	messages := []TranscriptMessage{}
	for _, e := range entries {
		if e.from == "user" {
			messages = append(messages, TranscriptMessage{ID: e.id, From: e.from, Text: e.text, Buttons: []string{}, CreatedAt: e.at})
			continue
		}
		for i, call := range reply(0, e.text, e.keyboard) {
			message := TranscriptMessage{ID: fmt.Sprintf("%s:%d", e.id, i), From: e.from, Text: call.payload["text"].(string), Buttons: []string{}, CreatedAt: e.at}
			if keyboard, ok := call.payload["reply_markup"].(*telegramKeyboard); ok {
				for _, row := range keyboard.Buttons {
					for _, button := range row {
						message.Buttons = append(message.Buttons, button.Text)
					}
				}
			}
			messages = append(messages, message)
		}
	}
	return messages, nil
}
