package taskscheduler

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/domain/taskexecutor"
	"github.com/google/uuid"
	"github.com/robfig/cron/v3"
)

// Scheduler 定时任务调度器
type Scheduler struct {
	cron        *cron.Cron
	taskRepo    scheduledtask.Repository
	queue       jobqueue.Enqueuer
	taskRuns    taskcenter.Service
	taskEntries map[uuid.UUID]cron.EntryID
	mu          sync.RWMutex
	enqueueMu   sync.Mutex
	ctx         context.Context
	cancel      context.CancelFunc
	started     bool
}

// NewScheduler 创建调度器
func NewScheduler(
	taskRepo scheduledtask.Repository,
	queue jobqueue.Enqueuer,
	taskRuns taskcenter.Service,
) *Scheduler {
	ctx, cancel := context.WithCancel(context.Background())

	// 创建 cron 调度器（标准5字段格式: 分 时 日 月 周）
	c := cron.New(cron.WithParser(cron.NewParser(
		cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow,
	)))

	return &Scheduler{
		cron:        c,
		taskRepo:    taskRepo,
		queue:       queue,
		taskRuns:    taskRuns,
		taskEntries: make(map[uuid.UUID]cron.EntryID),
		ctx:         ctx,
		cancel:      cancel,
		started:     false,
	}
}

// Start 启动调度器
func (s *Scheduler) Start() error {
	log.Println("[TaskScheduler] 启动定时任务调度器...")
	if err := s.recoverQueuedRuns(); err != nil {
		return fmt.Errorf("recover queued task runs: %w", err)
	}

	// 加载所有启用的任务
	tasks, err := s.taskRepo.GetEnabledTasks()
	if err != nil {
		return fmt.Errorf("failed to load enabled tasks: %w", err)
	}

	log.Printf("[TaskScheduler] 加载了 %d 个启用的定时任务", len(tasks))

	// 添加所有任务到调度器
	for _, task := range tasks {
		taskCopy := task // 避免闭包问题
		if err := s.addTask(&taskCopy); err != nil {
			log.Printf("[TaskScheduler] 添加任务失败: taskID=%s, name=%s, error=%v",
				task.ID, task.TaskName, err)
			continue
		}
	}

	// 启动 cron 调度器
	s.cron.Start()
	s.started = true
	log.Println("[TaskScheduler] 调度器已启动")

	return nil
}

// Stop 停止调度器
func (s *Scheduler) Stop() {
	log.Println("[TaskScheduler] 停止定时任务调度器...")
	s.cancel()

	if s.cron != nil {
		// 等待所有任务完成，最多等待30秒
		ctx := s.cron.Stop()
		select {
		case <-ctx.Done():
			log.Println("[TaskScheduler] 所有任务已完成")
		case <-time.After(30 * time.Second):
			log.Println("[TaskScheduler] 等待超时，强制停止")
		}
	}
	s.started = false
}

// addTask 添加任务到调度器（内部方法）
func (s *Scheduler) addTask(task *scheduledtask.ScheduledTask) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 如果已存在，先移除
	if entryID, exists := s.taskEntries[task.ID]; exists {
		s.cron.Remove(entryID)
		delete(s.taskEntries, task.ID)
	}

	// 加载时区
	loc, err := time.LoadLocation(task.Timezone)
	if err != nil {
		log.Printf("[TaskScheduler] 无法加载时区 %s，使用UTC: %v", task.Timezone, err)
		loc = time.UTC
	}
	scheduleExpression := fmt.Sprintf("CRON_TZ=%s %s", loc.String(), task.CronExpression)

	// 创建任务执行函数
	taskID := task.ID
	entryID, err := s.cron.AddFunc(scheduleExpression, func() {
		s.executeTask(taskID)
	})
	if err != nil {
		return fmt.Errorf("failed to add cron job: %w", err)
	}

	s.taskEntries[task.ID] = entryID

	// 计算并更新下次运行时间
	entry := s.cron.Entry(entryID)
	nextRun := entry.Next.In(loc)
	if err := s.taskRepo.Update(task.ID, map[string]interface{}{
		"next_run_at": nextRun,
	}); err != nil {
		log.Printf("[TaskScheduler] 更新下次运行时间失败: %v", err)
	}

	log.Printf("[TaskScheduler] 任务已添加: taskID=%s, name=%s, cron=%s, nextRun=%s",
		task.ID, task.TaskName, task.CronExpression, nextRun.Format(time.RFC3339))

	return nil
}

