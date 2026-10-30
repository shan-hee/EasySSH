package rest

import (
	"encoding/base64"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"net/url"
	"strconv"
	"testing"

	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/contentstore"
	"github.com/stretchr/testify/require"
)

type testAIHistory struct {
	Messages []aichatui.MessageView
	Tasks    []aichatui.TaskView
}

func readAIHistory(t *testing.T, router http.Handler, id string) testAIHistory {
	t.Helper()
	var history testAIHistory
	for _, kind := range []string{"messages", "tasks"} {
		input := protocol.AIHistoryInput{Kind: kind, Limit: 2}
		for {
			query := url.Values{"kind": {kind}, "after_id": {input.AfterID}, "limit": {strconv.Itoa(input.Limit)}}
			response := performJSONRequest(t, router, http.MethodGet, "/sessions/"+id+"/history?"+query.Encode(), nil)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var page protocol.AIHistoryPage
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &page))
			require.NoError(t, aiwire.ValidateHistoryPage(id, input, page))
			for _, item := range page.Items {
				raw := item.Data
				for len(raw) < item.Bytes {
					require.NotNil(t, item.Content)
					chunkInput := protocol.ContentReadInput{Sha256: item.Content.Sha256, Offset: int64(len(raw))}
					query := url.Values{"sha256": {chunkInput.Sha256}, "offset": {strconv.Itoa(len(raw))}}
					response := performJSONRequest(t, router, http.MethodGet, "/content/"+item.Content.ID.String()+"/bytes?"+query.Encode(), nil)
					require.Equal(t, http.StatusOK, response.Code, response.Body.String())
					var chunk protocol.ContentChunk
					require.NoError(t, json.Unmarshal(response.Body.Bytes(), &chunk))
					require.NoError(t, contentstore.ValidateChunk(*item.Content, chunkInput, chunk))
					data, err := base64.StdEncoding.DecodeString(chunk.Data)
					require.NoError(t, err)
					require.NotEmpty(t, data)
					raw = append(raw, data...)
				}
				require.Len(t, raw, item.Bytes)
				require.Equal(t, item.Hash, aiwire.HistoryHash(raw))
				if kind == "messages" {
					var message aichatui.MessageView
					require.NoError(t, json.Unmarshal(raw, &message))
					history.Messages = append(history.Messages, message)
				} else {
					var task aichatui.TaskView
					require.NoError(t, json.Unmarshal(raw, &task))
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
