package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"strconv"

	"github.com/easyssh/server/internal/domain/aichat/provider"
	"gorm.io/gorm"
)

// Each table contains one independently addressable item, never a conversation
// array. Model context includes tool-call/result messages not present in the UI.
type sessionItemRecord struct {
	ArtifactContentID *uuid.UUID `gorm:"type:char(36)"`
	ContentID         *uuid.UUID `gorm:"type:char(36);index:idx_ai_item_content"`
	SessionID         string     `gorm:"type:char(36);primaryKey;index:idx_ai_item_order,priority:1"`
	ItemID            string     `gorm:"type:varchar(256);primaryKey"`
	Position          int        `gorm:"not null;index:idx_ai_item_order,priority:2"`
	Payload           jsonText   `gorm:"type:text;not null"`
	ContentHash       string     `gorm:"type:char(64);not null"`
}

type AIMessageRecord struct {
	ContentID   *uuid.UUID `gorm:"type:char(36);index:idx_ai_messages_content"`
	SessionID   string     `gorm:"type:char(36);primaryKey;index:idx_ai_messages_order,priority:1"`
	ItemID      string     `gorm:"type:varchar(256);primaryKey"`
	Position    int        `gorm:"not null;index:idx_ai_messages_order,priority:2"`
	Payload     jsonText   `gorm:"type:text;not null"`
	ContentHash string     `gorm:"type:char(64);not null"`
}

func (AIMessageRecord) TableName() string { return "ai_messages" }

type AIModelMessageRecord struct {
	ContentID   *uuid.UUID `gorm:"type:char(36);index:idx_ai_model_messages_content"`
	SessionID   string     `gorm:"type:char(36);primaryKey;index:idx_ai_model_messages_order,priority:1"`
	ItemID      string     `gorm:"type:varchar(256);primaryKey"`
	Position    int        `gorm:"not null;index:idx_ai_model_messages_order,priority:2"`
	Payload     jsonText   `gorm:"type:text;not null"`
	ContentHash string     `gorm:"type:char(64);not null"`
}

func (AIModelMessageRecord) TableName() string { return "ai_model_messages" }

type AISessionTaskRecord struct {
	ArtifactContentID *uuid.UUID `gorm:"type:char(36);index:idx_ai_session_tasks_artifact_content"`
	PublicPayload     jsonText   `gorm:"type:text;not null"`
	PublicContentID   *uuid.UUID `gorm:"type:char(36);index:idx_ai_session_tasks_public_content"`
	ContentID         *uuid.UUID `gorm:"type:char(36);index:idx_ai_session_tasks_content"`
	SessionID         string     `gorm:"type:char(36);primaryKey;index:idx_ai_session_tasks_order,priority:1"`
	ItemID            string     `gorm:"type:varchar(256);primaryKey"`
	Position          int        `gorm:"not null;index:idx_ai_session_tasks_order,priority:2"`
	Payload           jsonText   `gorm:"type:text;not null"`
	ContentHash       string     `gorm:"type:char(64);not null"`
}

func (AISessionTaskRecord) TableName() string { return "ai_session_tasks" }

func makeSessionItem(sessionID, id string, position int, value any) (sessionItemRecord, error) {
	if id == "" || len(id) > 256 {
		return sessionItemRecord{}, errors.New("invalid AI history item ID")
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return sessionItemRecord{}, err
	}
	digest := sha256.Sum256(raw)
	return sessionItemRecord{SessionID: sessionID, ItemID: id, Position: position, Payload: jsonText(raw), ContentHash: hex.EncodeToString(digest[:])}, nil
}

