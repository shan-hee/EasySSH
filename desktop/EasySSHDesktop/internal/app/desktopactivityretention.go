package app

import (
	"context"
	"database/sql"
	"time"
)

// Retain complete work families, including retry chains and batch children.
// Never remove the latest projection and accidentally expose an earlier attempt
// as current, or recreate a running source after the user clears history.
// pruneDesktopActivity removes whole finished work families older than before.
// Every outcome is kept for the same period.
func pruneDesktopActivity(ctx context.Context, db *sql.DB, before time.Time) (int64, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	family := `CASE WHEN parent_work_id='' THEN work_id ELSE parent_work_id END`
	query := `SELECT ` + family + ` AS family_id FROM activity_logs GROUP BY ` + family + ` HAVING SUM(CASE WHEN finished_at='' OR status IN ('pending','running') THEN 1 ELSE 0 END)=0 AND MAX(julianday(finished_at))<julianday(?)`
	args := []any{before.Format(time.RFC3339Nano)}
	result, err := tx.ExecContext(ctx, `DELETE FROM activity_logs WHERE `+family+` IN (`+query+`)`, args...)
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if count > 0 {
		if _, err = tx.ExecContext(ctx, `UPDATE desktop_activity_coverage SET pruned_before=? WHERE id='activity' AND (pruned_before='' OR julianday(pruned_before)<julianday(?))`, before.Format(time.RFC3339Nano), before.Format(time.RFC3339Nano)); err != nil {
			return 0, err
		}
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return count, nil
}

// Connections left open by a crash are closed daily so their logs can expire.
func (s *ActivityLogService) runReconciliation(ctx context.Context) {
	defer s.workerWG.Done()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := s.reconcileConnections(bounded)
			cancel()
			if err != nil && ctx.Err() == nil {
				desktopLogPrintf("connection reconciliation failed: %v", err)
			}
		}
	}
}

// pruneBefore removes logs older than the retention cutoff. Only the retention
// service removes logs by age.
func (s *ActivityLogService) pruneBefore(ctx context.Context, before time.Time) (int64, error) {
	if err := s.reconcileConnections(ctx); err != nil {
		return 0, err
	}
	db, err := s.database()
	if err != nil {
		return 0, err
	}
	return pruneDesktopActivity(ctx, db, before)
}
