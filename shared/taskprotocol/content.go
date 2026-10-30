package taskprotocol

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"strings"
	"unicode/utf8"
)

const MaxInlineContentBytes = 32 << 10
const MaxOverviewTextBytes = 512

var ErrContentQuery = errors.New("invalid task content query")

func DescribeContent(value any) (protocol.TaskContent, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return protocol.TaskContent{}, err
	}
	if len(raw) > MaxInlineContentBytes {
		return protocol.TaskContent{}, errors.New("task body must be stored before it is described")
	}
	return protocol.TaskContent{Bytes: len(raw), Hash: contentHash(raw), Data: raw}, nil
}
func ValidateContent(content protocol.TaskContent) error {
	if content.Bytes < 1 || !validContentHash(content.Hash) {
		return ErrContentQuery
	}
	if content.Content != nil {
		ref := *content.Content
		if contentstore.ValidateReference(ref) != nil || ref.MediaType != "application/json" || ref.Size != int64(content.Bytes) || ref.Sha256 != content.Hash || len(content.Data) != 0 {
			return ErrContentQuery
		}
		return nil
	}
	if content.Bytes <= MaxInlineContentBytes {
		if len(content.Data) != content.Bytes || contentHash(content.Data) != content.Hash || !json.Valid(content.Data) {
			return ErrContentQuery
		}
	} else {
		return ErrContentQuery
	}
	return nil
}

// PreviewText bounds display text only. Callers declare changed fields and keep
// full display metadata in task details; IDs, authorization and execution never use previews.
func PreviewText(text string) (string, bool) {
	original := text
	text = strings.ToValidUTF8(text, "�")
	text = strings.ReplaceAll(text, "\x00", "�")
	if len(text) > MaxOverviewTextBytes {
		end := MaxOverviewTextBytes
		for end > 0 && !utf8.RuneStart(text[end]) {
			end--
		}
		text = text[:end]
	}
	return text, text != original
}

func OverviewOf(summary protocol.TaskRunSummary) protocol.TaskOverview {
	result := protocol.TaskOverview{WorkID: summary.WorkID, ParentWorkID: summary.ParentWorkID, WorkStartedAt: summary.WorkStartedAt, Actor: summary.Actor, ID: summary.ID, DefinitionID: summary.DefinitionID, RetryOfID: summary.RetryOfID, SourceType: summary.SourceType, SourceID: summary.SourceID, TaskType: summary.TaskType, Title: summary.Title, TriggerType: summary.TriggerType, Runner: summary.Runner, Status: summary.Status, Stage: summary.Stage, ServerID: summary.ServerID, ServerName: summary.ServerName, Resource: summary.Resource, Progress: summary.Progress, TotalCount: summary.TotalCount, SuccessCount: summary.SuccessCount, FailureCount: summary.FailureCount, BytesTotal: summary.BytesTotal, BytesProcessed: summary.BytesProcessed, Cancelable: summary.Cancelable, Retryable: summary.Retryable, Attempt: summary.Attempt, MaxAttempts: summary.MaxAttempts, ErrorCode: summary.ErrorCode, ErrorMessage: summary.ErrorMessage, CancelRequestedAt: summary.CancelRequestedAt, StartedAt: summary.StartedAt, FinishedAt: summary.FinishedAt, CreatedAt: summary.CreatedAt, UpdatedAt: summary.UpdatedAt}
	for _, field := range []struct {
		name  string
		value *string
	}{{"title", &result.Title}, {"stage", &result.Stage}, {"server_name", &result.ServerName}, {"resource", &result.Resource}, {"error_message", &result.ErrorMessage}} {
		value, changed := PreviewText(*field.value)
		*field.value = value
		if changed {
			result.TruncatedFields = append(result.TruncatedFields, field.name)
		}
	}
	return result
}
func ValidOverviewText(view protocol.TaskOverview) bool {
	for _, text := range []string{view.Title, view.Stage, view.ServerName, view.Resource, view.ErrorMessage} {
		if len(text) > MaxOverviewTextBytes || !utf8.ValidString(text) || strings.ContainsRune(text, 0) {
			return false
		}
	}
	seen := map[string]bool{}
	for _, field := range view.TruncatedFields {
		switch field {
		case "title", "stage", "server_name", "resource", "error_message":
		default:
			return false
		}
		if seen[field] {
			return false
		}
		seen[field] = true
	}
	return true
}

func RunOverview(run protocol.TaskRun) protocol.TaskOverview {
	return OverviewOf(protocol.TaskRunSummary{WorkID: run.WorkID, ParentWorkID: run.ParentWorkID, WorkStartedAt: run.WorkStartedAt, Actor: run.Actor, ID: run.ID, DefinitionID: run.DefinitionID, RetryOfID: run.RetryOfID, SourceType: run.SourceType, SourceID: run.SourceID, TaskType: run.TaskType, Title: run.Title, TriggerType: run.TriggerType, Runner: run.Runner, Status: run.Status, Stage: run.Stage, ServerID: run.ServerID, ServerName: run.ServerName, Resource: run.Resource, Progress: run.Progress, TotalCount: run.TotalCount, SuccessCount: run.SuccessCount, FailureCount: run.FailureCount, BytesTotal: run.BytesTotal, BytesProcessed: run.BytesProcessed, Cancelable: run.Cancelable, Retryable: run.Retryable, Attempt: run.Attempt, MaxAttempts: run.MaxAttempts, ErrorCode: run.ErrorCode, ErrorMessage: run.ErrorMessage, CancelRequestedAt: run.CancelRequestedAt, StartedAt: run.StartedAt, FinishedAt: run.FinishedAt, CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt})
}

func contentHash(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func validContentHash(hash string) bool {
	if len(hash) != 64 || hash != strings.ToLower(hash) {
		return false
	}
	_, err := hex.DecodeString(hash)
	return err == nil
}
