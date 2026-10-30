package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiprovider"
)

type desktopAIHistoryIndex struct {
	aichatui.SessionSearchIndex
	Title, TitleFolded string
}

func desktopAIHistoryProjection(title string, custom bool, messages []aichatui.MessageView) desktopAIHistoryIndex {
	if !custom {
		title = ""
	}
	title, _ = aichatui.SessionDisplayTitle(title, messages, "New session")
	return desktopAIHistoryIndex{SessionSearchIndex: aichatui.BuildSessionSearchIndex(messages), Title: title, TitleFolded: strings.ToLower(title)}
}

func (s *DesktopAIService) ListSessions(params DesktopAIListSessionsParams) (DesktopAIListSessionsResult, error) {
	params = normalizeDesktopAIListParams(params)
	if len(params.Q) > aichatui.MaxSessionSearchBytes {
		return DesktopAIListSessionsResult{}, aichatui.ErrSessionSearchTooLong
	}
	if params.Page > 1000000 {
		return DesktopAIListSessionsResult{}, errors.New("invalid_pagination")
	}
	db, err := s.database()
	if err != nil {
		return DesktopAIListSessionsResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return DesktopAIListSessionsResult{}, err
	}
	defer tx.Rollback()
	where, args := buildDesktopAIWhere(params)
	var total int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM desktop_ai_sessions WHERE "+where, args...).Scan(&total); err != nil {
		return DesktopAIListSessionsResult{}, err
	}
	preview := "preview"
	var selectArgs []any
	if params.Q != "" {
		position := "INSTR(search_folded, ?)"
		preview = "CASE WHEN " + position + " > 0 THEN SUBSTR(search_text, CASE WHEN " + position + " > 48 THEN " + position + " - 48 ELSE 1 END, 180) ELSE preview END"
		selectArgs = []any{params.Q, params.Q, params.Q}
	}
	query := "SELECT id,list_title,custom_title,model,permission_mode,scope_json,status,message_count,task_count,created_at,updated_at," + preview + " FROM desktop_ai_sessions WHERE " + where + " ORDER BY updated_at DESC,created_at DESC,id DESC LIMIT ? OFFSET ?"
	selectArgs = append(selectArgs, args...)
	selectArgs = append(selectArgs, params.Limit, (params.Page-1)*params.Limit)
	rows, err := tx.QueryContext(ctx, query, selectArgs...)
	if err != nil {
		return DesktopAIListSessionsResult{}, err
	}
	defer rows.Close()
	result := DesktopAIListSessionsResult{Items: make([]DesktopAISessionListItem, 0), Total: total}
	for rows.Next() {
		var item DesktopAISessionListItem
		var custom int
		var scopeJSON, permissionMode, status string
		if err = rows.Scan(&item.ID, &item.Title, &custom, &item.Model, &permissionMode, &scopeJSON, &status, &item.MessageCount, &item.TaskCount, &item.CreatedAt, &item.UpdatedAt, &item.Preview); err != nil {
			return DesktopAIListSessionsResult{}, err
		}
		item.CustomTitle = custom == 1
		item.PermissionMode = DesktopAIPermissionMode(permissionMode)
		item.Status = DesktopAISessionStatus(status)
		item.Scope = decodeDesktopAIScope(scopeJSON)
		result.Items = append(result.Items, item)
	}
	if err = rows.Err(); err != nil {
		return DesktopAIListSessionsResult{}, err
	}
	if err = rows.Close(); err != nil {
		return DesktopAIListSessionsResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return DesktopAIListSessionsResult{}, err
	}
	return result, nil
}

func validateDesktopAIHistoryGrowth(record desktopAISessionRecord) error {
	if err := aichatui.ValidateHistoryGrowth(toAichatUIMessages(record.Messages), toAichatUITasks(record.Tasks)); err != nil {
		return aiprovider.NewLimitError("ai_history_limit", err.Error())
	}
	return nil
}

func validateDesktopAIContext(record desktopAISessionRecord, contextText string) error {
	if err := aiprovider.ValidateContext(desktopAIProviderMessages(record, contextText)); err != nil {
		return err
	}
	return validateDesktopAIHistoryGrowth(record)
}
