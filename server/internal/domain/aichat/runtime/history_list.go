package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"strings"

	"github.com/easyssh/shared/aichatui"
	"gorm.io/gorm"
)

// UpdateListIndex is also used by the sync projection in the same transaction
// as its history update. These fields are derived data, never a second source.
func (record *AISessionRecord) UpdateListIndex(messages []MessageView, taskCount int) {
	title, _ := aichatui.SessionDisplayTitle(record.Title, messages, "新会话")
	index := aichatui.BuildSessionSearchIndex(messages)
	record.ListTitle, record.TitleFolded = title, strings.ToLower(title)
	record.SearchText, record.SearchFolded, record.Preview = index.Text, index.Folded, index.Preview
	record.MessageCount, record.TaskCount = len(messages), taskCount
}

func (s *gormSessionStore) List(ctx context.Context, actor protocol.Actor, queryText string, limit, offset int, filter SessionScope) ([]SessionListItem, int64, error) {
	queryText = aichatui.NormalizeSessionSearch(queryText)
	if len(queryText) > aichatui.MaxSessionSearchBytes {
		return nil, 0, aichatui.ErrSessionSearchTooLong
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	filter = normalizeSessionScope(filter)
	var total int64
	items := make([]SessionListItem, 0)
	options := &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true}
	if s.db.Dialector.Name() == "sqlite" {
		options = &sql.TxOptions{}
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := conversationQuery(tx.Model(&AISessionRecord{}), actor).Where("message_count > 0")
		if filter.Kind != "" {
			query = query.Where("scope_kind = ?", filter.Kind)
		}
		if filter.ServerID != "" {
			query = query.Where("scope_server_id = ?", filter.ServerID)
		}
		if filter.TerminalSessionID != "" {
			query = query.Where("scope_terminal_session_id = ?", filter.TerminalSessionID)
		}
		if queryText != "" {
			pattern := aichatui.SessionSearchPattern(queryText)
			query = query.Where("(title_folded LIKE ? ESCAPE '!' OR search_folded LIKE ? ESCAPE '!')", pattern, pattern)
		}
		if err := query.Count(&total).Error; err != nil {
			return err
		}
		preview := "preview"
		var args []any
		if queryText != "" {
			position := "INSTR(search_folded, ?)"
			switch tx.Dialector.Name() {
			case "mysql":
				position = "LOCATE(?, search_folded)"
			case "postgres":
				position = "STRPOS(search_folded, ?)"
			}
			preview = "CASE WHEN " + position + " > 0 THEN SUBSTR(search_text, CASE WHEN " + position + " > 48 THEN " + position + " - 48 ELSE 1 END, 180) ELSE preview END AS preview"
			args = []any{queryText, queryText, queryText}
		}
		var rows []AISessionRecord
		// Lists read only session metadata and an excerpt, never child message/task payloads.
		if err := query.Select("actor_kind,actor_id,actor_session_id,actor_grant_id,id,model,title,list_title,permission_mode,status,scope_json,message_count,task_count,created_at,updated_at,"+preview, args...).Order("updated_at DESC, id DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			var scope SessionScope
			if err := json.Unmarshal(row.ScopeJSON, &scope); err != nil {
				return err
			}
			items = append(items, SessionListItem{Actor: row.Actor, ID: row.ID, Model: row.Model, Title: row.ListTitle, CustomTitle: strings.TrimSpace(row.Title) != "", PermissionMode: row.PermissionMode, Status: SessionStatus(row.Status), Scope: scope, MessageCount: row.MessageCount, TaskCount: row.TaskCount, Preview: row.Preview, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt})
		}
		return nil
	}, options)
	return items, total, err
}
