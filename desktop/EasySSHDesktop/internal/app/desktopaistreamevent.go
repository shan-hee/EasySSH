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
		fits, err := desktopAILiveTaskFits(task)
		if err != nil {
			return DesktopAISessionEvent{}, false, err
		}
		if !fits {
			// Committed history carries the full result. The live event still
			// reports the state, so a large command does not look stuck.
			task.Result, task.Error = "", ""
			if fits, err = desktopAILiveTaskFits(task); err != nil || !fits {
				return DesktopAISessionEvent{}, false, err
			}
		}
		event.Task = &task
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

// The inline history budget bounds a live task event; its hash is never sent.
func desktopAILiveTaskFits(task DesktopAITaskView) (bool, error) {
	item, err := aiwire.DescribeHistoryItem(task.ID, toAichatUITasks([]DesktopAITaskView{task})[0].Public())
	return len(item.Data) > 0, err
}
