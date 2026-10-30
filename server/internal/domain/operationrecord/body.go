package operationrecord

import (
	"context"
	"errors"

	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"gorm.io/gorm"
)

// Bodies is used by standalone activity writers. Projections with bounded
// metadata or an existing task-body reference do not allocate another body.
type Bodies interface {
	WithStorage(func() error) error
	PutActivityDetail(*gorm.DB, OperationRecord, []byte) (protocol.ContentReference, error)
}

const maxInlineDetailBytes = 32 * 1024

func (r *repository) storeDetail(tx *gorm.DB, record *OperationRecord) error {
	if record.DetailContentID != nil && record.DetailJSON == "" {
		if record.TaskContentID != nil {
			return errors.New("activity cannot contain two body references")
		}
		return contentstore.ValidateReference(protocol.ContentReference{ID: *record.DetailContentID, Size: record.DetailContentSize, Sha256: record.DetailContentSHA256, MediaType: "text/plain; charset=utf-8"})
	}
	record.DetailContentID, record.DetailContentSize, record.DetailContentSHA256 = nil, 0, ""
	if record.TaskContentID != nil {
		if record.DetailJSON != "" {
			return errors.New("activity cannot contain both task content and inline detail")
		}
		return nil
	}
	if len(record.DetailJSON) <= maxInlineDetailBytes {
		return nil
	}
	if r.bodies == nil {
		return errors.New("activity detail storage is required")
	}
	ref, err := r.bodies.PutActivityDetail(tx, *record, []byte(record.DetailJSON))
	if err != nil {
		return err
	}
	record.DetailContentID, record.DetailContentSize, record.DetailContentSHA256 = &ref.ID, ref.Size, ref.Sha256
	record.DetailJSON = ""
	return nil
}

// Standalone writers hold the file lock before opening a transaction. Bounded
// projections pass no Bodies and stay within their source's outer transaction.
func (r *repository) transaction(ctx context.Context, fn func(*gorm.DB) error) error {
	write := func() error { return r.db.WithContext(ctx).Transaction(fn) }
	if r.bodies != nil {
		return r.bodies.WithStorage(write)
	}
	return write()
}
