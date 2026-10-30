package taskscheduler

import (
	"context"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/domain/taskexecutor"
	"github.com/google/uuid"
	"github.com/robfig/cron/v3"
	"gorm.io/gorm"
)

// Scheduler 定时任务调度器
type DispatchNotifier interface{ NotifyEnqueued() }

type Scheduler struct {
	bodies      taskcenter.Bodies
	db          *gorm.DB
	ownerScope  func(context.Context, uuid.UUID) (access.Scope, error)
	cron        *cron.Cron
	taskRepo    scheduledtask.Repository
	queue       DispatchNotifier
	taskRuns    taskcenter.Service
	taskEntries map[uuid.UUID]cron.EntryID
	mu          sync.RWMutex
	ctx         context.Context
	cancel      context.CancelFunc
	started     atomic.Bool
	lifecycleMu sync.Mutex
}

// NewScheduler 创建调度器
func NewScheduler(
	db *gorm.DB,
	taskRepo scheduledtask.Repository,
	queue DispatchNotifier,
	taskRuns taskcenter.Service,
	ownerScope func(context.Context, uuid.UUID) (access.Scope, error),
	bodies taskcenter.Bodies,
) *Scheduler {
	ctx, cancel := context.WithCancel(context.Background())

	// 创建 cron 调度器（标准5字段格式: 分 时 日 月 周）
	c := cron.New(cron.WithParser(cron.NewParser(
		cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow,
	)))

	return &Scheduler{bodies: bodies,
		cron:       c,
		ownerScope: ownerScope, db: db,
		taskRepo:    taskRepo,
		queue:       queue,
		taskRuns:    taskRuns,
		taskEntries: make(map[uuid.UUID]cron.EntryID),
		ctx:         ctx,
		cancel:      cancel,
	}
}

// Start 启动调度器
func (s *Scheduler) Start() error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if s.started.Load() {
		return nil
	}
	if err := s.ctx.Err(); err != nil {
		return err
	}
	log.Println("[TaskScheduler] 启动定时任务调度器...")

	after := uuid.Nil
	total := 0
	for {
		tasks, err := s.taskRepo.GetEnabledTasks(s.ctx, after, 100)
		if err != nil {
			return fmt.Errorf("load enabled tasks: %w", err)
		}
		for i := range tasks {
			if err := s.addTask(&tasks[i]); err != nil {
				log.Printf("[TaskScheduler] 添加任务失败: taskID=%s, error=%v", tasks[i].ID, err)
			}
		}
		total += len(tasks)
		if len(tasks) < 100 {
			break
		}
		after = tasks[len(tasks)-1].ID
	}
	log.Printf("[TaskScheduler] 加载了 %d 个启用的定时任务", total)

	// 启动 cron 调度器
	s.cron.Start()
	s.started.Store(true)
	log.Println("[TaskScheduler] 调度器已启动")

	return nil
}

// Stop 停止调度器
func (s *Scheduler) Stop() {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.started.Store(false)
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
	s.started.Store(false)
}

