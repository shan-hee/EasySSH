package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/protocol"
)

// History reads only the requested rows. Recovery loads a full record only
// when durable work was interrupted and no runtime is still executing it.
func (s *DesktopAIService) History(id string, input protocol.AIHistoryInput) (protocol.AIHistoryPage, error) {
	input, err := aiwire.NormalizeHistoryInput(input)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	database, err := s.database()
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	s.mu.Lock()
	request := s.activeRequests[id]
	var failure error
	if request != nil {
		failure = request.StorageErr
	}
	s.mu.Unlock()
	if failure != nil {
		return protocol.AIHistoryPage{}, failure
	}
	if request == nil {
		var interrupted bool
		if err := database.QueryRow(`SELECT status='running' OR EXISTS(SELECT 1 FROM desktop_ai_session_tasks t WHERE t.session_id=desktop_ai_sessions.id AND t.status IN ('running','queued')) FROM desktop_ai_sessions WHERE id=?`, id).Scan(&interrupted); err != nil {
			return protocol.AIHistoryPage{}, err
		}
		if interrupted {
			if _, err := s.loadIdleAISession(id); err != nil {
				return protocol.AIHistoryPage{}, err
			}
		}
	}
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := database.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	defer tx.Rollback()
	page, err := readDesktopAIHistoryPage(tx, id, input)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	if err := tx.Commit(); err != nil {
		return protocol.AIHistoryPage{}, err
	}
	return page, nil
}

func readDesktopAIHistoryPage(tx *sql.Tx, id string, input protocol.AIHistoryInput) (protocol.AIHistoryPage, error) {
	var updated string
	var messages, tasks int
	if err := tx.QueryRow(`SELECT updated_at,message_count,task_count FROM desktop_ai_sessions WHERE id=?`, id).Scan(&updated, &messages, &tasks); err != nil {
		return protocol.AIHistoryPage{}, err
	}

	table, total := "desktop_ai_messages", messages
	if input.Kind == "tasks" {
		table, total = "desktop_ai_session_tasks", tasks

	}
	after := -1
	if input.AfterID != "" {

		if err := tx.QueryRow("SELECT position FROM "+table+" WHERE session_id=? AND item_id=?", id, input.AfterID).Scan(&after); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return protocol.AIHistoryPage{}, aiwire.ErrHistoryCursor
			}
			return protocol.AIHistoryPage{}, err
		}
	}
	columns := "item_id,payload,content_hash,content_id"
	if input.Kind == "tasks" {
		columns = "item_id,public_payload,'',public_content_id"
	}
	rows, err := tx.Query("SELECT "+columns+" FROM "+table+" WHERE session_id=? AND position>? ORDER BY position,item_id LIMIT ?", id, after, input.Limit+1)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	items := make([]desktopAISessionItem, 0, input.Limit+1)
	for rows.Next() {
		var item desktopAISessionItem
		if err := rows.Scan(&item.ID, &item.Payload, &item.Hash, &item.ContentID); err != nil {
			rows.Close()
			return protocol.AIHistoryPage{}, err
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}

	ids := make([]string, len(items))
	for i := range items {
		ids[i] = items[i].ID
	}
	return aiwire.BuildHistoryDescriptorWindow(id, parseDesktopAITime(updated), input, total, ids, func(i int) (protocol.AIHistoryItem, error) {

		item := items[i]
		if item.ContentID.Valid {
			return desktopAIHistoryDescriptor(tx, id, item)
		}
		payload, err := loadDesktopAIItemPayload(tx, id, item)
		if err != nil {
			return protocol.AIHistoryItem{}, err
		}
		var identity struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(payload, &identity); err != nil {
			return protocol.AIHistoryItem{}, err
		}
		if identity.ID != item.ID {
			return protocol.AIHistoryItem{}, errors.New("AI history identity mismatch")
		}

		descriptor, err := aiwire.DescribeHistoryItem(item.ID, json.RawMessage(payload))
		if err != nil {
			return protocol.AIHistoryItem{}, err
		}
		if descriptor.Bytes > aiwire.MaxHistoryInlineBytes || input.Kind == "messages" && descriptor.Hash != item.Hash {
			return protocol.AIHistoryItem{}, errors.New("invalid persisted AI history projection")
		}
		return descriptor, nil
	})
}

// Read overview under the same edit/sync admission boundary as history.
func (s *DesktopAIService) loadHistorySession(id string) (desktopAISessionRecord, error) {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	return s.loadIdleAISession(id)
}
