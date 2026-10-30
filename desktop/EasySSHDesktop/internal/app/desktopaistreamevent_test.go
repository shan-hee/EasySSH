package app

import (
	"strings"
	"testing"

	"github.com/easyssh/shared/aiworkspace"
)

func TestDesktopLiveTaskSeparatesOutputAndPrivateArtifact(t *testing.T) {
	task := DesktopAITaskView{ID: "task", ToolName: "execute_command", Status: DesktopAITaskRunning, CommandOutput: strings.Repeat("output", 10000), Artifact: &aiworkspace.FileArtifact{Content: "private"}}
	event, send, err := desktopAIWireEvent(DesktopAISessionEvent{SessionID: "session", Type: "task.updated", Task: &task})
	if err != nil || !send || event.Task == nil || event.Task.Artifact != nil || event.Task.CommandOutput != "" || event.History != nil {
		t.Fatal("task metadata leaked output or artifact", err)
	}
	if task.Artifact == nil || task.Artifact.Content != "private" || task.CommandOutput == "" {
		t.Fatal("stream conversion mutated stored task")
	}
	task.Result = strings.Repeat("large result", 10000)
	_, send, err = desktopAIWireEvent(DesktopAISessionEvent{SessionID: "session", Type: "task.updated", Task: &task})
	if err != nil || send {
		t.Fatal("uncommitted oversized task must wait for history commit", err)
	}
}
