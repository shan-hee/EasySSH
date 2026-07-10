package inboxnotification

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/notification"
	"github.com/easyssh/server/internal/domain/notificationconfig"
	"github.com/easyssh/server/internal/domain/realtime"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/google/uuid"
)

const (
	deliveryPollInterval = 3 * time.Second
	deliveryLease        = 2 * time.Minute
	deliveryBatchSize    = 20
	deliveryConcurrency  = 4
)

type Service interface {
	taskcenter.CompletionNotifier
	Create(ctx context.Context, item *Notification) error
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	MarkRead(ctx context.Context, userID, id uuid.UUID) error
	MarkAllRead(ctx context.Context, userID uuid.UUID) error
	Delete(ctx context.Context, userID, id uuid.UUID) error
	ClearRead(ctx context.Context, userID uuid.UUID) error
	Start(ctx context.Context)
	Stop()
}

type service struct {
	repo    Repository
	users   auth.Repository
	configs notificationconfig.Service
	email   notification.EmailService
	events  *realtime.Hub

	workerMu     sync.Mutex
	workerCancel context.CancelFunc
	workerWG     sync.WaitGroup
	wake         chan struct{}
}

type deliveryPayload struct {
	Username     string           `json:"username"`
	Email        string           `json:"email"`
	Notification Notification     `json:"notification"`
	Task         deliveryTaskView `json:"task"`
}

type deliveryTaskView struct {
	ID           uuid.UUID         `json:"id"`
	TaskType     string            `json:"task_type"`
	Title        string            `json:"title"`
	Status       taskcenter.Status `json:"status"`
	Resource     string            `json:"resource,omitempty"`
	SuccessCount int               `json:"success_count"`
	FailureCount int               `json:"failure_count"`
	ErrorMessage string            `json:"error_message,omitempty"`
	StartedAt    *time.Time        `json:"started_at,omitempty"`
	FinishedAt   *time.Time        `json:"finished_at,omitempty"`
}

func NewService(repo Repository, users auth.Repository, configs notificationconfig.Service, email notification.EmailService, events *realtime.Hub) Service {
	return &service{repo: repo, users: users, configs: configs, email: email, events: events, wake: make(chan struct{}, 1)}
}

func (s *service) Create(ctx context.Context, item *Notification) error {
	if err := s.repo.Create(ctx, item); err != nil {
		return err
	}
	s.publish("notification.created", item.UserID, map[string]interface{}{"notification_id": item.ID})
	return nil
}
func (s *service) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	return s.repo.List(ctx, req)
}
func (s *service) MarkRead(ctx context.Context, userID, id uuid.UUID) error {
	if err := s.repo.MarkRead(ctx, userID, id); err != nil {
		return err
	}
	s.publish("notification.changed", userID, map[string]interface{}{"notification_id": id, "action": "read"})
	return nil
}
func (s *service) MarkAllRead(ctx context.Context, userID uuid.UUID) error {
	if err := s.repo.MarkAllRead(ctx, userID); err != nil {
		return err
	}
	s.publish("notification.changed", userID, map[string]interface{}{"action": "read_all"})
	return nil
}
func (s *service) Delete(ctx context.Context, userID, id uuid.UUID) error {
	if err := s.repo.Delete(ctx, userID, id); err != nil {
		return err
	}
	s.publish("notification.changed", userID, map[string]interface{}{"notification_id": id, "action": "delete"})
	return nil
}
func (s *service) ClearRead(ctx context.Context, userID uuid.UUID) error {
	if err := s.repo.ClearRead(ctx, userID); err != nil {
		return err
	}
	s.publish("notification.changed", userID, map[string]interface{}{"action": "clear_read"})
	return nil
}

func (s *service) Start(ctx context.Context) {
	s.workerMu.Lock()
	defer s.workerMu.Unlock()
	if s.workerCancel != nil {
		return
	}
	workerCtx, cancel := context.WithCancel(ctx)
	s.workerCancel = cancel
	s.workerWG.Add(1)
	go s.runWorker(workerCtx)
}

