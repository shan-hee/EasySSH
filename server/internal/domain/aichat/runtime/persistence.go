package runtime

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/server/internal/domain/content"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type SessionStore interface {
	TaskFile(ctx context.Context, actor protocol.Actor, sessionID, taskID string) (protocol.ContentReference, error)
	Save(ctx context.Context, snapshot SessionSnapshot) error
	Get(ctx context.Context, actor protocol.Actor, sessionID string) (*SessionSnapshot, error)
	History(ctx context.Context, actor protocol.Actor, sessionID string, input protocol.AIHistoryInput) (protocol.AIHistoryPage, error)
	GetLatestActive(ctx context.Context, actor protocol.Actor) (*SessionSnapshot, error)
	List(ctx context.Context, actor protocol.Actor, query string, limit, offset int, filter SessionScope) ([]SessionListItem, int64, error)
	Delete(ctx context.Context, actor protocol.Actor, sessionID string) error
}

type AISessionRecord struct {
	ScopeJSON              jsonText       `gorm:"type:text;not null" json:"-"`
	ScopeKind              string         `gorm:"type:varchar(16);not null" json:"-"`
	ScopeServerID          string         `gorm:"type:varchar(80);not null" json:"-"`
	ScopeTerminalSessionID string         `gorm:"type:varchar(80);not null" json:"-"`
	ID                     string         `gorm:"type:char(36);primaryKey" json:"id"`
	Actor                  protocol.Actor `gorm:"embedded;embeddedPrefix:actor_" json:"actor"`
	Model                  string         `gorm:"type:text" json:"model"`
	Title                  string         `gorm:"type:text" json:"title"`
	PermissionMode         string         `gorm:"type:varchar(32);not null" json:"permission_mode"`
	Status                 string         `gorm:"type:varchar(32);not null;index" json:"status"`
	ListTitle              string         `gorm:"type:text;not null" json:"-"`
	TitleFolded            string         `gorm:"type:text;not null" json:"-"`
	SearchText             string         `gorm:"type:text;not null" json:"-"`
	SearchFolded           string         `gorm:"type:text;not null" json:"-"`
	Preview                string         `gorm:"type:text;not null" json:"-"`
	MessageCount           int            `gorm:"not null;default:0" json:"-"`
	TaskCount              int            `gorm:"not null;default:0" json:"-"`
	CreatedAt              time.Time      `gorm:"not null" json:"created_at"`
	UpdatedAt              time.Time      `gorm:"not null;index:idx_ai_sessions_actor_updated" json:"updated_at"`
	DeletedAt              gorm.DeletedAt `gorm:"index" json:"-"`
}

type jsonText []byte

func (j *jsonText) Scan(value interface{}) error {
	if j == nil {
		return errors.New("jsonText: Scan on nil receiver")
	}

	switch v := value.(type) {
	case nil:
		*j = jsonText("null")
	case []byte:
		if len(v) == 0 {
			*j = jsonText("null")
			return nil
		}
		*j = append((*j)[:0], v...)
	case string:
		if v == "" {
			*j = jsonText("null")
			return nil
		}
		*j = append((*j)[:0], v...)
	default:
		return fmt.Errorf("jsonText: unsupported Scan type %T", value)
	}
	return nil
}

func (j jsonText) Value() (driver.Value, error) {
	if len(j) == 0 {
		return "null", nil
	}
	return string(j), nil
}

func (j jsonText) MarshalJSON() ([]byte, error) {
	if len(j) == 0 {
		return []byte("null"), nil
	}
	return json.RawMessage(j).MarshalJSON()
}

func (AISessionRecord) TableName() string {
	return "ai_sessions"
}

type SessionSnapshot struct {
	// Runtime identity prevents a delayed callback from saving a reopened session.
	runtimeSession *session
	ID             string             `json:"id"`
	Actor          protocol.Actor     `json:"actor"`
	Model          string             `json:"model"`
	Title          string             `json:"title"`
	PermissionMode string             `json:"permission_mode"`
	Scope          SessionScope       `json:"scope,omitempty"`
	Status         SessionStatus      `json:"status"`
	CreatedAt      time.Time          `json:"created_at"`
	UpdatedAt      time.Time          `json:"updated_at"`
	Messages       []provider.Message `json:"messages"`
	MessageViews   []MessageView      `json:"message_views"`
	Tasks          []PersistedTask    `json:"tasks"`
	TaskOrder      []string           `json:"task_order"`
}

