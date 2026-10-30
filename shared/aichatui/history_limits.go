package aichatui

import (
	"encoding/json"
	"errors"
)

const (
	MaxHistoryBytes    = 64 << 20
	MaxHistoryMessages = 4096
	MaxHistoryTasks    = 4096
)

var ErrHistoryLimit = errors.New("AI 会话历史已达到规模上限，请整理历史或新建会话；已有结果会保留")

// ValidateHistoryGrowth controls admission, never persistence of observed results.
// It counts each full internal message/task JSON once, including reasoning,
// base64 attachments, arguments and artifact before/after bodies. Public views
// omit artifacts and must not be supplied here. Provider context and database
// projections are separate copies, so this is not an on-disk size guarantee.
// Work already admitted may finish beyond the threshold; its receipt must save.
func ValidateHistoryGrowth(messages []MessageView, tasks []TaskView) error {
	if len(messages) > MaxHistoryMessages || len(tasks) > MaxHistoryTasks {
		return ErrHistoryLimit
	}
	remaining := MaxHistoryBytes
	consume := func(value any) error {
		data, err := json.Marshal(value)
		if err != nil {
			return err
		}
		if len(data) > remaining {
			return ErrHistoryLimit
		}
		remaining -= len(data)
		return nil
	}
	// Marshal one item at a time rather than allocating another entire snapshot.
	for _, message := range messages {
		if err := consume(message); err != nil {
			return err
		}
	}
	for _, task := range tasks {
		if err := consume(task); err != nil {
			return err
		}
	}
	return nil
}
