package content

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/resultstore"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var ErrNotReady = errors.New("content is not sealed")
var ErrNotFound = errors.New("content not found")

type Record struct {
	ID         uuid.UUID       `gorm:"type:char(36);primaryKey"`
	Actor      protocol.Actor  `gorm:"embedded;embeddedPrefix:actor_"`
	SourceType string          `gorm:"size:30;not null;index:idx_content_source,priority:1"`
	SourceID   uuid.UUID       `gorm:"type:char(36);not null;index:idx_content_source,priority:2"`
	ServerID   string          `gorm:"size:36;not null"`
	Action     protocol.Action `gorm:"size:50;not null"`
	MediaType  string          `gorm:"size:128;not null"`
	Size       int64           `gorm:"not null"`
	SHA256     string          `gorm:"size:64;not null"`
	Ready      bool            `gorm:"not null"`
	CreatedAt  time.Time
}

func (Record) TableName() string { return "content_objects" }
func (r Record) reference() protocol.ContentReference {
	return protocol.ContentReference{ID: r.ID, MediaType: r.MediaType, Size: r.Size, Sha256: r.SHA256}
}

type Service struct {
	db      *gorm.DB
	files   *contentstore.Store
	storage sync.RWMutex
}

func New(db *gorm.DB, dataDir string) (*Service, error) {
	files, err := contentstore.Open(filepath.Join(dataDir, "content"))
	if err != nil {
		return nil, err
	}
	return &Service{db: db, files: files}, nil
}
func (s *Service) Close() error { return s.files.Close() }

// BeginTask binds a body to a durable task before any remote effect occurs.
func (s *Service) BeginTask(ctx context.Context, id uuid.UUID, run taskcenter.TaskRun, action protocol.Action, media string) (*contentstore.Writer, func(), error) {
	if id == uuid.Nil || !run.Actor.Valid() || run.ServerID == nil || *run.ServerID == uuid.Nil || !action.Valid() {
		return nil, nil, contentstore.ErrQuery
	}
	s.storage.RLock()
	release := s.storage.RUnlock
	var stored taskcenter.TaskRun
	if err := s.db.WithContext(ctx).First(&stored, "id=?", run.ID).Error; err != nil {
		release()
		return nil, nil, err
	}
	if stored.Actor != run.Actor || stored.SourceType != run.SourceType || stored.ServerID == nil || *stored.ServerID != *run.ServerID {
		release()
		return nil, nil, access.ErrForbidden
	}
	writer, err := s.files.Create(id, media)
	if err != nil {
		release()
		return nil, nil, err
	}
	row := Record{ID: id, Actor: run.Actor, SourceType: "task_run", SourceID: run.ID, ServerID: run.ServerID.String(), Action: action, MediaType: media}
	if err = s.db.WithContext(ctx).Create(&row).Error; err != nil {
		_, _ = writer.Finish()
		// A lost commit reply may still have created the row. Cleanup checks the
		// database before removing unreferenced files, rather than guessing here.
		release()
		return nil, nil, err
	}
	return writer, release, nil
}

// Seal retries metadata writes only; the body has already been written once.
func (s *Service) Seal(ctx context.Context, ref protocol.ContentReference) error {
	if err := contentstore.ValidateReference(ref); err != nil {
		return err
	}
	return resultstore.Write(ctx, func(attempt context.Context) error {
		result := s.db.WithContext(attempt).Model(&Record{}).Where("id=? AND ready=?", ref.ID, false).Updates(map[string]any{"size": ref.Size, "sha256": ref.Sha256, "ready": true})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected > 0 {
			return nil
		}
		var row Record
		if err := s.db.WithContext(attempt).First(&row, "id=?", ref.ID).Error; err != nil {
			return err
		}
		if row.reference() != ref || !row.Ready {
			return resultstore.Permanent(contentstore.ErrChanged)
		}
		return nil
	})
}
func (s *Service) Reference(ctx context.Context, id uuid.UUID) (protocol.ContentReference, error) {
	scope := access.Current(ctx)
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return protocol.ContentReference{}, err
	}
	var row Record
	if err := s.db.WithContext(ctx).First(&row, "id=?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return protocol.ContentReference{}, ErrNotFound
		}
		return protocol.ContentReference{}, err
	}
	// Removing/replacing a source removes read authority before file cleanup.
	switch row.SourceType {
	case "task_event":
		if err := s.checkTaskEvent(ctx, row); err != nil {
			return protocol.ContentReference{}, err
		}
	case "ai_session":
		if err := s.checkAIHistory(ctx, row); err != nil {
			return protocol.ContentReference{}, err
		}
	case "activity_detail":
		if err := s.checkActivityDetail(ctx, row); err != nil {
			return protocol.ContentReference{}, err
		}
	case "task_body":
		if err := s.checkTaskBody(ctx, row); err != nil {
			return protocol.ContentReference{}, err
		}
	case "task_run":
		if !scope.IsOwner() && scope.Actor() != row.Actor {
			return protocol.ContentReference{}, ErrNotFound
		}
		var count int64
		if err := s.db.WithContext(ctx).Model(&taskcenter.TaskRun{}).Where("id=?", row.SourceID).Count(&count).Error; err != nil {
			return protocol.ContentReference{}, err
		}
		if count == 0 {
			var err error
			count, err = s.visibleTaskActivityCount(ctx, row.SourceID)
			if err != nil {
				return protocol.ContentReference{}, err
			}
		}
		if count == 0 {
			return protocol.ContentReference{}, ErrNotFound
		}
		if err := scope.Check(ctx, access.Requirement{Action: row.Action, ServerID: row.ServerID}); err != nil {
			return protocol.ContentReference{}, err
		}
	default:
		return protocol.ContentReference{}, ErrNotFound
	}
	if !row.Ready {
		return protocol.ContentReference{}, ErrNotReady
	}
	return row.reference(), nil
}
func (s *Service) Read(ctx context.Context, id uuid.UUID, input protocol.ContentReadInput) (protocol.ContentChunk, error) {
	ref, err := s.Reference(ctx, id)
	if err != nil {
		return protocol.ContentChunk{}, err
	}
	return s.files.Read(ref, input)
}
func (s *Service) Recover(ctx context.Context) error {
	if err := s.Cleanup(ctx); err != nil {
		return err
	}
	var after uuid.UUID
	for {
		var rows []Record
		if err := s.db.WithContext(ctx).Where("ready=? AND id>?", false, after).Order("id").Limit(100).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		for _, row := range rows {
			after = row.ID
			ref, err := s.files.Recover(row.ID, row.MediaType)
			if errors.Is(err, os.ErrNotExist) {
				// No body can be claimed as complete. The source task is reconciled
				// independently to unknown by task-center startup recovery.
				if err := s.db.WithContext(ctx).Delete(&Record{}, "id=?", row.ID).Error; err != nil {
					return err
				}
				continue
			}
			if err != nil {
				return err
			}
			if err = s.Seal(ctx, ref); err != nil {
				return err
			}
		}
	}
}

