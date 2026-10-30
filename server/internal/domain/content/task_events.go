package content

import (
	"context"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/storage/accessquery"
	"github.com/easyssh/shared/protocol"
	"gorm.io/gorm"
)

// The repository locked this durable parent before allocating the event ID.
func (s *Service) PutTaskEvent(tx *gorm.DB, run taskcenter.TaskRun, raw []byte) (protocol.ContentReference, error) {
	return s.putJSON(tx, Record{Actor: run.Actor, SourceType: "task_event", SourceID: run.ID, Action: protocol.WorkspaceRead}, raw)
}

func (s *Service) checkTaskEvent(ctx context.Context, row Record) error {
	query, err := accessquery.Visible(ctx, s.db.WithContext(ctx).Model(&taskcenter.TaskRun{}))
	if err != nil {
		return err
	}
	var count int64
	if err := query.Where("id=? AND EXISTS(SELECT 1 FROM task_events e WHERE e.task_run_id=task_runs.id AND e.content_id=?)", row.SourceID, row.ID).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return ErrNotFound
	}
	return nil
}
