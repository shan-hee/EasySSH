package chatbridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/shared/aichatui"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func (s *Service) taskDigest(ctx context.Context, sessionID string, task runtime.TaskView) (string, error) {
	fileHash := ""
	if task.File != nil {
		reference, err := s.agent.GetTaskFile(ctx, sessionID, task.ID)
		if err != nil {
			return "", err
		}
		fileHash = reference.Sha256
	}
	encoded, err := json.Marshal(struct {
		Tool      string
		Arguments map[string]interface{}
		File      any
		FileHash  string
	}{task.ToolName, task.Arguments, task.File, fileHash})
	if err != nil {
		return "", err
	}
	return hash(string(encoded)), nil
}

// confirm returns the ID of the user message whose run the decision resumes.
func (s *Service) confirm(ctx context.Context, b Binding, data string) (string, error) {
	parts := strings.Split(data, ":")
	if len(parts) != 2 || (parts[1] != "yes" && parts[1] != "no") {
		return "", invalid("审批按钮无效")
	}
	var approval Approval
	if err := s.db.WithContext(ctx).Where("id = ? AND binding_id = ? AND used_at IS NULL AND expires_at > ?", parts[0], b.ID, time.Now().UTC()).First(&approval).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", invalid("审批已处理或过期，请查看当前会话")
		}
		return "", err
	}
	if approval.SessionID != b.CurrentSessionID {
		return "", invalid("此审批属于旧会话，已失效")
	}
	view, err := s.agent.GetSession(ctx, approval.SessionID)
	if err != nil {
		return "", err
	}
	matched := false
	for _, task := range view.Tasks {
		if task.ID == approval.TaskID && task.Status == runtime.TaskStatusWaitingConfirm {
			digest, err := s.taskDigest(ctx, view.ID, task)
			if err != nil {
				return "", err
			}
			matched = digest == approval.Digest
			break
		}
	}
	if !matched {
		return "", invalid("任务状态或操作内容已变化，此审批已失效")
	}
	// Claim before execution. On a crash, projection rejects the still-pending
	// task instead of guessing whether approval dispatch already succeeded.
	result := s.db.WithContext(ctx).Model(&approval).Where("used_at IS NULL").Update("used_at", time.Now().UTC())
	if result.Error != nil {
		return "", result.Error
	}
	if result.RowsAffected != 1 {
		return "", invalid("审批已处理")
	}
	decision := runtime.DecisionReject
	if parts[1] == "yes" {
		decision = runtime.DecisionConfirm
	}
	return lastRequestID(view.Messages), s.agent.ConfirmTasks(ctx, approval.SessionID, []runtime.ConfirmTaskInput{{TaskID: approval.TaskID, Decision: decision}})
}

func lastRequestID(messages []aichatui.MessageView) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return messages[i].ID
		}
	}
	return ""
}

// project forwards new results of watched sessions. State advances before the
// replies are queued, so a restart can drop a reply but never repeats one.
func (s *Service) project(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var bindings []Binding
	if err := s.db.WithContext(ctx).Where("watching = ? AND revoked_at IS NULL", true).Limit(100).Find(&bindings).Error; err != nil {
		return err
	}
	for _, b := range bindings {
		var c Connection
		if err := s.db.WithContext(ctx).Where("id = ? AND enabled = ?", b.ConnectionID, true).First(&c).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return err
		}
		calls, err := s.projectBinding(ctx, c, b)
		if err != nil {
			return err
		}
		s.enqueue(c, calls)
	}
	return nil
}