func (s *service) Stop() {
	s.workerMu.Lock()
	cancel := s.workerCancel
	s.workerCancel = nil
	s.workerMu.Unlock()
	if cancel == nil {
		return
	}
	cancel()
	s.workerWG.Wait()
}

func (s *service) NotifyTaskFinished(ctx context.Context, run *taskcenter.TaskRun) error {
	user, err := s.users.FindByID(ctx, run.UserID)
	if err != nil {
		return err
	}
	if !shouldNotifyTask(user, run.Status) || (!user.NotifyTaskInApp && !user.NotifyTaskExternal) {
		return nil
	}
	severity, eventType, title := taskNotificationMeta(run)
	message := taskNotificationMessage(run)
	data, _ := json.Marshal(map[string]interface{}{
		"task_id": run.ID, "task_type": run.TaskType, "status": run.Status,
		"resource": run.Resource, "success_count": run.SuccessCount, "failure_count": run.FailureCount,
	})
	now := time.Now()
	item := &Notification{
		ID: uuid.New(), UserID: run.UserID, EventType: eventType, Severity: severity, Title: title, Message: message,
		SourceType: "task_run", SourceID: run.ID.String(), ActionURL: "/dashboard/tasks?run=" + run.ID.String(), DataJSON: string(data), CreatedAt: now,
	}
	deliveries, err := s.buildExternalDeliveries(ctx, user, item, run)
	if err != nil {
		return err
	}
	if err := s.repo.CreateNotificationAndDeliveries(ctx, item, user.NotifyTaskInApp, deliveries); err != nil {
		return err
	}
	if len(deliveries) > 0 {
		s.signalWorker()
	}
	if user.NotifyTaskInApp {
		s.publish("notification.created", run.UserID, map[string]interface{}{"notification_id": item.ID, "task_id": run.ID})
	}
	return nil
}

func (s *service) publish(eventType string, userID uuid.UUID, payload interface{}) {
	if s.events != nil {
		s.events.Publish(userID, eventType, payload)
	}
}

func (s *service) buildExternalDeliveries(ctx context.Context, user *auth.User, item *Notification, run *taskcenter.TaskRun) ([]*Delivery, error) {
	if !user.NotifyTaskExternal {
		return nil, nil
	}
	channels := s.configuredChannels(ctx, user.Email != "")
	if len(channels) == 0 {
		return nil, nil
	}
	payloadJSON, err := json.Marshal(deliveryPayload{
		Username:     user.Username,
		Email:        user.Email,
		Notification: *item,
		Task: deliveryTaskView{
			ID: run.ID, TaskType: run.TaskType, Title: run.Title, Status: run.Status, Resource: run.Resource,
			SuccessCount: run.SuccessCount, FailureCount: run.FailureCount, ErrorMessage: run.ErrorMessage,
			StartedAt: run.StartedAt, FinishedAt: run.FinishedAt,
		},
	})
	if err != nil {
		return nil, err
	}
	deliveries := make([]*Delivery, 0, len(channels))
	for _, channel := range channels {
		deliveries = append(deliveries, &Delivery{
			NotificationID: item.ID,
			UserID:         user.ID,
			Channel:        channel,
			Status:         "queued",
			PayloadJSON:    string(payloadJSON),
			MaxAttempts:    5,
			NextAttemptAt:  time.Now(),
		})
	}
	return deliveries, nil
}