// Parent metadata, changed items, list projection and native execution facts
// share one transaction. Unchanged item payloads are neither loaded nor written.
func saveSessionItems(tx *gorm.DB, snapshot SessionSnapshot, bodies *content.Service) error {
	messages := make([]sessionItemRecord, 0, len(snapshot.MessageViews))
	for i, value := range snapshot.MessageViews {
		row, err := makeSessionItem(snapshot.ID, value.ID, i, value)
		if err != nil {
			return err
		}
		messages = append(messages, row)
	}
	model := make([]sessionItemRecord, 0, len(snapshot.Messages))
	for i, value := range snapshot.Messages {
		row, err := makeSessionItem(snapshot.ID, strconv.Itoa(i), i, value)
		if err != nil {
			return err
		}
		model = append(model, row)
	}
	byID := make(map[string]PersistedTask, len(snapshot.Tasks))
	order := snapshot.TaskOrder
	if len(order) == 0 {
		order = make([]string, 0, len(snapshot.Tasks))
		for _, task := range snapshot.Tasks {
			order = append(order, task.View.ID)
		}
	}
	if len(order) != len(snapshot.Tasks) {
		return errors.New("AI task order does not match tasks")
	}
	for _, task := range snapshot.Tasks {
		if _, exists := byID[task.View.ID]; exists {
			return errors.New("duplicate AI task ID")
		}
		byID[task.View.ID] = task
	}
	tasks := make([]sessionItemRecord, 0, len(order))
	for i, id := range order {
		value, ok := byID[id]
		if !ok {
			return errors.New("AI task order references a missing task")
		}
		value.View.Artifact = nil // Stored once in the task's artifact body.
		row, err := makeSessionItem(snapshot.ID, id, i, value)
		if err != nil {
			return err
		}
		tasks = append(tasks, row)
	}
	for _, set := range []struct {
		table string
		rows  []sessionItemRecord
	}{
		{"ai_messages", messages}, {"ai_model_messages", model}, {"ai_session_tasks", tasks},
	} {
		if err := saveSessionItemSet(tx, bodies, set.table, snapshot.ID, snapshot.Actor, set.rows); err != nil {
			return err
		}
	}
	for _, task := range snapshot.Tasks {
		if err := saveSessionArtifact(tx, bodies, snapshot.ID, snapshot.Actor, task.View.ID, task.View.Artifact); err != nil {
			return err
		}
	}
	return nil
}

func saveSessionItemSet(tx *gorm.DB, bodies *content.Service, table, sessionID string, actor protocol.Actor, items []sessionItemRecord) error {
	var stored []sessionItemRecord
	if err := tx.Table(table).Select("item_id,position,content_hash").Where("session_id=?", sessionID).Find(&stored).Error; err != nil {
		return err
	}
	previous := make(map[string]sessionItemRecord, len(stored))
	for _, row := range stored {
		previous[row.ItemID] = row
	}
	seen := make(map[string]bool, len(items))
	for _, row := range items {
		if seen[row.ItemID] {
			return errors.New("duplicate AI history item ID")
		}
		seen[row.ItemID] = true
		old, exists := previous[row.ItemID]
		values := map[string]any{"position": row.Position}
		if !exists || old.ContentHash != row.ContentHash {
			if table == "ai_session_tasks" {
				var task PersistedTask
				if err := json.Unmarshal(row.Payload, &task); err != nil {
					return err
				}
				raw, err := json.Marshal(task.View.Public())
				if err != nil {
					return err
				}
				var publicID *uuid.UUID
				if len(raw) > 32<<10 {
					id, err := bodies.PutAIItem(tx, sessionID, actor, raw)
					if err != nil {
						return err
					}
					publicID, raw = &id, []byte("null")
				}
				values["public_payload"], values["public_content_id"] = jsonText(raw), publicID
			}
		}
		if (!exists || old.ContentHash != row.ContentHash) && len(row.Payload) > 32<<10 {
			id, err := bodies.PutAIItem(tx, sessionID, actor, row.Payload)
			if err != nil {
				return err
			}
			row.ContentID, row.Payload = &id, jsonText("null")
		}
		if !exists {
			values["session_id"], values["item_id"] = row.SessionID, row.ItemID
			values["payload"], values["content_hash"], values["content_id"] = row.Payload, row.ContentHash, row.ContentID
			if err := tx.Table(table).Create(values).Error; err != nil {
				return err
			}
		} else if old.ContentHash != row.ContentHash || old.Position != row.Position {
			if old.ContentHash != row.ContentHash {
				values["payload"], values["content_hash"], values["content_id"] = row.Payload, row.ContentHash, row.ContentID
			}
			if err := tx.Table(table).Where("session_id=? AND item_id=?", sessionID, row.ItemID).Updates(values).Error; err != nil {
				return err
			}
		}
		delete(previous, row.ItemID)
	}
	removed := make([]string, 0, len(previous))
	for id := range previous {
		removed = append(removed, id)
	}
	for len(removed) > 0 {
		count := min(len(removed), 100)
		if err := tx.Table(table).Where("session_id=? AND item_id IN ?", sessionID, removed[:count]).Delete(&sessionItemRecord{}).Error; err != nil {
			return err
		}
		removed = removed[count:]
	}
	return nil
}

