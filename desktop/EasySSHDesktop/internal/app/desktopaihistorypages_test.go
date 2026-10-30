package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"testing"

	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/contentstore"
)

type desktopTestAIHistory struct {
	Messages []aichatui.MessageView
	Tasks    []aichatui.TaskView
}

func readDesktopAIHistory(t *testing.T, service *DesktopAIService, id string) desktopTestAIHistory {
	t.Helper()
	var history desktopTestAIHistory
	for _, kind := range []string{"messages", "tasks"} {
		input := protocol.AIHistoryInput{Kind: kind, Limit: 2}
		for {
			page, err := service.History(id, input)
			if err != nil {
				t.Fatal(err)
			}
			if err := aiwire.ValidateHistoryPage(id, input, page); err != nil {
				t.Fatal(err)
			}
			for _, item := range page.Items {
				raw := item.Data
				for len(raw) < item.Bytes {
					if item.Content == nil {
						t.Fatal("large history has no durable reference")
					}
					query := protocol.ContentReadInput{Sha256: item.Content.Sha256, Offset: int64(len(raw))}
					content := &DesktopContentService{database: service.database}
					chunk, err := content.ReadContent(context.Background(), item.Content.ID.String(), query)
					if err != nil {
						t.Fatal(err)
					}
					if err := contentstore.ValidateChunk(*item.Content, query, chunk); err != nil {
						t.Fatal(err)
					}
					data, err := base64.StdEncoding.DecodeString(chunk.Data)
					if err != nil || len(data) == 0 {
						t.Fatal("invalid content chunk", err)
					}
					raw = append(raw, data...)
				}
				if len(raw) != item.Bytes || aiwire.HistoryHash(raw) != item.Hash {
					t.Fatal("mixed history versions")
				}
				if kind == "messages" {
					var message aichatui.MessageView
					if err := json.Unmarshal(raw, &message); err != nil {
						t.Fatal(err)
					}
					history.Messages = append(history.Messages, message)
				} else {
					var task aichatui.TaskView
					if err := json.Unmarshal(raw, &task); err != nil {
						t.Fatal(err)
					}
					history.Tasks = append(history.Tasks, task)
				}
			}
			if !page.HasMore {
				break
			}
			input.AfterID = page.NextAfterID
		}
	}
	return history
}
