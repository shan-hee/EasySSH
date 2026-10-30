package content

import (
	"context"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/storage/accessquery"
	"github.com/easyssh/shared/protocol"
	"gorm.io/gorm"
)

// The activity owns this raw UTF-8 detail independently of any task lifetime.
// Its repository holds WithStorage until the activity/reference transaction commits.
func (s *Service) PutActivityDetail(tx *gorm.DB, record operationrecord.OperationRecord, raw []byte) (protocol.ContentReference, error) {
	return s.putBytes(tx, Record{Actor: record.Actor, SourceType: "activity_detail", SourceID: record.ID, Action: protocol.ActivityRead}, raw, "text/plain; charset=utf-8")
}

func (s *Service) checkActivityDetail(ctx context.Context, row Record) error {
	query, err := accessquery.Visible(ctx, s.db.WithContext(ctx).Model(&operationrecord.OperationRecord{}))
	if err != nil {
		return err
	}
	var count int64
	if err := query.Where("id=? AND detail_content_id=?", row.SourceID, row.ID).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return ErrNotFound
	}
	return nil
}
