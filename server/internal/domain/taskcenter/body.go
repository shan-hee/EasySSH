package taskcenter

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/easyssh/server/internal/storage/accessquery"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/taskprotocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Transaction holds the existing body-store lock through the outermost commit.
// Transaction repositories reuse this boundary instead of releasing a lock at a savepoint.
func Transaction(ctx context.Context, db *gorm.DB, bodies Bodies, fn func(*gorm.DB) error) error {
	write := func() error { return db.WithContext(ctx).Transaction(fn) }
	if bodies != nil {
		return bodies.WithStorage(write)
	}
	return write()
}

func NewTransactionRepository(tx *gorm.DB, bodies Bodies) Repository {
	return &repository{db: tx, bodies: bodies, inTransaction: true}
}

func (r *repository) transaction(ctx context.Context, fn func(*gorm.DB) error) error {
	if r.inTransaction {
		return fn(r.db.WithContext(ctx))
	}
	return Transaction(ctx, r.db, r.bodies, fn)
}

func (run TaskRun) Body() protocol.TaskBody {
	return protocol.TaskBody{TaskRunID: run.ID, Description: run.Description, PayloadJSON: run.PayloadJSON, ResultJSON: run.ResultJSON, ProgressJSON: run.ProgressJSON}
}

func (run *TaskRun) applyBody(body protocol.TaskBody) {
	run.Description, run.PayloadJSON, run.ResultJSON, run.ProgressJSON = body.Description, body.PayloadJSON, body.ResultJSON, body.ProgressJSON
}

func (run TaskRun) bodyReference() *protocol.ContentReference {
	if run.ContentID == nil {
		return nil
	}
	return &protocol.ContentReference{ID: *run.ContentID, Size: run.ContentSize, Sha256: run.ContentSHA256, MediaType: "application/json"}
}

// StoreBody is called by writers inside Transaction. Keep the caller's full
// execution body in memory, but persist either inline columns or one reference.
func StoreBody(tx *gorm.DB, bodies Bodies, run *TaskRun) error {
	raw, err := json.Marshal(run.Body())
	if err != nil {
		return err
	}
	inline := run.Body()
	var ref *protocol.ContentReference
	if len(raw) > taskprotocol.MaxInlineContentBytes {
		if bodies == nil {
			return errors.New("task body storage is required")
		}
		stored, err := bodies.PutTaskBody(tx, *run, raw)
		if err != nil {
			return err
		}
		ref = &stored
		inline = protocol.TaskBody{}
	}
	var id *uuid.UUID
	var size int64
	var hash string
	if ref != nil {
		id, size, hash = &ref.ID, ref.Size, ref.Sha256
	}
	result := tx.Model(&TaskRun{}).Where("id=?", run.ID).Updates(map[string]any{
		"content_id": id, "content_size": size, "content_sha256": hash,
		"description": inline.Description, "payload_json": inline.PayloadJSON, "result_json": inline.ResultJSON, "progress_json": inline.ProgressJSON,
	})
	if result.Error != nil {
		return result.Error
	}
	run.ContentID, run.ContentSize, run.ContentSHA256 = id, size, hash
	return nil
}

func (r *repository) restoreBody(tx *gorm.DB, run *TaskRun) error {
	ref := run.bodyReference()
	if ref == nil {
		return nil
	}
	if r.bodies == nil {
		return errors.New("task body storage is required")
	}
	raw, err := r.bodies.LoadTaskBody(tx, *run, *ref)
	if err != nil {
		return err
	}
	var body protocol.TaskBody
	if err := json.Unmarshal(raw, &body); err != nil {
		return err
	}
	if body.TaskRunID != run.ID {
		return contentstore.ErrChanged
	}
	run.applyBody(body)
	return nil
}

func (r *repository) get(ctx context.Context, id uuid.UUID, visible bool) (*TaskRun, error) {
	var run TaskRun
	read := func() error {
		query := r.db.WithContext(ctx)
		if visible {
			var err error
			query, err = accessquery.Visible(ctx, query)
			if err != nil {
				return err
			}
		}
		if err := query.First(&run, "id=?", id).Error; err != nil {
			return err
		}
		// One row selects an immutable body. Holding the file lock keeps this
		// version available if a concurrent update replaces the row's reference.
		return r.restoreBody(r.db.WithContext(ctx), &run)
	}
	var err error
	if r.bodies != nil && !r.inTransaction {
		err = r.bodies.WithStorage(read)
	} else {
		err = read()
	}
	if err != nil {
		return nil, err
	}
	return &run, nil
}

// Details reads the persisted descriptor without loading or generating a file.
// List previews remain bounded; detail metadata retains its complete values.
func (r *repository) Details(ctx context.Context, id uuid.UUID) (protocol.TaskRunDetails, error) {
	query, err := accessquery.Visible(ctx, r.db.WithContext(ctx))
	if err != nil {
		return protocol.TaskRunDetails{}, err
	}
	var run TaskRun
	if err := query.First(&run, "id=?", id).Error; err != nil {
		return protocol.TaskRunDetails{}, err
	}
	var descriptor protocol.TaskContent
	if ref := run.bodyReference(); ref != nil {
		if err := contentstore.ValidateReference(*ref); err != nil {
			return protocol.TaskRunDetails{}, err
		}
		descriptor = protocol.TaskContent{Content: ref, Bytes: int(ref.Size), Hash: ref.Sha256}
	} else {
		descriptor, err = taskprotocol.DescribeContent(run.Body())
		if err != nil {
			return protocol.TaskRunDetails{}, err
		}
	}
	overview := taskprotocol.RunOverview(run.Wire())
	// Only the list is a text preview. The body contains execution data, not a
	// duplicate of mutable status, counters or display fields.
	overview.Title, overview.Stage, overview.ServerName, overview.Resource, overview.ErrorMessage = run.Title, run.Stage, run.ServerName, run.Resource, run.ErrorMessage
	overview.TruncatedFields = nil
	return protocol.TaskRunDetails{Run: &overview, Content: descriptor}, nil
}
