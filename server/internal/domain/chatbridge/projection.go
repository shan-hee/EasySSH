package chatbridge

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/runtime"
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

func (s *Service) confirm(ctx context.Context, b Binding, data string) error {
	parts := strings.Split(data, ":")
	if len(parts) != 2 || (parts[1] != "yes" && parts[1] != "no") {
		return invalid("审批按钮无效")
	}
	var approval Approval
	if err := s.db.WithContext(ctx).Where("id = ? AND binding_id = ? AND used_at IS NULL AND expires_at > ?", parts[0], b.ID, time.Now().UTC()).First(&approval).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return invalid("审批已处理或过期，请查看当前会话")
		}
		return err
	}
	if approval.SessionID != b.CurrentSessionID {
		return invalid("此审批属于旧会话，已失效")
	}
	view, err := s.agent.GetSession(ctx, approval.SessionID)
	if err != nil {
		return err
	}
	matched := false
	for _, task := range view.Tasks {
		if task.ID == approval.TaskID && task.Status == runtime.TaskStatusWaitingConfirm {
			digest, err := s.taskDigest(ctx, view.ID, task)
			if err != nil {
				return err
			}
			matched = digest == approval.Digest
			break
		}
	}
	if !matched {
		return invalid("任务状态或操作内容已变化，此审批已失效")
	}
	// Claim before execution. On a crash, projection rejects the still-pending
	// task instead of guessing whether approval dispatch already succeeded.
	result := s.db.WithContext(ctx).Model(&approval).Where("used_at IS NULL").Update("used_at", time.Now().UTC())
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return invalid("审批已处理")
	}
	decision := runtime.DecisionReject
	if parts[1] == "yes" {
		decision = runtime.DecisionConfirm
	}
	return s.agent.ConfirmTasks(ctx, approval.SessionID, []runtime.ConfirmTaskInput{{TaskID: approval.TaskID, Decision: decision}})
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
	if err != nil || view.Status == runtime.SessionStatusRunning {
		return nil, err
	}
	var calls []outgoing
	send := func(text string, keyboard *telegramKeyboard) {
		calls = append(calls, reply(b.ChatID, text, keyboard)...)
	}
	// Messages past the stored count belong to the run that just settled.
	fresh := map[string]bool{}
	texts := 0
	for _, message := range view.Messages[min(b.MessageCount, len(view.Messages)):] {
		fresh[message.ID] = true
		if message.Role != "assistant" || strings.TrimSpace(message.Content) == "" {
			continue
		}
		body := message.Content
		if message.StoppedAt != nil {
			body = "本轮已停止，以下是停止前已生成的内容：\n\n" + body
		}
		if len([]rune(body)) > 24000 {
			body = truncate(body, 24000) + "\n内容较长，请在 EasySSH 网页查看完整回复。\n会话 ID：" + view.ID
		}
		send(body, nil)
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
				send("操作结果未知，请先在网页核实远端实际状态，不要直接重复执行。\n操作："+task.ToolName+"\n会话 ID："+view.ID, nil)
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