// LoadSessionSnapshot is for trusted host code holding the content storage lock
// and the parent row's transaction/authorization boundary (or exclusive startup).
func LoadSessionSnapshot(tx *gorm.DB, record AISessionRecord, bodies *content.Service) (*SessionSnapshot, error) {
	snapshot, err := record.toSnapshot()
	if err != nil {
		return nil, err
	}
	for _, table := range []string{"ai_model_messages", "ai_messages", "ai_session_tasks"} {
		var rows []sessionItemRecord
		if err := tx.Table(table).Where("session_id=?", record.ID).Order("position,item_id").Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			payload, err := loadSessionItemPayload(tx, bodies, record.ID, record.Actor, row)
			if err != nil {
				return nil, err
			}
			switch table {
			case "ai_model_messages":
				var value provider.Message
				if err := json.Unmarshal(payload, &value); err != nil {
					return nil, err
				}
				snapshot.Messages = append(snapshot.Messages, value)
			case "ai_messages":
				var value MessageView
				if err := json.Unmarshal(payload, &value); err != nil {
					return nil, err
				}
				if value.ID != row.ItemID {
					return nil, errors.New("AI message identity mismatch")
				}
				snapshot.MessageViews = append(snapshot.MessageViews, value)
			case "ai_session_tasks":
				var value PersistedTask
				if err := json.Unmarshal(payload, &value); err != nil {
					return nil, err
				}
				if value.View.ID != row.ItemID {
					return nil, errors.New("AI task identity mismatch")
				}
				if row.ArtifactContentID != nil {
					ref, err := bodies.AIItemReference(tx, record.ID, record.Actor, *row.ArtifactContentID)
					if err != nil {
						return nil, err
					}
					raw, err := bodies.LoadAIItem(tx, record.ID, record.Actor, ref.ID, ref.Sha256)
					if err != nil {
						return nil, err
					}
					var file aiworkspace.FileArtifact
					if err := json.Unmarshal(raw, &file); err != nil {
						return nil, err
					}
					value.View.Artifact = &file
				}
				snapshot.Tasks = append(snapshot.Tasks, value)
				snapshot.TaskOrder = append(snapshot.TaskOrder, row.ItemID)
			}
		}
	}
	return snapshot, nil
}

func deleteSessionItems(tx *gorm.DB, id string) error {
	for _, table := range []string{"ai_model_messages", "ai_messages", "ai_session_tasks"} {
		if err := tx.Table(table).Where("session_id=?", id).Delete(&sessionItemRecord{}).Error; err != nil {
			return err
		}
	}
	return nil
}

// Caller holds the host content lock until its transaction completes.
func loadSessionItemPayload(tx *gorm.DB, bodies *content.Service, sessionID string, actor protocol.Actor, row sessionItemRecord) ([]byte, error) {
	if row.ContentID == nil {
		return row.Payload, nil
	}
	return bodies.LoadAIItem(tx, sessionID, actor, *row.ContentID, row.ContentHash)
}