// executeTask 执行任务
func (s *Scheduler) executeTask(taskID uuid.UUID) {
	log.Printf("[TaskScheduler] 触发任务执行: taskID=%s", taskID)

	// 获取最新的任务配置
	task, err := s.taskRepo.GetByID(taskID)
	if err != nil {
		log.Printf("[TaskScheduler] 获取任务失败: taskID=%s, error=%v", taskID, err)
		return
	}

	// 检查任务是否仍然启用
	if !task.Enabled {
		log.Printf("[TaskScheduler] 任务已禁用，跳过执行: taskID=%s", taskID)
		return
	}

	// 更新下次运行时间
	s.updateNextRunTime(taskID)

	dedupeKey := fmt.Sprintf("scheduled:%s:%s", task.ID, time.Now().UTC().Truncate(time.Minute).Format(time.RFC3339))
	if _, err := s.enqueueTask(task, taskexecutor.TriggerSchedule, nil, 1, dedupeKey); err != nil {
		log.Printf("[TaskScheduler] 任务入队失败: taskID=%s, error=%v", taskID, err)
	}
}

// updateNextRunTime 更新下次运行时间
func (s *Scheduler) updateNextRunTime(taskID uuid.UUID) {
	s.mu.RLock()
	entryID, exists := s.taskEntries[taskID]
	s.mu.RUnlock()

	if !exists {
		return
	}

	entry := s.cron.Entry(entryID)
	if entry.ID == 0 {
		return
	}

	task, err := s.taskRepo.GetByID(taskID)
	if err != nil {
		return
	}

	loc, _ := time.LoadLocation(task.Timezone)
	if loc == nil {
		loc = time.UTC
	}

	nextRun := entry.Next.In(loc)
	s.taskRepo.Update(taskID, map[string]interface{}{
		"next_run_at": nextRun,
	})
}

// AddTask 动态添加任务（外部调用）
func (s *Scheduler) AddTask(task *scheduledtask.ScheduledTask) error {
	if !task.Enabled {
		return nil
	}
	if !s.started {
		return nil // 调度器未启动，不添加
	}
	return s.addTask(task)
}

// RemoveTask 移除任务
func (s *Scheduler) RemoveTask(taskID uuid.UUID) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if entryID, exists := s.taskEntries[taskID]; exists {
		s.cron.Remove(entryID)
		delete(s.taskEntries, taskID)
		log.Printf("[TaskScheduler] 任务已移除: taskID=%s", taskID)
	}
}

// UpdateTask 更新任务（移除后重新添加）
func (s *Scheduler) UpdateTask(task *scheduledtask.ScheduledTask) error {
	s.RemoveTask(task.ID)
	if task.Enabled && s.started {
		return s.addTask(task)
	}
	return nil
}

// TriggerTaskManually 手动触发任务
func (s *Scheduler) TriggerTaskManually(taskID uuid.UUID) (uuid.UUID, error) {
	task, err := s.taskRepo.GetByID(taskID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("task not found: %w", err)
	}

	return s.enqueueTask(task, taskexecutor.TriggerManual, nil, 1, "")
}

func (s *Scheduler) RetryTask(taskID, retryOfID uuid.UUID, attempt int) (uuid.UUID, error) {
	task, err := s.taskRepo.GetByID(taskID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("task not found: %w", err)
	}
	if attempt < 2 {
		attempt = 2
	}
	dedupeKey := fmt.Sprintf("retry:%s:%d", retryOfID, attempt)
	return s.enqueueTask(task, taskexecutor.TriggerManual, &retryOfID, attempt, dedupeKey)
}

func (s *Scheduler) enqueueTask(task *scheduledtask.ScheduledTask, trigger taskexecutor.TriggerType, retryOfID *uuid.UUID, attempt int, dedupeKey string) (uuid.UUID, error) {
	if s.queue == nil {
		return uuid.Nil, errors.New("job queue is not initialized")
	}
	if s.taskRuns == nil {
		return uuid.Nil, errors.New("task center is not initialized")
	}

	s.enqueueMu.Lock()
	defer s.enqueueMu.Unlock()

	runID := uuid.New()
	if dedupeKey != "" {
		runID = uuid.NewSHA1(uuid.NameSpaceOID, []byte("easyssh:task-run:"+dedupeKey))
	}
	run, err := s.taskRuns.Get(s.ctx, task.UserID, runID)
	if err == nil && isTerminalRun(run.Status) {
		return runID, nil
	}
	if err != nil && !errors.Is(err, taskcenter.ErrNotFound) {
		return uuid.Nil, fmt.Errorf("load task run: %w", err)
	}
	if errors.Is(err, taskcenter.ErrNotFound) {
		triggerType := taskcenter.TriggerManual
		if trigger == taskexecutor.TriggerSchedule {
			triggerType = taskcenter.TriggerScheduled
		}
		definitionID := task.ID
		run = &taskcenter.TaskRun{
			ID: runID, UserID: task.UserID, DefinitionID: &definitionID, RetryOfID: retryOfID,
			SourceType: string(taskexecutor.SourceScheduledTask), SourceID: task.ID.String(), TaskType: task.TaskType,
			Title: task.TaskName, Description: task.Description, TriggerType: triggerType, Runner: "server",
			Status: taskcenter.StatusQueued, Resource: strings.Join(task.ServerIDs, ","), PayloadJSON: task.PayloadJSON,
			Cancelable: !isTransferTask(task.TaskType), Retryable: true, Attempt: attempt, MaxAttempts: attempt,
		}
		if err := s.taskRuns.Create(s.ctx, run); err != nil {
			return uuid.Nil, fmt.Errorf("create task run: %w", err)
		}
	}

	_, err = s.queue.Enqueue(s.ctx, taskexecutor.QueueJobKind, "task_run", runID.String(), taskexecutor.QueuePayload{
		RunID: runID, TaskID: task.ID, Trigger: trigger, Source: taskexecutor.SourceScheduledTask,
		RetryOfID: retryOfID, Attempt: attempt,
	}, jobqueue.EnqueueOptions{MaxAttempts: 3, DedupeKey: taskRunDedupeKey(runID)})
	if err != nil {
		completeErr := s.taskRuns.Complete(s.ctx, runID, taskcenter.StatusFailed, "", "enqueue_failed", err.Error(), 0, 0)
		if completeErr != nil {
			log.Printf("[TaskScheduler] 标记入队失败任务失败: runID=%s, error=%v", runID, completeErr)
		}
		return runID, fmt.Errorf("enqueue task run: %w", err)
	}
	return runID, nil
}