func (s *Service) projectBinding(ctx context.Context, c Connection, b Binding) ([]outgoing, error) {
	boundCtx, err := s.bindingContext(ctx, c, b)
	if err != nil {
		return nil, nil
	}
	view, err := s.agent.GetSession(boundCtx, b.CurrentSessionID)
	if errors.Is(err, runtime.ErrSessionNotFound) || errors.Is(err, runtime.ErrSessionClosed) {
		return nil, s.db.WithContext(ctx).Model(&b).Update("watching", false).Error
	}
	if err != nil {
		return nil, err
	}
	if view.Status == runtime.SessionStatusRunning {
		return s.progressUpdate(ctx, b, view)
	}
	delete(s.progress, b.ID)
	var calls []outgoing
	requestID := ""
	send := func(text string, keyboard *telegramKeyboard) {
		replies := reply(b.chatAddress(), text, keyboard)
		if len(replies) > 0 {
			replies[0].bindingID = b.ID
			replies[0].resultRequestID = requestID
		}
		calls = append(calls, replies...)
	}
	// Messages past the stored count belong to the run that just settled.
	fresh := map[string]bool{}
	texts := 0
	for i, message := range view.Messages {
		if message.Role == "user" {
			requestID = message.ID
		}
		if i < b.MessageCount {
			continue
		}
		fresh[message.ID] = true
		if message.Role != "assistant" || strings.TrimSpace(message.Content) == "" {
			continue
		}
		send(assistantText(view.ID, message), nil)
		texts++
	}
	var approvals []Approval
	for _, task := range view.Tasks {
		if task.Status != runtime.TaskStatusWaitingConfirm {
			continue
		}
		var approval Approval
		err := s.db.WithContext(ctx).Where("session_id = ? AND task_id = ?", view.ID, task.ID).First(&approval).Error
		if err == nil {
			// Already offered: once the chat approval expired, or was claimed by an
			// interrupted confirmation, reject instead of guessing what happened.
			if approval.UsedAt != nil || !time.Now().Before(approval.ExpiresAt) {
				err := s.agent.ConfirmTasks(boundCtx, view.ID, []runtime.ConfirmTaskInput{{TaskID: task.ID, Decision: runtime.DecisionReject, Reason: "聊天审批已过期或处理被中断"}})
				if err == nil {
					send("一个待审批操作已过期或处理被中断，系统已拒绝执行。请查看 /status。", nil)
				} else if !errors.Is(err, runtime.ErrTaskConfirmationNotPending) && !errors.Is(err, runtime.ErrSessionBusy) {
					return nil, err
				}
			}
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		digest, err := s.taskDigest(boundCtx, view.ID, task)
		if err != nil {
			return nil, err
		}
		approval = Approval{ID: strings.ReplaceAll(uuid.NewString(), "-", ""), BindingID: b.ID, SessionID: view.ID, TaskID: task.ID, Digest: digest, ExpiresAt: time.Now().UTC().Add(10 * time.Minute)}
		approvals = append(approvals, approval)
		send(approvalText(view.ID, task, approval.ID))
	}
	watching := view.Status != runtime.SessionStatusIdle && view.Status != runtime.SessionStatusClosed
	if !watching {
		for _, task := range view.Tasks {
			if task.Status == runtime.TaskStatusUnknown && fresh[task.AssistantMessageID] {
				send(unknownText(view.ID, task), nil)
			}
		}
		if texts == 0 {
			send("本轮已结束，未生成新的文本回复。可在 EasySSH 网页打开此会话查看任务详情与错误。\n会话 ID："+view.ID, nil)
		}
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for i := range approvals {
			if err := tx.Create(&approvals[i]).Error; err != nil {
				return err
			}
		}
		return tx.Model(&b).Updates(map[string]any{"message_count": len(view.Messages), "watching": watching}).Error
	})
	if err != nil {
		return nil, err
	}
	return calls, nil
}

// The text builders below define what each chat platform receives; the transcript
// reuses them so both always show the same content.
func assistantText(sessionID string, message aichatui.MessageView) string {
	body := message.Content
	if message.StoppedAt != nil {
		body = "本轮已停止，以下是停止前已生成的内容：\n\n" + body
	}
	if len([]rune(body)) > 24000 {
		body = truncate(body, 24000) + "\n内容较长，请在 EasySSH 网页查看完整回复。\n会话 ID：" + sessionID
	}
	return body
}

func unknownText(sessionID string, task runtime.TaskView) string {
	return "操作结果未知，请先在网页核实远端实际状态，不要直接重复执行。\n操作：" + task.ToolName + "\n会话 ID：" + sessionID
}

