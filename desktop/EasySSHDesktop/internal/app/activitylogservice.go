package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/activitystats"
	"github.com/wailsapp/wails/v3/pkg/application"
	_ "modernc.org/sqlite"
)

type DesktopActivityLogStatus string

const (
	DesktopActivityLogSuccess DesktopActivityLogStatus = "success"
	DesktopActivityLogFailure DesktopActivityLogStatus = "failure"
	DesktopActivityLogWarning DesktopActivityLogStatus = "warning"
)

type DesktopActivityLogItem struct {
	DetailContent            *protocol.ContentReference `json:"detail_content,omitempty"`
	ErrorMessage             string                     `json:"error_message,omitempty"`
	TaskContent              *protocol.ContentReference `json:"task_content,omitempty"`
	ConnectionUncertainUntil string                     `json:"connection_uncertain_until,omitempty"`
	Kind                     activitystats.Kind         `json:"type"`
	Source                   string                     `json:"source"`
	EstablishedAt            string                     `json:"established_at,omitempty"`
	Resources                []activitystats.Resource   `json:"resources"`
	Actor                    protocol.Actor             `json:"actor"`
	WorkID                   string                     `json:"work_id"`
	ParentWorkID             string                     `json:"parent_work_id,omitempty"`
	WorkStartedAt            string                     `json:"work_started_at"`
	Attempt                  int                        `json:"attempt"`
	SourceTable              string                     `json:"source_table"`
	SourceID                 string                     `json:"source_id"`
	ServerName               string                     `json:"server_name"`
	StartedAt                string                     `json:"started_at,omitempty"`
	FinishedAt               string                     `json:"finished_at,omitempty"`
	TotalCount               int                        `json:"total_count"`
	SuccessCount             int                        `json:"success_count"`
	FailureCount             int                        `json:"failure_count"`
	BytesTotal               int64                      `json:"bytes_total"`
	BytesProcessed           int64                      `json:"bytes_processed"`
	BytesCompleted           int64                      `json:"bytes_completed"`
	ID                       string                     `json:"id"`
	Action                   string                     `json:"action"`
	Resource                 string                     `json:"resource"`
	Status                   DesktopActivityLogStatus   `json:"status"`
	ServerID                 string                     `json:"serverId,omitempty"`
	DurationMs               int64                      `json:"durationMs,omitempty"`
	Detail                   string                     `json:"detail,omitempty"`
	CreatedAt                string                     `json:"createdAt"`
}

type DesktopActivityLogListParams struct {
	Page      int                      `json:"page,omitempty"`
	Limit     int                      `json:"limit,omitempty"`
	Action    string                   `json:"action,omitempty"`
	ServerID  string                   `json:"serverId,omitempty"`
	Status    DesktopActivityLogStatus `json:"status,omitempty"`
	StartDate string                   `json:"startDate,omitempty"`
	EndDate   string                   `json:"endDate,omitempty"`
}

type DesktopActivityLogListResult struct {
	Items      []DesktopActivityLogItem `json:"items"`
	Total      int                      `json:"total"`
	Page       int                      `json:"page"`
	PageSize   int                      `json:"pageSize"`
	TotalPages int                      `json:"totalPages"`
}

type ActivityLogService struct {
	tasks           *DesktopTaskService
	observationMu   sync.Mutex
	liveConnections map[string]string
	mu              sync.Mutex
	db              *sql.DB
	closed          bool
	workerCancel    context.CancelFunc
	workerWG        sync.WaitGroup
}

func NewActivityLogService() *ActivityLogService {
	return &ActivityLogService{}
}

func (s *ActivityLogService) ServiceName() string {
	return "ActivityLogService"
}

func (s *ActivityLogService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	if err = recoverDesktopConnections(ctx, db); err != nil {
		return err
	}
	if _, err = pruneDesktopActivity(ctx, db, time.Now().UTC().AddDate(0, 0, -90), true); err != nil {
		return err
	}
	worker, cancel := context.WithCancel(ctx)
	s.mu.Lock()
	s.workerCancel = cancel
	s.workerWG.Add(1)
	s.mu.Unlock()
	go s.runRetention(worker)
	return nil
}

func (s *ActivityLogService) ServiceShutdown() error {
	s.mu.Lock()
	cancel := s.workerCancel
	s.workerCancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		s.workerWG.Wait()
	}
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

