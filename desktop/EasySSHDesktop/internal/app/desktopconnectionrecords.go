package app

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"time"

	"github.com/easyssh/shared/activitystats"
	"github.com/easyssh/shared/resultstore"
	"github.com/google/uuid"
)

// A connection is an observed SSH lifetime, not a resumable task. Only the
// owning transport can update it. Persistence retries never reconnect SSH.
type desktopConnectionRecord struct {
	Item           DesktopActivityLogItem
	LastObservedAt string
}

type desktopConnectionObservation struct {
	mu       sync.Mutex
	service  *ActivityLogService
	record   desktopConnectionRecord
	finished bool
}

func (s *ActivityLogService) beginConnection(ctx context.Context, server DesktopServer) (*desktopConnectionObservation, error) {
	return s.beginConnectionFor(ctx, server, "ssh_connect", "manual")
}

func (s *ActivityLogService) beginConnectionFor(ctx context.Context, server DesktopServer, action, source string) (*desktopConnectionObservation, error) {
	if (action != "ssh_connect" && action != "sftp_connect" && action != "monitor_connect" && action != "command_connect" && action != "docker_connect") || (source != "manual" && source != "automation") {
		return nil, errors.New("invalid connection origin")
	}
	id, now := uuid.NewString(), desktopTaskNow()
	s.observationMu.Lock()
	if len(s.liveConnections) >= 128 {
		s.observationMu.Unlock()
		return nil, errors.New("SSH connection capacity reached")
	}
	if s.liveConnections == nil {
		s.liveConnections = make(map[string]string)
	}
	// Empty server ID reserves a dialing/closing transport without reporting it online.
	s.liveConnections[id] = ""
	s.observationMu.Unlock()
	record := desktopConnectionRecord{LastObservedAt: now, Item: DesktopActivityLogItem{
		ID:    uuid.NewSHA1(uuid.NameSpaceOID, []byte("desktop_connections:"+id)).String(),
		Actor: desktopLocalActor(), WorkID: id, WorkStartedAt: now, Attempt: 1,
		SourceTable: "desktop_connections", SourceID: id, Kind: activitystats.TypeConnection, Source: source,
		Action: action, Status: "pending", ServerID: server.ID, ServerName: serverDisplayName(server), Resource: serverDisplayName(server),
		CreatedAt: now, StartedAt: now, TotalCount: 1,
	}}
	if err := s.persistConnection(ctx, record); err != nil {
		s.observationMu.Lock()
		delete(s.liveConnections, id)
		s.observationMu.Unlock()
		return nil, err
	}
	return &desktopConnectionObservation{service: s, record: record}, nil
}

func (o *desktopConnectionObservation) established() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.finished {
		return errors.New("SSH connection already ended")
	}
	now := desktopTaskNow()
	o.record.Item.EstablishedAt, o.record.LastObservedAt = now, now
	o.record.Item.Status = "running"
	return o.service.observeConnection(o.record, false)
}

func (o *desktopConnectionObservation) heartbeat(ctx context.Context) error {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			o.mu.Lock()
			if o.finished {
				o.mu.Unlock()
				return nil
			}
			o.record.LastObservedAt = desktopTaskNow()
			err := o.service.observeConnection(o.record, false)
			o.mu.Unlock()
			if err != nil {
				return err
			}
		}
	}
}

func (o *desktopConnectionObservation) finish(status DesktopActivityLogStatus, code string, disconnectedAt time.Time) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.finished {
		return
	}
	o.finished = true
	if disconnectedAt.IsZero() {
		disconnectedAt = time.Now().UTC()
	}
	now := disconnectedAt.Format(time.RFC3339Nano)
	o.record.Item.FinishedAt, o.record.LastObservedAt = now, now
	o.record.Item.Status, o.record.Item.Detail = status, code
	if status == "success" {
		o.record.Item.SuccessCount = 1
	}
	if status == "failure" || status == "timeout" {
		o.record.Item.FailureCount = 1
	}
	if err := o.service.observeConnection(o.record, true); err != nil {
		desktopLogPrintf("connection outcome storage failed: %v", err)
	}
}

func (s *ActivityLogService) observeConnection(record desktopConnectionRecord, finished bool) error {
	s.observationMu.Lock()
	if finished {
		s.liveConnections[record.Item.SourceID] = ""
	} else if record.Item.EstablishedAt != "" {
		s.liveConnections[record.Item.SourceID] = record.Item.ServerID
	}
	s.observationMu.Unlock()
	err := s.saveConnection(context.Background(), record)
	if finished {
		s.observationMu.Lock()
		delete(s.liveConnections, record.Item.SourceID)
		s.observationMu.Unlock()
	}
	return err
}

