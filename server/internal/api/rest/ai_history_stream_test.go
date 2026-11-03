package rest

import (
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/stretchr/testify/require"
)

func TestLargeLiveTaskSendsStateWithoutBody(t *testing.T) {
	recorder := httptest.NewRecorder()
	stream := newAISDKUIMessageStreamer(recorder, false)
	task := runtime.TaskView{ID: "task", ToolCallID: "call", ToolName: "execute_command", Status: runtime.TaskStatusFailed, Result: strings.Repeat("large output", 10000), Error: strings.Repeat("large output", 10000), Artifact: &aiworkspace.FileArtifact{Content: "private artifact"}}
	done, err := stream.writeRuntimeEvent(runtime.Event{Type: runtime.EventTaskUpdated, SessionID: "session", Task: &task})
	require.NoError(t, err)
	require.False(t, done)
	change := protocol.AIHistoryChange{SessionID: "session", UpdatedAt: time.Now().UTC()}
	_, err = stream.writeRuntimeEvent(runtime.Event{Type: runtime.EventHistoryChanged, SessionID: "session", History: &change})
	require.NoError(t, err)
	chunks := parseSSEChunks(t, recorder)
	live, ok := findChunk(chunks, "data-workspace-task")
	require.True(t, ok, "a large result must not hide the task state")
	view := live["data"].(map[string]any)["task"].(map[string]any)
	require.Equal(t, string(runtime.TaskStatusFailed), view["status"])
	require.Nil(t, view["result"])
	_, ok = findChunk(chunks, "tool-output-error")
	require.True(t, ok)
	_, ok = findChunk(chunks, "data-history-changed")
	require.True(t, ok)
	require.NotContains(t, recorder.Body.String(), "private artifact")
	require.NotContains(t, recorder.Body.String(), "large output")
	require.Equal(t, strings.Repeat("large output", 10000), task.Result, "the stored task keeps its result")
}

func TestLiveTaskOutputSendsOnlyAppendedBytes(t *testing.T) {
	recorder := httptest.NewRecorder()
	stream := newAISDKUIMessageStreamer(recorder, false)
	output := strings.Repeat("界<&", 10000)
	task := runtime.TaskView{ID: "task", ToolName: "execute_command", Status: runtime.TaskStatusRunning, CommandOutput: output}
	for _, text := range []string{output, output, output + "done"} {
		task.CommandOutput = text
		_, err := stream.writeRuntimeEvent(runtime.Event{Type: runtime.EventTaskUpdated, SessionID: "session", Task: &task})
		require.NoError(t, err)
	}
	var restored string
	for _, chunk := range parseSSEChunks(t, recorder) {
		if chunk["type"] != "data-task-output-delta" {
			continue
		}
		raw, err := json.Marshal(chunk["data"])
		require.NoError(t, err)
		var delta protocol.AITaskOutputDelta
		require.NoError(t, json.Unmarshal(raw, &delta))
		require.NoError(t, aiwire.ValidateTaskOutputDelta("session", delta))
		if delta.Reset {
			restored = ""
		}
		require.Equal(t, len(restored), delta.Offset)
		restored += delta.Text
	}
	require.Equal(t, output+"done", restored)
}

func TestStreamSplitsLargeTextWithoutBreakingUTF8OrDuplicatingSentBytes(t *testing.T) {
	recorder := httptest.NewRecorder()
	stream := newAISDKUIMessageStreamer(recorder, false)
	text := strings.Repeat("界\x00<&", 10000)
	require.NoError(t, stream.writeTextPart(stream.textParts, "text", "message:text", text, false))
	require.NoError(t, stream.writeTextPart(stream.textParts, "text", "message:text", text+"final", true))
	var restored strings.Builder
	for _, chunk := range parseSSEChunks(t, recorder) {
		raw, err := json.Marshal(chunk)
		require.NoError(t, err)
		require.LessOrEqual(t, len(raw), aiwire.MaxStreamChunkBytes)
		if chunk["type"] == "text-delta" {
			delta := chunk["delta"].(string)
			require.True(t, utf8.ValidString(delta))
			restored.WriteString(delta)
		}
	}
	require.Equal(t, text+"final", restored.String())
}

func TestSessionUpdateCarriesCountsWithoutHistoricalBodies(t *testing.T) {
	recorder := httptest.NewRecorder()
	stream := newAISDKUIMessageStreamer(recorder, false)
	_, err := stream.writeRuntimeEvent(runtime.Event{Type: runtime.EventSessionUpdated, Session: &runtime.SessionView{ID: "session", Messages: []runtime.MessageView{{ID: "message", Content: "historical body"}}}})
	require.NoError(t, err)
	require.NotContains(t, recorder.Body.String(), "historical body")
	chunk, ok := findChunk(parseSSEChunks(t, recorder), "data-session")
	require.True(t, ok)
	require.EqualValues(t, 1, chunk["data"].(map[string]any)["message_count"])
}
