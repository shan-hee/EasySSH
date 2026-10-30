package aichatui

import (
	"errors"
	"strings"
	"testing"

	"github.com/easyssh/shared/aiworkspace"
)

func TestHistoryGrowthCountsReasoningAndInternalArtifacts(t *testing.T) {
	chunk := strings.Repeat("x", 1<<20)
	messages := make([]MessageView, 64)
	for i := range messages {
		messages[i] = MessageView{Role: "assistant", Reasoning: chunk}
	}
	if err := ValidateHistoryGrowth(messages, nil); !errors.Is(err, ErrHistoryLimit) {
		t.Fatalf("reasoning escaped history budget: %v", err)
	}
	for _, field := range []string{"artifact", "arguments", "output", "attachments"} {
		t.Run(field, func(t *testing.T) {
			tasks := make([]TaskView, 64)
			var views []MessageView
			for i := range tasks {
				switch field {
				case "artifact":
					tasks[i].Artifact = &aiworkspace.FileArtifact{Before: &chunk}
				case "arguments":
					tasks[i].Arguments = map[string]any{"content": chunk}
				case "output":
					tasks[i].CommandOutput = chunk
				case "attachments":
					views = append(views, MessageView{Attachments: []AttachmentView{{Data: chunk}}})
				}
			}
			if err := ValidateHistoryGrowth(views, tasks); !errors.Is(err, ErrHistoryLimit) {
				t.Fatalf("%s escaped history budget: %v", field, err)
			}
		})
	}
	// Counting must not consume, truncate or redact saved facts.
	if messages[0].Reasoning != chunk {
		t.Fatal("history mutated")
	}
}

func TestHistoryGrowthCountLimits(t *testing.T) {
	if err := ValidateHistoryGrowth(make([]MessageView, MaxHistoryMessages), make([]TaskView, MaxHistoryTasks)); err != nil {
		t.Fatal(err)
	}
	if err := ValidateHistoryGrowth(make([]MessageView, MaxHistoryMessages+1), nil); !errors.Is(err, ErrHistoryLimit) {
		t.Fatal(err)
	}
	if err := ValidateHistoryGrowth(nil, make([]TaskView, MaxHistoryTasks+1)); !errors.Is(err, ErrHistoryLimit) {
		t.Fatal(err)
	}
}
