package app

import (
	"encoding/json"
	"errors"

	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/aiworkspace"
)

func desktopAIWireEvent(event DesktopAISessionEvent) (DesktopAISessionEvent, bool, error) {
	if event.Task != nil {
		task := *event.Task
		task.Artifact = nil
		task.CommandOutput = ""
		task.Arguments = aiworkspace.PublicArguments(task.ToolName, task.Arguments)
		item, err := aiwire.DescribeHistoryItem(task.ID, toAichatUITasks([]DesktopAITaskView{task})[0].Public())
		if err != nil {
			return DesktopAISessionEvent{}, false, err
		}
		if len(item.Data) == 0 {
			return DesktopAISessionEvent{}, false, nil // The successful save notifies history readers.
		} else {
			event.Task = &task
		}
	}
	raw, err := json.Marshal(event)
	if err != nil {
		return DesktopAISessionEvent{}, false, err
	}
	if len(raw) > aiwire.MaxStreamChunkBytes {
		return DesktopAISessionEvent{}, false, errors.New("AI live event exceeds frame budget")
	}
	return event, true, nil
}
