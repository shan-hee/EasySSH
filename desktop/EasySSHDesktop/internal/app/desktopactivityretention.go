package app

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Retain complete work families, including retry chains and batch children.
// Never remove the latest projection and accidentally expose an earlier attempt
// as current, or recreate a running source after the user clears history.
func pruneDesktopActivity(ctx context.Context, db *sql.DB, before time.Time, retention bool) (int64, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	family := `CASE WHEN parent_work_id='' THEN work_id ELSE parent_work_id END`
	query := `SELECT ` + family + ` AS family_id FROM activity_logs GROUP BY ` + family + ` HAVING SUM(CASE WHEN finished_at='' OR status IN ('pending','running') THEN 1 ELSE 0 END)=0 AND MAX(julianday(finished_at))<julianday(?)`
	args := []any{before.Format(time.RFC3339Nano)}
	if retention {
		query += ` AND (SUM(CASE WHEN status IN ('failure','partial','timeout','unknown') THEN 1 ELSE 0 END)=0 OR MAX(julianday(finished_at))<julianday(?))`
		args = append(args, before.AddDate(0, 0, -90).Format(time.RFC3339Nano))
	}
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

func desktopActivityClearBefore(value string) (time.Time, error) {
	if value == "" {
		return time.Now().UTC(), nil
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			if parsed.After(time.Now()) {
				return time.Time{}, errors.New("activity cutoff cannot be in the future")
			}
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, errors.New("invalid activity cutoff")
}

func (s *ActivityLogService) runRetention(ctx context.Context) {
	defer s.workerWG.Done()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := s.pruneRetainedActivity(bounded)
			cancel()
			if err != nil && ctx.Err() == nil {
				desktopLogPrintf("activity retention failed: %v", err)
			}

		}
	}
}

func (s *ActivityLogService) pruneRetainedActivity(ctx context.Context) error {
	if err := s.reconcileConnections(ctx); err != nil {
		return err
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	_, err = pruneDesktopActivity(ctx, db, time.Now().UTC().AddDate(0, 0, -90), true)
	return err
}
