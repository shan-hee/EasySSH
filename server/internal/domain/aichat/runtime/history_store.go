package runtime

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/protocol"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *gormSessionStore) History(ctx context.Context, actor protocol.Actor, sessionID string, input protocol.AIHistoryInput) (protocol.AIHistoryPage, error) {
	input, err := aiwire.NormalizeHistoryInput(input)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	var page protocol.AIHistoryPage
	err = s.transaction(ctx, func(tx *gorm.DB) error {
		// Writers lock/update the same parent before changing items. Metadata,
		// cursor and page must describe one committed revision on every DB.
		var record AISessionRecord
		if err := conversationQuery(tx, actor).Select("id,updated_at,message_count,task_count,actor_kind,actor_id,actor_session_id,actor_grant_id").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND status<>?", sessionID, SessionStatusClosed).First(&record).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSessionNotFound
			}
			return err
		}
		table, total := "ai_messages", record.MessageCount
		if input.Kind == "tasks" {
			table, total = "ai_session_tasks", record.TaskCount
		}
		after := -1
		if input.AfterID != "" {
			var cursor sessionItemRecord
			if err := tx.Table(table).Select("position").Where("session_id=? AND item_id=?", sessionID, input.AfterID).Take(&cursor).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return aiwire.ErrHistoryCursor
				}
				return err
			}
			after = cursor.Position
		}
		columns := "item_id,payload,content_id,content_hash"
		if input.Kind == "tasks" {
			columns = "item_id,public_payload AS payload,public_content_id AS content_id"
		}
		var items []sessionItemRecord
		if err := tx.Table(table).Select(columns).Where("session_id=? AND position>?", sessionID, after).Order("position,item_id").Limit(input.Limit + 1).Find(&items).Error; err != nil {
			return err
		}
		ids := make([]string, len(items))
		for i := range items {
			ids[i] = items[i].ItemID
		}
		var err error
		page, err = aiwire.BuildHistoryDescriptorWindow(sessionID, record.UpdatedAt, input, total, ids, func(i int) (protocol.AIHistoryItem, error) {
			row := items[i]
			if row.ContentID != nil {
				ref, err := s.bodies.AIItemReference(tx, sessionID, record.Actor, *row.ContentID)
				if err != nil {
					return protocol.AIHistoryItem{}, err
				}
				if input.Kind == "messages" && ref.Sha256 != row.ContentHash {
					return protocol.AIHistoryItem{}, errors.New("AI history content hash mismatch")
				}
				return protocol.AIHistoryItem{ID: row.ItemID, Bytes: int(ref.Size), Hash: ref.Sha256, Content: &ref}, nil
			}
			var identity struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(row.Payload, &identity); err != nil {
				return protocol.AIHistoryItem{}, err
			}
			if identity.ID != row.ItemID {
				return protocol.AIHistoryItem{}, errors.New("AI history identity mismatch")
			}
			item, err := aiwire.DescribeHistoryItem(row.ItemID, json.RawMessage(row.Payload))
			if err != nil {
				return protocol.AIHistoryItem{}, err
			}
			if item.Bytes > aiwire.MaxHistoryInlineBytes || input.Kind == "messages" && item.Hash != row.ContentHash {
				return protocol.AIHistoryItem{}, errors.New("invalid persisted AI history projection")
			}
			return item, nil
		})
		return err
	})
	return page, err
}