func (s *service) configuredChannels(ctx context.Context, hasEmail bool) []string {
	channels := make([]string, 0, 4)
	emailEnabled := s.email != nil
	if s.configs == nil {
		if emailEnabled && hasEmail {
			channels = append(channels, "email")
		}
		return channels
	}
	config, err := s.configs.GetAllConfig(ctx)
	if err != nil {
		log.Printf("[NotificationQueue] 读取外部通知配置失败: %v", err)
		if emailEnabled && hasEmail {
			channels = append(channels, "email")
		}
		return channels
	}
	emailEnabled = config != nil && config.SMTP != nil && config.SMTP.Enabled
	if emailEnabled && hasEmail {
		channels = append(channels, "email")
	}
	if config != nil && config.Webhook != nil && config.Webhook.Enabled {
		channels = append(channels, "webhook")
	}
	if config != nil && config.DingTalk != nil && config.DingTalk.Enabled {
		channels = append(channels, "dingtalk")
	}
	if config != nil && config.WeCom != nil && config.WeCom.Enabled {
		channels = append(channels, "wecom")
	}
	return channels
}

func shouldNotifyTask(user *auth.User, status taskcenter.Status) bool {
	switch status {
	case taskcenter.StatusSucceeded:
		return user.NotifyTaskSuccess
	case taskcenter.StatusPartialSuccess:
		return user.NotifyTaskPartial
	case taskcenter.StatusFailed, taskcenter.StatusTimeout:
		return user.NotifyTaskFailure
	default:
		return false
	}
}

func taskNotificationMeta(run *taskcenter.TaskRun) (string, string, string) {
	switch run.Status {
	case taskcenter.StatusSucceeded:
		return "success", "task.succeeded", "任务执行成功"
	case taskcenter.StatusPartialSuccess:
		return "warning", "task.partial_success", "任务部分成功"
	default:
		return "error", "task.failed", "任务执行失败"
	}
}

func taskNotificationMessage(run *taskcenter.TaskRun) string {
	message := run.Title
	if run.Resource != "" {
		message += " · " + run.Resource
	}
	if run.ErrorMessage != "" {
		message += "：" + run.ErrorMessage
	}
	if run.Status == taskcenter.StatusPartialSuccess {
		message += fmt.Sprintf("（成功 %d，失败 %d）", run.SuccessCount, run.FailureCount)
	}
	return message
}

func (s *service) signalWorker() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *service) runWorker(ctx context.Context) {
	defer s.workerWG.Done()
	ticker := time.NewTicker(deliveryPollInterval)
	defer ticker.Stop()
	for {
		s.processDueDeliveries(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.wake:
		}
	}
}

func (s *service) processDueDeliveries(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	now := time.Now()
	deliveries, err := s.repo.ClaimDueDeliveries(ctx, now, now.Add(-deliveryLease), deliveryBatchSize)
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("[NotificationQueue] 获取待投递通知失败: %v", err)
		}
		return
	}
	semaphore := make(chan struct{}, deliveryConcurrency)
	var wg sync.WaitGroup
	for i := range deliveries {
		delivery := deliveries[i]
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				return
			}
			s.processDelivery(ctx, &delivery)
		}()
	}
	wg.Wait()
}

func (s *service) processDelivery(workerCtx context.Context, delivery *Delivery) {
	ctx, cancel := context.WithTimeout(workerCtx, 30*time.Second)
	err := s.deliver(ctx, delivery)
	cancel()

	updateCtx, updateCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer updateCancel()
	updates := map[string]interface{}{"locked_at": nil}
	if err == nil {
		now := time.Now()
		updates["status"] = "sent"
		updates["sent_at"] = &now
		updates["error_message"] = ""
	} else if delivery.AttemptCount >= delivery.MaxAttempts {
		updates["status"] = "failed"
		updates["error_message"] = err.Error()
	} else {
		updates["status"] = "queued"
		updates["next_attempt_at"] = time.Now().Add(deliveryRetryDelay(delivery.AttemptCount))
		updates["error_message"] = err.Error()
	}
	if updateErr := s.repo.UpdateDelivery(updateCtx, delivery.ID, updates); updateErr != nil {
		log.Printf("[NotificationQueue] 更新投递状态失败: deliveryID=%d, error=%v", delivery.ID, updateErr)
	}
}