type PersistedTask struct {
	Execution *ExecutionOrigin  `json:"execution,omitempty"`
	ToolCall  registry.ToolCall `json:"tool_call"`
	View      TaskView          `json:"view"`
}

type gormSessionStore struct {
	db     *gorm.DB
	bodies *content.Service
}

func NewGormSessionStore(db *gorm.DB, bodies *content.Service) SessionStore {
	return &gormSessionStore{db: db, bodies: bodies}
}

func (s *gormSessionStore) transaction(ctx context.Context, fn func(*gorm.DB) error) error {
	return s.bodies.WithStorage(func() error { return s.db.WithContext(ctx).Transaction(fn) })
}

func (s *gormSessionStore) Save(ctx context.Context, snapshot SessionSnapshot) error {
	if !snapshot.Actor.Valid() {
		return access.ErrUnauthenticated
	}
	record, err := snapshot.toRecord()
	if err != nil {
		return err
	}

	return s.transaction(ctx, func(tx *gorm.DB) error {
		// Older in-flight snapshots must not overwrite an imported revision.
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&record)
		if result.Error != nil {
			return result.Error
		}
		updated := exactActorQuery(tx.Model(&AISessionRecord{}), record.Actor).Where("id=? AND updated_at<=?", record.ID, record.UpdatedAt).Updates(map[string]any{
			"scope_json": record.ScopeJSON, "scope_kind": record.ScopeKind, "scope_server_id": record.ScopeServerID, "scope_terminal_session_id": record.ScopeTerminalSessionID, "model": record.Model, "title": record.Title, "permission_mode": record.PermissionMode, "status": record.Status, "updated_at": record.UpdatedAt,
			"list_title": record.ListTitle, "title_folded": record.TitleFolded, "search_text": record.SearchText, "search_folded": record.SearchFolded, "preview": record.Preview, "message_count": record.MessageCount, "task_count": record.TaskCount,
		})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected > 0 {
			if err := saveSessionItems(tx, snapshot, s.bodies); err != nil {
				return err
			}
			return saveToolExecutions(tx, snapshot)
		}
		// MySQL may report zero changed metadata rows. A task-only update
		// can still change child rows; source invariants remain transactional.
		var stored AISessionRecord
		if err := exactActorQuery(tx, record.Actor).Where("id=?", record.ID).First(&stored).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSnapshotConflict
			}
			return err
		}
		precision := time.Nanosecond
		switch tx.Dialector.Name() {
		case "mysql":
			precision = time.Millisecond
		case "postgres":
			precision = time.Microsecond
		}
		if !sameSessionMetadata(stored, record, precision) {
			return ErrSnapshotConflict
		}
		if err := saveSessionItems(tx, snapshot, s.bodies); err != nil {
			return err
		}
		return saveToolExecutions(tx, snapshot)
	})
}

func sameSessionMetadata(a, b AISessionRecord, precision time.Duration) bool {
	return a.ID == b.ID && a.Actor == b.Actor && a.UpdatedAt.Truncate(precision).Equal(b.UpdatedAt.Truncate(precision)) &&
		a.Model == b.Model && a.Title == b.Title && a.PermissionMode == b.PermissionMode && a.Status == b.Status &&
		a.ListTitle == b.ListTitle && a.TitleFolded == b.TitleFolded && a.SearchText == b.SearchText && a.SearchFolded == b.SearchFolded && a.Preview == b.Preview && a.MessageCount == b.MessageCount && a.TaskCount == b.TaskCount &&
		a.ScopeKind == b.ScopeKind && a.ScopeServerID == b.ScopeServerID && a.ScopeTerminalSessionID == b.ScopeTerminalSessionID &&
		string(a.ScopeJSON) == string(b.ScopeJSON)
}

func (s *gormSessionStore) Get(ctx context.Context, actor protocol.Actor, sessionID string) (*SessionSnapshot, error) {
	var snapshot *SessionSnapshot
	err := s.transaction(ctx, func(tx *gorm.DB) error {
		var record AISessionRecord
		if err := conversationQuery(tx, actor).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", sessionID).First(&record).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSessionNotFound
			}
			return err
		}
		var err error
		snapshot, err = LoadSessionSnapshot(tx, record, s.bodies)
		return err
	})
	return snapshot, err
}

