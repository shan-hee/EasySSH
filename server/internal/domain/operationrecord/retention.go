package operationrecord

import (
	"context"
	"database/sql"
	"github.com/easyssh/shared/protocol"
	"time"

	"gorm.io/gorm"
)

const activityFamilySQL = "COALESCE(parent_work_id,work_id)"

// Retention removes completed work families, not individual attempts. A recent
// retry, active target or interruption interval protects the entire family.
// Each short transaction has a bounded candidate set and its own coverage write.
func (r *repository) DeleteOld(ctx context.Context, before time.Time, category Category) (int64, error) {
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		var batch int64
		var selected int
		opts := &sql.TxOptions{Isolation: sql.LevelSerializable}
		if r.db.Dialector.Name() == "sqlite" {
			opts = &sql.TxOptions{}
		}
		err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			type family struct {
				FamilyID string
				Actor    protocol.Actor `gorm:"embedded;embeddedPrefix:actor_"`
			}
			var families []family
			end := "COALESCE(connection_uncertain_until,finished_at,created_at)"
			group := "actor_kind,actor_id,actor_session_id,actor_grant_id," + activityFamilySQL
			query := tx.Model(&OperationRecord{}).
				Select("actor_kind,actor_id,actor_session_id,actor_grant_id,"+activityFamilySQL+" AS family_id").
				Group(group).
				Having("SUM(CASE WHEN status IN ? THEN 1 ELSE 0 END)=0", []Status{StatusPending, StatusRunning}).
				Having("MAX("+end+") < ?", before).
				Having("SUM(CASE WHEN status IN ? THEN 1 ELSE 0 END)=0 OR MAX("+end+") < ?", []Status{StatusFailure, StatusPartial, StatusTimeout, StatusUnknown}, before.AddDate(0, 0, -90))
			if category != "" {
				// A category filter may select a whole family; it cannot remove
				// one part of a family that also contains another category.
				query = query.Having("SUM(CASE WHEN category <> ? THEN 1 ELSE 0 END)=0", category)
			}
			if err := query.Order("family_id ASC,actor_kind ASC,actor_id ASC,actor_session_id ASC,actor_grant_id ASC").Limit(200).Scan(&families).Error; err != nil {
				return err
			}
			selected = len(families)
			for _, f := range families {
				result := tx.Unscoped().Where(activityFamilySQL+"=? AND actor_kind=? AND actor_id=? AND actor_session_id=? AND actor_grant_id=?", f.FamilyID, f.Actor.Kind, f.Actor.ID, f.Actor.SessionID, f.Actor.GrantID).Delete(&OperationRecord{})
				if result.Error != nil {
					return result.Error
				}
				batch += result.RowsAffected
			}
			if batch == 0 {
				return nil
			}
			return markPruned(tx, category, before)
		}, opts)
		if err != nil {
			return total, err
		}
		total += batch
		if selected < 200 {
			return total, nil
		}
	}
}