func (s *ActivityLogService) List(params DesktopActivityLogListParams) (DesktopActivityLogListResult, error) {
	if err := s.reconcileConnections(context.Background()); err != nil {
		return DesktopActivityLogListResult{}, err
	}
	database, err := s.database()
	if err != nil {
		return DesktopActivityLogListResult{}, err
	}

	tx, err := database.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return DesktopActivityLogListResult{}, err
	}
	defer tx.Rollback()
	params = normalizeActivityListParams(params)
	where, args := buildActivityLogWhere(params)

	var total int
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM activity_logs WHERE %s", where)
	if err := tx.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return DesktopActivityLogListResult{}, err
	}

	offset := (params.Page - 1) * params.Limit
	queryArgs := append(append([]any{}, args...), params.Limit, offset)
	querySQL := desktopActivitySummarySQL + " WHERE " + where + " ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?"

	rows, err := tx.Query(querySQL, queryArgs...)
	if err != nil {
		return DesktopActivityLogListResult{}, err
	}
	defer rows.Close()

	items := make([]DesktopActivityLogItem, 0)
	for rows.Next() {
		item, err := scanDesktopActivity(rows)
		if err != nil {
			return DesktopActivityLogListResult{}, err
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return DesktopActivityLogListResult{}, err
	}

	if err = rows.Close(); err != nil {
		return DesktopActivityLogListResult{}, err
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	resources, err := readDesktopActivityResources(context.Background(), tx, ids)
	if err != nil {
		return DesktopActivityLogListResult{}, err
	}
	for i := range items {
		items[i].Resources = resources[items[i].ID]
		if items[i].Resources == nil {
			items[i].Resources = []activitystats.Resource{}
		}
	}
	if err = tx.Commit(); err != nil {
		return DesktopActivityLogListResult{}, err
	}

	totalPages := 0
	if total > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(params.Limit)))
	}

	return DesktopActivityLogListResult{
		Items:      items,
		Total:      total,
		Page:       params.Page,
		PageSize:   params.Limit,
		TotalPages: totalPages,
	}, nil
}

func (s *ActivityLogService) GetById(id string) (DesktopActivityLogItem, error) {
	if err := s.reconcileConnections(context.Background()); err != nil {
		return DesktopActivityLogItem{}, err
	}
	database, err := s.database()
	if err != nil {
		return DesktopActivityLogItem{}, err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return DesktopActivityLogItem{}, errors.New("activity log id is required")
	}

	tx, err := database.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return DesktopActivityLogItem{}, err
	}
	defer tx.Rollback()
	item, err := scanDesktopActivity(tx.QueryRow(desktopActivitySelectSQL+" WHERE id=?", id))
	if err != nil {
		return DesktopActivityLogItem{}, err
	}

	resources, err := readDesktopActivityResources(context.Background(), tx, []string{id})
	if err != nil {
		return item, err
	}
	item.Resources = resources[id]
	if item.Resources == nil {
		item.Resources = []activitystats.Resource{}
	}
	if err = tx.Commit(); err != nil {
		return item, err
	}
	return item, nil
}

func (s *ActivityLogService) Clear(before string) (int64, error) {
	if err := s.reconcileConnections(context.Background()); err != nil {
		return 0, err
	}
	cutoff, err := desktopActivityClearBefore(before)
	if err != nil {
		return 0, err
	}
	db, err := s.database()
	if err != nil {
		return 0, err
	}
	return pruneDesktopActivity(context.Background(), db, cutoff, false)
}

func (s *ActivityLogService) database() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return nil, errors.New("activity service is shut down")
	}

	if s.db != nil {
		return s.db, nil
	}

	dataDir := desktopDataDir()
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create desktop data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "easyssh-desktop.sqlite")
	database, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}

	if err := configureDesktopDatabase(database); err != nil {
		database.Close()
		return nil, err
	}

	s.db = database
	return s.db, nil
}

func normalizeActivityListParams(params DesktopActivityLogListParams) DesktopActivityLogListParams {
	if params.Page < 1 {
		params.Page = 1
	}

	if params.Limit < 1 {
		params.Limit = 20
	}

	if params.Limit > 100 {
		params.Limit = 100
	}

	params.Action = strings.TrimSpace(params.Action)
	params.ServerID = strings.TrimSpace(params.ServerID)
	params.StartDate = normalizeActivityDate(params.StartDate)
	params.EndDate = normalizeActivityDate(params.EndDate)
	if !isValidActivityStatus(params.Status) {
		params.Status = ""
	}

	return params
}

func buildActivityLogWhere(params DesktopActivityLogListParams) (string, []any) {
	params = normalizeActivityListParams(params)
	clauses := []string{"1 = 1"}
	args := make([]any, 0)

	if params.Action != "" {
		clauses = append(clauses, "action = ?")
		args = append(args, params.Action)
	}

	if params.ServerID != "" {
		clauses = append(clauses, "server_id = ?")
		args = append(args, params.ServerID)
	}

	if params.Status != "" {
		clauses = append(clauses, "status = ?")
		args = append(args, params.Status)
	}

	if params.StartDate != "" {
		clauses = append(clauses, "created_at >= ?")
		args = append(args, params.StartDate)
	}

	if params.EndDate != "" {
		clauses = append(clauses, "created_at <= ?")
		args = append(args, params.EndDate)
	}

	return strings.Join(clauses, " AND "), args
}

func isValidActivityStatus(status DesktopActivityLogStatus) bool {
	switch status {
	case DesktopActivityLogSuccess, DesktopActivityLogFailure, DesktopActivityLogWarning, "pending", "running", "partial", "canceled", "timeout", "unknown":
		return true
	default:
		return false
	}
}

func normalizeActivityDate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02"} {
		date, err := time.Parse(layout, value)
		if err == nil {
			if layout == "2006-01-02" {
				date = date.UTC()
			}
			return date.UTC().Format(time.RFC3339Nano)
		}
	}

	return value
}