func (s *gormSessionStore) GetLatestActive(ctx context.Context, actor protocol.Actor) (*SessionSnapshot, error) {
	var snapshot *SessionSnapshot
	err := s.transaction(ctx, func(tx *gorm.DB) error {
		var record AISessionRecord
		if err := conversationQuery(tx, actor).Clauses(clause.Locking{Strength: "UPDATE"}).Where("status <> ? AND message_count > 0", SessionStatusClosed).Order("updated_at DESC,id DESC").First(&record).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSessionNotFound
			}
			return err
		}
		var err error
		snapshot, err = LoadSessionSnapshot(tx, record, s.bodies)
		return err
	})
	return snapshot, err
}

func (s *gormSessionStore) Delete(ctx context.Context, actor protocol.Actor, sessionID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var record AISessionRecord
		if err := conversationQuery(tx, actor).Clauses(clause.Locking{Strength: "UPDATE"}).Select("id,actor_kind,actor_id,actor_session_id,actor_grant_id").Where("id=?", sessionID).First(&record).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSessionNotFound
			}
			return err
		}
		if err := saveToolExecutions(tx, SessionSnapshot{ID: sessionID, Actor: record.Actor, UpdatedAt: time.Now().UTC()}); err != nil {
			return err
		}
		if err := deleteSessionItems(tx, sessionID); err != nil {
			return err
		}
		result := conversationQuery(tx, actor).Where("id=?", sessionID).Delete(&AISessionRecord{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrSessionNotFound
		}
		return nil
	})
}

func (snapshot SessionSnapshot) toRecord() (AISessionRecord, error) {
	scope := normalizeSessionScope(snapshot.Scope)
	scopeJSON, err := json.Marshal(scope)
	if err != nil {
		return AISessionRecord{}, err
	}

	record := AISessionRecord{
		ScopeJSON: jsonText(scopeJSON), ScopeKind: scope.Kind, ScopeServerID: scope.ServerID, ScopeTerminalSessionID: scope.TerminalSessionID,
		ID:             snapshot.ID,
		Actor:          snapshot.Actor,
		Model:          snapshot.Model,
		Title:          snapshot.Title,
		PermissionMode: snapshot.PermissionMode,
		Status:         string(snapshot.Status),
		CreatedAt:      snapshot.CreatedAt,
		UpdatedAt:      snapshot.UpdatedAt,
	}
	record.UpdateListIndex(snapshot.MessageViews, len(snapshot.Tasks))
	return record, nil
}

func (record AISessionRecord) toSnapshot() (*SessionSnapshot, error) {
	snapshot := SessionSnapshot{
		ID:             record.ID,
		Actor:          record.Actor,
		Model:          record.Model,
		Title:          record.Title,
		PermissionMode: record.PermissionMode,
		Status:         SessionStatus(record.Status),
		CreatedAt:      record.CreatedAt,
		UpdatedAt:      record.UpdatedAt,
	}

	if err := json.Unmarshal(record.ScopeJSON, &snapshot.Scope); err != nil {
		return nil, err
	}

	return &snapshot, nil
}

// ReplaceSyncedSession runs inside the sync transaction, after the runtime's
// WithSyncSession boundary. Synced tasks cannot create native execution facts.
func ReplaceSyncedSession(tx *gorm.DB, snapshot SessionSnapshot, bodies *content.Service) error {
	if snapshot.Actor.Kind != protocol.Owner || !snapshot.Actor.Valid() {
		return access.ErrForbidden
	}
	for _, task := range snapshot.Tasks {
		if task.Execution != nil {
			return ErrSnapshotConflict
		}
	}
	var current AISessionRecord
	err := tx.Unscoped().Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id=?", snapshot.ID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if err == nil && !sameConversationActor(current.Actor, snapshot.Actor) {
		return access.ErrForbidden
	}
	// Imported text is external to this executor. A later mode change cannot
	// silently promote imported instructions into the receiving owner's intent.
	for i := range snapshot.MessageViews {
		snapshot.MessageViews[i].ExternalContent = true
	}
	snapshot.PermissionMode = "readonly"
	snapshot.Scope = SessionScope{}
	snapshot.Status = SessionStatusIdle
	record, err := snapshot.toRecord()
	if err != nil {
		return err
	}
	if err := tx.Unscoped().Save(&record).Error; err != nil {
		return err
	}
	if err := saveSessionItems(tx, snapshot, bodies); err != nil {
		return err
	}
	return saveToolExecutions(tx, snapshot)
}