// Cleanup follows source retention and also removes files left before a
// metadata insert committed. It shares the backup/write lock, not a new worker.
func (s *Service) Cleanup(ctx context.Context) error {
	if !s.storage.TryLock() {
		return errors.New("content writes are active; cleanup will run on the next retention pass")
	}
	defer s.storage.Unlock()
	var after uuid.UUID
	for {
		var rows []Record
		if err := s.db.WithContext(ctx).Where(`id>? AND (
			(source_type=? AND NOT EXISTS (SELECT 1 FROM task_runs WHERE task_runs.id=content_objects.source_id)
             AND NOT EXISTS (SELECT 1 FROM operation_records WHERE source_table='task_runs' AND source_id=content_objects.source_id)) OR
            (source_type='activity_detail' AND NOT EXISTS (SELECT 1 FROM operation_records WHERE operation_records.detail_content_id=content_objects.id)) OR
            (source_type='task_body' AND NOT EXISTS (SELECT 1 FROM task_runs WHERE task_runs.content_id=content_objects.id)
             AND NOT EXISTS (SELECT 1 FROM operation_records WHERE operation_records.task_content_id=content_objects.id)) OR
            (source_type='task_event' AND NOT EXISTS (SELECT 1 FROM task_events WHERE task_events.content_id=content_objects.id)) OR
			(source_type=? AND NOT EXISTS (SELECT 1 FROM ai_messages WHERE ai_messages.content_id=content_objects.id)
			 AND NOT EXISTS (SELECT 1 FROM ai_model_messages WHERE ai_model_messages.content_id=content_objects.id)
			 AND NOT EXISTS (SELECT 1 FROM ai_session_tasks WHERE ai_session_tasks.content_id=content_objects.id)
             AND NOT EXISTS (SELECT 1 FROM ai_session_tasks WHERE ai_session_tasks.public_content_id=content_objects.id)
             AND NOT EXISTS (SELECT 1 FROM ai_session_tasks WHERE ai_session_tasks.artifact_content_id=content_objects.id))
		)`, after, "task_run", "ai_session").Order("id").Limit(128).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			break
		}
		for _, row := range rows {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := s.files.Remove(row.ID); err != nil {
				return err
			}
			if err := s.db.WithContext(ctx).Delete(&Record{}, "id=?", row.ID).Error; err != nil {
				return err
			}
			after = row.ID
		}
	}
	return s.files.Scan(func(ids []uuid.UUID) error {
		var retained []uuid.UUID
		if err := s.db.WithContext(ctx).Model(&Record{}).Where("id IN ?", ids).Pluck("id", &retained).Error; err != nil {
			return err
		}
		keep := make(map[uuid.UUID]bool, len(retained))
		for _, id := range retained {
			keep[id] = true
		}
		for _, id := range ids {
			if err := ctx.Err(); err != nil {
				return err
			}
			if !keep[id] {
				if err := s.files.Remove(id); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
func (s *Service) SnapshotStorage(capture func() error) error {
	if !s.storage.TryLock() {
		return errors.New("content writes are active; retry backup when they finish")
	}
	defer s.storage.Unlock()
	return capture()
}