func (s *ActivityLogService) saveConnection(ctx context.Context, record desktopConnectionRecord) error {
	return resultstore.Write(ctx, func(attempt context.Context) error { return s.persistConnection(attempt, record) })
}

func (s *ActivityLogService) persistConnection(ctx context.Context, record desktopConnectionRecord) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	item := record.Item
	if item.EstablishedAt != "" && item.FinishedAt != "" {
		start, _ := time.Parse(time.RFC3339Nano, item.EstablishedAt)
		end, _ := time.Parse(time.RFC3339Nano, item.FinishedAt)
		item.DurationMs = max(int64(0), end.Sub(start).Milliseconds())
	}
	if err = upsertDesktopActivity(tx, item); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO desktop_connections(id,activity_id,actor_kind,actor_id,actor_session_id,actor_grant_id,server_id,server_name,action,source,status,started_at,established_at,last_observed_at,finished_at,error_code)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,established_at=excluded.established_at,last_observed_at=excluded.last_observed_at,finished_at=excluded.finished_at,error_code=excluded.error_code`,
		item.SourceID, item.ID, item.Actor.Kind, item.Actor.ID, item.Actor.SessionID, item.Actor.GrantID, item.ServerID, item.ServerName, item.Action, item.Source, item.Status, item.StartedAt, item.EstablishedAt, record.LastObservedAt, item.FinishedAt, item.Detail)
	if err != nil {
		return err
	}
	if item.EstablishedAt != "" {
		if _, err = tx.ExecContext(ctx, `UPDATE desktop_servers SET last_connected=? WHERE id=? AND (last_connected='' OR julianday(last_connected)<julianday(?))`, item.EstablishedAt, item.ServerID, item.EstablishedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// This runtime snapshot is independent of durable history and persistence
// retries. A previous successful connection never implies current availability.
func (s *ActivityLogService) onlineServers() map[string]bool {
	result := map[string]bool{}
	if s == nil {
		return result
	}
	s.observationMu.Lock()
	defer s.observationMu.Unlock()
	for _, serverID := range s.liveConnections {
		if serverID != "" {
			result[serverID] = true
		}
	}
	return result
}

// Only runtime transport IDs are retained; no failed result is cached for replay.
// Reserve IDs before admission and keep them until the final write finishes so
// reconciliation cannot mistake a dialing/closing transport for an orphan.
func (s *ActivityLogService) reconcileConnections(ctx context.Context) error {
	s.observationMu.Lock()
	defer s.observationMu.Unlock()
	db, err := s.database()
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(s.liveConnections))
	for id := range s.liveConnections {
		ids = append(ids, id)
	}
	return reconcileDesktopConnectionRows(ctx, db, ids, "connection_outcome_unknown")
}

// After an unclean exit, the last observation is a lower bound, not evidence
// that the connection remained established until the next application start.
func recoverDesktopConnections(ctx context.Context, db *sql.DB) error {
	return reconcileDesktopConnectionRows(ctx, db, nil, "application_interrupted")
}

func reconcileDesktopConnectionRows(ctx context.Context, db *sql.DB, active []string, reason string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	recoveredAt := desktopTaskNow()
	query := `UPDATE desktop_connections SET status='unknown',finished_at=last_observed_at,recovered_at=?,error_code=? WHERE finished_at=''`
	args := []any{recoveredAt, reason}
	if len(active) > 0 {
		query += " AND id NOT IN (" + desktopSQLPlaceholders(len(active)) + ")"
		for _, id := range active {
			args = append(args, id)
		}
	}
	if _, err = tx.ExecContext(ctx, query, args...); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE activity_logs SET status='unknown',connection_uncertain_until=(SELECT recovered_at FROM desktop_connections WHERE id=activity_logs.source_id),finished_at=(SELECT finished_at FROM desktop_connections WHERE id=activity_logs.source_id),detail=(SELECT error_code FROM desktop_connections WHERE id=activity_logs.source_id),duration_ms=CASE WHEN established_at='' THEN 0 ELSE MAX(0,CAST(ROUND((julianday((SELECT finished_at FROM desktop_connections WHERE id=activity_logs.source_id))-julianday(established_at))*86400000) AS INTEGER)) END,updated_at=?
 WHERE source_table='desktop_connections' AND finished_at='' AND source_id IN (SELECT id FROM desktop_connections WHERE status='unknown')`, recoveredAt); err != nil {
		return err
	}
	return tx.Commit()
}
