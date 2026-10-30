package content

import (
	"context"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/storage/accessquery"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Task detail bodies are separate from task_run operation artifacts (for
// example recursive-delete reports), which may have their own lifecycle.
func (s *Service) PutTaskBody(tx *gorm.DB, run taskcenter.TaskRun, raw []byte) (protocol.ContentReference, error) {
	return s.putJSON(tx, Record{Actor: run.Actor, SourceType: "task_body", SourceID: run.ID, Action: protocol.WorkspaceRead}, raw)
}

func (s *Service) LoadTaskBody(tx *gorm.DB, run taskcenter.TaskRun, ref protocol.ContentReference) ([]byte, error) {
	var row Record
	if err := tx.First(&row, "id=? AND source_type='task_body' AND source_id=?", ref.ID, run.ID).Error; err != nil {
		return nil, err
	}
	if row.Actor != run.Actor || !row.Ready || row.reference() != ref {
		return nil, contentstore.ErrChanged
	}
	return s.files.Load(ref)
}

func (s *Service) checkTaskBody(ctx context.Context, row Record) error {
	query, err := accessquery.Visible(ctx, s.db.WithContext(ctx).Model(&taskcenter.TaskRun{}))
	if err != nil {
		return err
	}
	var count int64
	if err := query.Where("id=? AND content_id=?", row.SourceID, row.ID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		activity, err := accessquery.Visible(ctx, s.db.WithContext(ctx).Model(&operationrecord.OperationRecord{}))
		if err != nil {
			return err
		}
		if err := activity.Where("source_table='task_runs' AND source_id=? AND task_content_id=?", row.SourceID.String(), row.ID).Count(&count).Error; err != nil {
			return err
		}
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

// Operation reports (such as recursive deletion) belong to the task's work.
// Activity retention keeps them readable after the task center prunes its row.
func (s *Service) visibleTaskActivityCount(ctx context.Context, id uuid.UUID) (int64, error) {
	query, err := accessquery.Visible(ctx, s.db.WithContext(ctx).Model(&operationrecord.OperationRecord{}))
	if err != nil {
		return 0, err
	}
	var count int64
	err = query.Where("source_table='task_runs' AND source_id=?", id.String()).Count(&count).Error
	return count, err
}