func (s *Scheduler) recoverQueuedRuns() error {
	if s.queue == nil || s.taskRuns == nil {
		return errors.New("task queue dependencies are not initialized")
	}
	runs, err := s.taskRuns.ListActive(s.ctx)
	if err != nil {
		return err
	}
	for i := range runs {
		run := &runs[i]
		if run.SourceType != string(taskexecutor.SourceScheduledTask) || run.Status != taskcenter.StatusQueued {
			continue
		}
		if run.DefinitionID == nil {
			if err := s.taskRuns.Complete(s.ctx, run.ID, taskcenter.StatusFailed, "", "definition_missing", "排队任务缺少定时任务定义", 0, 0); err != nil {
				return err
			}
			continue
		}
		task, err := s.taskRepo.GetByID(*run.DefinitionID)
		if err != nil {
			if completeErr := s.taskRuns.Complete(s.ctx, run.ID, taskcenter.StatusFailed, "", "task_definition_unavailable", err.Error(), 0, 0); completeErr != nil {
				return completeErr
			}
			continue
		}
		trigger := taskexecutor.TriggerManual
		if run.TriggerType == taskcenter.TriggerScheduled {
			trigger = taskexecutor.TriggerSchedule
		}
		job, err := s.queue.Enqueue(s.ctx, taskexecutor.QueueJobKind, "task_run", run.ID.String(), taskexecutor.QueuePayload{
			RunID: run.ID, TaskID: task.ID, Trigger: trigger, Source: taskexecutor.SourceScheduledTask,
			RetryOfID: run.RetryOfID, Attempt: run.Attempt,
		}, jobqueue.EnqueueOptions{MaxAttempts: 3, DedupeKey: taskRunDedupeKey(run.ID)})
		if err != nil {
			if completeErr := s.taskRuns.Complete(s.ctx, run.ID, taskcenter.StatusFailed, "", "queue_recovery_failed", err.Error(), 0, 0); completeErr != nil {
				return completeErr
			}
			continue
		}
		switch job.Status {
		case jobqueue.StatusFailed:
			message := job.LastError
			if message == "" {
				message = "持久队列任务已失败"
			}
			if err := s.taskRuns.Complete(s.ctx, run.ID, taskcenter.StatusFailed, "", "queue_failed", message, 0, 0); err != nil {
				return err
			}
		case jobqueue.StatusCancelled:
			if err := s.taskRuns.Complete(s.ctx, run.ID, taskcenter.StatusCanceled, "", "", "持久队列任务已取消", 0, 0); err != nil {
				return err
			}
		case jobqueue.StatusSucceeded:
			if err := s.taskRuns.Complete(s.ctx, run.ID, taskcenter.StatusFailed, "", "queue_state_inconsistent", "任务运行状态与持久队列状态不一致", 0, 0); err != nil {
				return err
			}
		}
	}
	return nil
}

func taskRunDedupeKey(runID uuid.UUID) string {
	return "task-run:" + runID.String()
}

func isTerminalRun(status taskcenter.Status) bool {
	return status == taskcenter.StatusSucceeded || status == taskcenter.StatusFailed || status == taskcenter.StatusPartialSuccess ||
		status == taskcenter.StatusCanceled || status == taskcenter.StatusTimeout
}

func isTransferTask(taskType string) bool {
	return taskType == "sftp_upload" || taskType == "sftp_download"
}

// GetTaskStatus 获取任务调度状态
func (s *Scheduler) GetTaskStatus(taskID uuid.UUID) (nextRun time.Time, isScheduled bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entryID, exists := s.taskEntries[taskID]
	if !exists {
		return time.Time{}, false
	}

	entry := s.cron.Entry(entryID)
	return entry.Next, true
}

// GetScheduledTaskCount 获取已调度的任务数量
func (s *Scheduler) GetScheduledTaskCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.taskEntries)
}

// IsStarted 检查调度器是否已启动
func (s *Scheduler) IsStarted() bool {
	return s.started
}
