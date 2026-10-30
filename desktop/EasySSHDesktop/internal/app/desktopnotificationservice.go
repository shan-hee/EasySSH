package app

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/resultstore"
	"github.com/easyssh/shared/taskprotocol"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type DesktopNotification struct {
	ID         string `json:"id"`
	EventType  string `json:"event_type"`
	Severity   string `json:"severity"`
	Title      string `json:"title"`
	Message    string `json:"message"`
	SourceType string `json:"source_type,omitempty"`
	SourceID   string `json:"source_id,omitempty"`
	ActionURL  string `json:"action_url,omitempty"`
	ReadAt     string `json:"read_at,omitempty"`
	CreatedAt  string `json:"created_at"`
}

type DesktopNotificationList struct {
	Notifications []DesktopNotification `json:"notifications"`
	UnreadCount   int                   `json:"unread_count"`
}

type DesktopNotificationService struct {
	mu     sync.Mutex
	tray   *application.SystemTray
	db     *sql.DB
	closed bool
}

func NewDesktopNotificationService() *DesktopNotificationService {
	return &DesktopNotificationService{}
}
func (s *DesktopNotificationService) ServiceStartup(context.Context, application.ServiceOptions) error {
	_, err := s.database()
	return err
}
func (s *DesktopNotificationService) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}
func (s *DesktopNotificationService) database() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, errors.New("notification service is shut down")
	}
	if s.db != nil {
		return s.db, nil
	}
	directory := desktopDataDir()
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(directory, "easyssh-desktop.sqlite"))
	if err != nil {
		return nil, err
	}
	if err = configureDesktopDatabase(db); err != nil {
		db.Close()
		return nil, err
	}
	s.db = db
	return db, nil
}

func (s *DesktopNotificationService) List(limit int) (DesktopNotificationList, error) {
	db, err := s.database()
	if err != nil {
		return DesktopNotificationList{}, err
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return DesktopNotificationList{}, err
	}
	defer tx.Rollback()
	result := DesktopNotificationList{Notifications: []DesktopNotification{}}
	if err := tx.QueryRow(`SELECT COUNT(*) FROM desktop_notifications WHERE read_at=''`).Scan(&result.UnreadCount); err != nil {
		return result, err
	}
	rows, err := tx.Query(`SELECT id,event_type,severity,title,message,source_type,source_id,action_url,read_at,created_at FROM desktop_notifications ORDER BY created_at DESC,id DESC LIMIT ?`, limit)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var item DesktopNotification
		if err := rows.Scan(&item.ID, &item.EventType, &item.Severity, &item.Title, &item.Message, &item.SourceType, &item.SourceID, &item.ActionURL, &item.ReadAt, &item.CreatedAt); err != nil {
			rows.Close()
			return result, err
		}
		result.Notifications = append(result.Notifications, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	return result, tx.Commit()
}

func (s *DesktopNotificationService) MarkRead(id string) error {
	return s.update(`UPDATE desktop_notifications SET read_at=? WHERE id=? AND read_at=''`, desktopTaskNow(), id)
}
func (s *DesktopNotificationService) MarkAllRead() error {
	return s.update(`UPDATE desktop_notifications SET read_at=? WHERE read_at=''`, desktopTaskNow())
}
func (s *DesktopNotificationService) Delete(id string) error {
	return s.update(`DELETE FROM desktop_notifications WHERE id=?`, id)
}
func (s *DesktopNotificationService) update(query string, args ...any) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	err = resultstore.Write(context.Background(), func(ctx context.Context) error { _, err := db.ExecContext(ctx, query, args...); return err })
	if err == nil {
		s.refreshTray()
	}
	return err
}
func (s *DesktopNotificationService) Publish(eventType, severity, title, message, actionURL string) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	item := DesktopNotification{ID: uuid.NewString(), EventType: eventType, Severity: severity, Title: title, Message: message, ActionURL: actionURL, CreatedAt: desktopTaskNow()}
	err = resultstore.Write(context.Background(), func(ctx context.Context) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if err := insertDesktopNotification(tx, item); err != nil {
			return err
		}
		return tx.Commit()
	})
	if err == nil {
		s.refreshTray()
	}
	return err
}

// Called inside the source transaction for task completion; no independent
// file write or post-commit receipt is needed for a local inbox.
func insertDesktopNotification(tx *sql.Tx, item DesktopNotification) error {
	if strings.TrimSpace(item.Severity) == "" {
		item.Severity = "info"
	}
	if _, err := tx.Exec(`INSERT INTO desktop_notifications(id,event_type,severity,title,message,source_type,source_id,action_url,read_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, item.ID, item.EventType, item.Severity, item.Title, item.Message, item.SourceType, item.SourceID, item.ActionURL, item.ReadAt, item.CreatedAt); err != nil {
		return err
	}
	_, err := tx.Exec(`DELETE FROM desktop_notifications WHERE id NOT IN (SELECT id FROM desktop_notifications ORDER BY created_at DESC,id DESC LIMIT 500)`)
	return err
}

func (s *DesktopNotificationService) attachTray(tray *application.SystemTray) {
	s.mu.Lock()
	s.tray = tray
	s.mu.Unlock()
	s.refreshTray()
}
func (s *DesktopNotificationService) refreshTray() {
	s.mu.Lock()
	tray := s.tray
	s.mu.Unlock()
	if tray == nil {
		return
	}
	db, err := s.database()
	if err != nil {
		return
	}
	var unread int
	if err := db.QueryRow(`SELECT COUNT(*) FROM desktop_notifications WHERE read_at=''`).Scan(&unread); err != nil {
		return
	}
	tooltip := "EasySSH"
	if unread > 0 {
		tooltip += " · " + desktopNotificationCount(unread)
	}
	tray.SetTooltip(tooltip)
}
func desktopNotificationCount(count int) string { return "未读通知 " + strconv.Itoa(count) }

func desktopTaskNotification(run DesktopTaskRun) DesktopNotification {
	for _, field := range []*string{&run.Title, &run.Resource, &run.ErrorMessage} {
		preview, shortened := taskprotocol.PreviewText(*field)
		if shortened {
			preview += "…"
		}
		*field = preview
	}

	severity, eventType, title := "error", "task.failed", "任务执行失败"
	switch run.Status {
	case "succeeded":
		severity, eventType, title = "success", "task.succeeded", "任务执行成功"
	case "partial_success":
		severity, eventType, title = "warning", "task.partial_success", "任务部分成功"
	case "unknown":
		severity, eventType, title = "warning", "task.unknown", "任务结果待核对"
	case "canceled":
		severity, eventType, title = "warning", "task.canceled", "任务已取消"
	}
	message := run.Title
	if run.Resource != "" {
		message += " · " + run.Resource
	}
	if run.ErrorMessage != "" {
		message += "：" + run.ErrorMessage
	}
	return DesktopNotification{ID: uuid.NewSHA1(uuid.NameSpaceOID, []byte("task-completion:"+run.ID)).String(), EventType: eventType, Severity: severity, Title: title, Message: message, SourceType: "task_run", SourceID: run.ID, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
}