func deliveryRetryDelay(attempt int) time.Duration {
	delays := []time.Duration{30 * time.Second, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute}
	if attempt < 1 {
		return delays[0]
	}
	if attempt > len(delays) {
		return delays[len(delays)-1]
	}
	return delays[attempt-1]
}

func (s *service) deliver(ctx context.Context, delivery *Delivery) error {
	var payload deliveryPayload
	if err := json.Unmarshal([]byte(delivery.PayloadJSON), &payload); err != nil {
		return fmt.Errorf("解析通知投递数据失败: %w", err)
	}
	content := fmt.Sprintf("【EasySSH】%s\n%s", payload.Notification.Title, payload.Notification.Message)
	switch delivery.Channel {
	case "email":
		emailService, err := s.currentEmailService(ctx)
		if err != nil {
			return err
		}
		if payload.Email == "" {
			return fmt.Errorf("用户邮箱为空")
		}
		return emailService.SendAlertNotification(ctx, payload.Email, payload.Username, payload.Notification.Title, payload.Notification.Message, payload.Notification.CreatedAt)
	case "webhook":
		if s.configs == nil {
			return fmt.Errorf("Webhook 配置服务不可用")
		}
		config, err := s.configs.GetWebhookConfig(ctx)
		if err != nil {
			return err
		}
		if config == nil || !config.Enabled {
			return fmt.Errorf("Webhook 渠道未启用")
		}
		client, err := notification.NewWebhookService(&notification.WebhookConfig{URL: config.URL, Secret: config.Secret, Method: strings.ToUpper(config.Method)})
		if err != nil {
			return err
		}
		return client.SendNotification(ctx, payload.Notification.EventType, map[string]interface{}{
			"event_id": delivery.NotificationID, "notification": payload.Notification, "task": payload.Task,
		})
	case "dingtalk":
		if s.configs == nil {
			return fmt.Errorf("钉钉配置服务不可用")
		}
		config, err := s.configs.GetDingTalkConfig(ctx)
		if err != nil {
			return err
		}
		if config == nil || !config.Enabled {
			return fmt.Errorf("钉钉渠道未启用")
		}
		client, err := notification.NewDingTalkService(&notification.DingTalkConfig{WebhookURL: config.WebhookURL, Secret: config.Secret})
		if err != nil {
			return err
		}
		return client.SendTextMessage(ctx, content)
	case "wecom":
		if s.configs == nil {
			return fmt.Errorf("企业微信配置服务不可用")
		}
		config, err := s.configs.GetWeComConfig(ctx)
		if err != nil {
			return err
		}
		if config == nil || !config.Enabled {
			return fmt.Errorf("企业微信渠道未启用")
		}
		client, err := notification.NewWeComService(&notification.WeComConfig{WebhookURL: config.WebhookURL})
		if err != nil {
			return err
		}
		return client.SendTextMessage(ctx, content)
	default:
		return fmt.Errorf("不支持的通知渠道: %s", delivery.Channel)
	}
}

func (s *service) currentEmailService(ctx context.Context) (notification.EmailService, error) {
	if s.configs == nil {
		if s.email == nil {
			return nil, fmt.Errorf("邮件渠道未启用")
		}
		return s.email, nil
	}
	config, err := s.configs.GetSMTPConfig(ctx)
	if err != nil {
		return nil, err
	}
	if config == nil || !config.Enabled {
		return nil, fmt.Errorf("邮件渠道未启用")
	}
	return notification.NewEmailService(&notification.EmailConfig{
		SMTPHost: config.Host, SMTPPort: config.Port, SMTPUsername: config.Username, SMTPPassword: config.Password,
		FromEmail: config.FromEmail, FromName: config.FromName, UseTLS: config.UseTLS, SystemName: "EasySSH", CurrentYear: time.Now().Year(),
	})
}