func approvalText(sessionID string, task runtime.TaskView, approvalID string) (string, *telegramKeyboard) {
	arguments, _ := json.MarshalIndent(task.Arguments, "", "  ")
	body := "操作需要审批（10 分钟内有效）\n工具：" + task.ToolName + "\n参数：\n" + string(arguments)
	if task.File != nil {
		file, _ := json.MarshalIndent(task.File, "", "  ")
		body += "\n文件变更摘要：\n" + string(file) + "\n请先在网页查看完整文件差异，再决定是否批准。"
	}
	if len([]rune(body)) > 12000 {
		return "此操作的审批内容较长，请在 EasySSH 网页打开本会话，查看完整操作后审批。聊天审批将在 10 分钟后过期。\n会话 ID：" + sessionID, nil
	}
	return body, &telegramKeyboard{Buttons: [][]telegramButton{{{Text: "批准执行", Data: approvalID + ":yes"}, {Text: "拒绝", Data: approvalID + ":no"}}}}
}

const progressSteps = 6

// progressUpdate edits the run's status message when its step list changes.
// Called with s.mu held, once per projection tick; unchanged text sends nothing.
func (s *Service) progressUpdate(ctx context.Context, b Binding, view *runtime.SessionView) ([]outgoing, error) {
	requestID := lastRequestID(view.Messages)
	text, err := s.progressText(ctx, view, requestID)
	if err != nil || requestID == "" || s.progress[b.ID] == text {
		return nil, err
	}
	if s.progress == nil {
		s.progress = make(map[string]string)
	}
	s.progress[b.ID] = text
	return []outgoing{{bindingID: b.ID, method: "editMessageText", statusSessionID: view.ID, progressRequestID: requestID,
		payload: map[string]any{"chat_id": b.chatAddress(), "text": text, "link_preview_options": map[string]bool{"is_disabled": true}}}}, nil
}

func (s *Service) progressText(ctx context.Context, view *runtime.SessionView, requestID string) (string, error) {
	var started time.Time
	for _, message := range view.Messages {
		if message.ID == requestID {
			started = message.CreatedAt
		}
	}
	var tasks []runtime.TaskView
	serverIDs := []string{}
	for _, task := range view.Tasks {
		if task.CreatedAt.Before(started) {
			continue
		}
		tasks = append(tasks, task)
		if id, ok := task.Arguments["server_id"].(string); ok {
			serverIDs = append(serverIDs, id)
		}
	}
	names := map[string]string{}
	if len(serverIDs) != 0 {
		var rows []struct{ ID, Name, Host string }
		if err := s.db.WithContext(ctx).Table("servers").Select("id, COALESCE(name, '') AS name, host").Where("id IN ?", serverIDs).Scan(&rows).Error; err != nil {
			return "", err
		}
		for _, row := range rows {
			names[row.ID] = row.Name
			if strings.TrimSpace(row.Name) == "" {
				names[row.ID] = row.Host
			}
		}
	}
	header := "正在思考…"
	if len(tasks) != 0 {
		header = fmt.Sprintf("正在处理…（第 %d 步", len(tasks))
		if minutes := int(time.Since(started).Minutes()); minutes > 0 {
			header += fmt.Sprintf(" · 已运行 %d 分钟", minutes)
		}
		header += "）"
	} else if minutes := int(time.Since(started).Minutes()); minutes > 0 {
		header = fmt.Sprintf("正在思考…（已运行 %d 分钟）", minutes)
	}
	lines := []string{header}
	if hidden := len(tasks) - progressSteps; hidden > 0 {
		lines = append(lines, fmt.Sprintf("…前 %d 步已完成", hidden))
		tasks = tasks[hidden:]
	}
	for _, task := range tasks {
		line := progressIcon(task.Status) + " " + task.ToolDisplayName
		id, _ := task.Arguments["server_id"].(string)
		if name := names[id]; name != "" {
			line += " · " + name
		}
		if task.Summary != "" && task.Summary != id && task.Summary != task.ToolName {
			line += " · " + task.Summary
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n"), nil
}

func progressIcon(status runtime.TaskStatus) string {
	switch status {
	case runtime.TaskStatusSucceeded:
		return "✅"
	case runtime.TaskStatusFailed, runtime.TaskStatusUnknown:
		return "⚠️"
	case runtime.TaskStatusCancelled:
		return "⏹"
	case runtime.TaskStatusWaitingConfirm:
		return "⏸"
	default:
		return "⏳"
	}
}