// addTask 添加任务到调度器（内部方法）
func (s *Scheduler) addTask(task *scheduledtask.ScheduledTask) error {
	if err := s.ctx.Err(); err != nil {
		return err
	}
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
		return fmt.Errorf("invalid schedule timezone %q: %w", task.Timezone, err)
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
	schedule, err := cron.ParseStandard(scheduleExpression)
	if err != nil {
		s.cron.Remove(entryID)
		delete(s.taskEntries, task.ID)
		return err
	}
	nextRun := schedule.Next(time.Now()).In(loc)
	if err := s.taskRepo.UpdateRuntime(s.ctx, task.ID, map[string]interface{}{
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
	if _, err := s.enqueueTask(s.ctx, task, taskexecutor.TriggerSchedule, nil, 1, dedupeKey); err != nil {
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

	loc, err := time.LoadLocation(task.Timezone)
	if err != nil {
		return
	}

	nextRun := entry.Next.In(loc)
	s.taskRepo.UpdateRuntime(s.ctx, taskID, map[string]interface{}{
		"next_run_at": nextRun,
	})
}

// AddTask 动态添加任务（外部调用）
func (s *Scheduler) AddTask(task *scheduledtask.ScheduledTask) error {
	if !task.Enabled {
		return nil
	}
	if !s.started.Load() {
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
	if task.Enabled && s.started.Load() {
		return s.addTask(task)
	}
	return nil
}

// TriggerTaskManually 手动触发任务
func (s *Scheduler) TriggerTaskManually(ctx context.Context, taskID uuid.UUID) (uuid.UUID, error) {
	task, err := s.taskRepo.GetByID(taskID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("task not found: %w", err)
	}

	return s.enqueueTask(ctx, task, taskexecutor.TriggerManual, nil, 1, "")
}

func (s *Scheduler) RetryTask(ctx context.Context, taskID, retryOfID uuid.UUID, attempt int) (uuid.UUID, error) {
	task, err := s.taskRepo.GetByID(taskID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("task not found: %w", err)
	}
	if s.taskRuns == nil {
		return uuid.Nil, errors.New("task center is not initialized")
	}
	previous, err := s.taskRuns.Get(ctx, retryOfID)
	if err != nil {
		return uuid.Nil, err
	}
	if previous.DefinitionID == nil || *previous.DefinitionID != taskID || !previous.Retryable || !isTerminalRun(previous.Status) || previous.Status == taskcenter.StatusUnknown || previous.Status == taskcenter.StatusSucceeded || attempt != previous.Attempt+1 {
		return uuid.Nil, errors.New("task run cannot be retried; review its observed outcome first")
	}
	dedupeKey := fmt.Sprintf("retry:%s:%d", retryOfID, attempt)
	return s.enqueueTask(ctx, task, taskexecutor.TriggerManual, &retryOfID, attempt, dedupeKey)
}

func (s *Scheduler) enqueueTask(ctx context.Context, task *scheduledtask.ScheduledTask, trigger taskexecutor.TriggerType, retryOfID *uuid.UUID, attempt int, dedupeKey string) (uuid.UUID, error) {
	if s.queue == nil {
		return uuid.Nil, errors.New("job queue is not initialized")
	}
	if s.taskRuns == nil {
		return uuid.Nil, errors.New("task center is not initialized")
	}

	if trigger != taskexecutor.TriggerSchedule {
		scope := access.Current(ctx)
		if scope.Actor().ID != task.OwnerID.String() {
			return uuid.Nil, access.ErrForbidden
		}
		if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
			return uuid.Nil, err
		}
	}
	if s.ownerScope == nil {
		return uuid.Nil, access.ErrUnauthenticated
	}
	scope, err := s.ownerScope(ctx, task.OwnerID)
	if err != nil {
		return uuid.Nil, err
	}
	ctx = access.WithScope(ctx, scope)
	runID := uuid.New()
	if dedupeKey != "" {
		runID = uuid.NewSHA1(uuid.NameSpaceOID, []byte("easyssh:task-run:"+dedupeKey))
	}
	run, created, err := s.dispatch(ctx, task, runID, trigger, retryOfID, attempt)
	if err != nil {
		return uuid.Nil, err
	}
	if created {
		s.taskRuns.PublishCreated(run)
		s.queue.NotifyEnqueued()
	}
	return run.ID, nil
}

func taskRunDedupeKey(runID uuid.UUID) string {
	return "task-run:" + runID.String()
}

func isTerminalRun(status taskcenter.Status) bool {
	return status == taskcenter.StatusSucceeded || status == taskcenter.StatusFailed || status == taskcenter.StatusPartialSuccess ||
		status == taskcenter.StatusCanceled || status == taskcenter.StatusTimeout || status == taskcenter.StatusUnknown
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
	return s.started.Load()
}
