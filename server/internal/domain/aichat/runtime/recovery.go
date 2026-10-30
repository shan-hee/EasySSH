package runtime

import (
	"context"
	"github.com/easyssh/server/internal/domain/content"

	"gorm.io/gorm"
)

// RecoverInterrupted runs before admitting AI work. Execution facts are corrected
// first, then conversation state is persisted from those durable intents. Neither
// step invokes a provider or a remote tool. Waiting-only conversations survive.
func RecoverInterrupted(ctx context.Context, db *gorm.DB, bodies *content.Service) error {
	if err := recoverToolExecutions(ctx, db); err != nil {
		return err
	}
	store := NewGormSessionStore(db, bodies)
	after := ""
	for {
		var records []AISessionRecord
		if err := db.WithContext(ctx).Where("id > ? AND status <> ?", after, SessionStatusClosed).Order("id").Limit(100).Find(&records).Error; err != nil {
			return err
		}
		for _, record := range records {
			var snapshot *SessionSnapshot
			err := bodies.WithStorage(func() error {
				var err error
				snapshot, err = LoadSessionSnapshot(db.WithContext(ctx), record, bodies)
				return err
			})
			if err != nil {
				return err
			}
			if normalizeRestoredSnapshot(snapshot) {
				if err := persistSnapshot(ctx, store, *snapshot); err != nil {
					return err
				}
			}
			after = record.ID
		}
		if len(records) < 100 {
			return nil
		}
	}
}
