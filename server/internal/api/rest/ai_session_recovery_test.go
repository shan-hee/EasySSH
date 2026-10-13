package rest

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

type recoveryTurnRunner struct {
	deltas chan string
	calls  atomic.Int32
}

func (r *recoveryTurnRunner) StreamTurn(ctx context.Context, _ provider.Config, _ provider.TurnRequest, onEvent func(provider.Event) error) (provider.TurnResult, error) {
	r.calls.Add(1)
	var content strings.Builder
	for {
		select {
		case <-ctx.Done():
			return provider.TurnResult{}, ctx.Err()
		case delta, ok := <-r.deltas:
			if !ok {
				return provider.TurnResult{Content: content.String()}, nil
			}
			content.WriteString(delta)
			if err := onEvent(provider.Event{Type: provider.EventTextDelta, Delta: delta}); err != nil {
				return provider.TurnResult{}, err
			}
		}
	}
}

func readRecoverySnapshot(t *testing.T, scanner *bufio.Scanner, match func(runtime.SessionView) bool) runtime.SessionView {
	t.Helper()
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: {") {
			continue
		}
		var chunk struct {
			Type string              `json:"type"`
			Data runtime.SessionView `json:"data"`
		}
		require.NoError(t, json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &chunk))
		if chunk.Type == "data-session-snapshot" && match(chunk.Data) {
			return chunk.Data
		}
	}
	require.NoError(t, scanner.Err())
	t.Fatal("recovery stream ended before the expected snapshot")
	return runtime.SessionView{}
}

func TestAIChatRecoveryCatchesUpAndContinuesWithoutStartingAnotherTurn(t *testing.T) {
	userID := uuid.New()
	runner := &recoveryTurnRunner{deltas: make(chan string, 4)}
	manager := runtime.NewManager(restFakeResolver{config: provider.Config{Model: "fake-model"}}, runner, nil, time.Minute)
	session, err := manager.CreateSession(context.Background(), userID, runtime.CreateSessionInput{})
	require.NoError(t, err)
	server := httptest.NewServer(newTestAISessionRouter(userID, NewAISessionHandler(manager)))
	defer server.Close()
	defer manager.CancelSession(context.Background(), userID, session.ID)
	client := &http.Client{Timeout: 5 * time.Second}

	body, err := json.Marshal(chatRequestBody("hello", nil))
	require.NoError(t, err)
	requestCtx, disconnect := context.WithCancel(context.Background())
	defer disconnect()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, server.URL+"/sessions/"+session.ID+"/chat", bytes.NewReader(body))
	require.NoError(t, err)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, http.StatusOK, response.StatusCode)
	runner.deltas <- "before disconnect"
	scanner := bufio.NewScanner(response.Body)
	for scanner.Scan() {
		if strings.Contains(scanner.Text(), `"type":"text-delta"`) {
			break
		}
	}
	require.NoError(t, scanner.Err())
	disconnect()
	response.Body.Close()

	// The provider continues while the browser has no subscription.
	runner.deltas <- ", while offline"
	require.Eventually(t, func() bool {
		view, err := manager.GetSession(userID, session.ID)
		return err == nil && len(view.Messages) == 2 && view.Messages[1].Content == "before disconnect, while offline"
	}, time.Second, 5*time.Millisecond)

	resumeURL := server.URL + "/sessions/" + session.ID + "/chat/stream"
	recovered, err := client.Get(resumeURL)
	require.NoError(t, err)
	defer recovered.Body.Close()
	require.Equal(t, http.StatusOK, recovered.StatusCode)
	scanner = bufio.NewScanner(recovered.Body)
	first := readRecoverySnapshot(t, scanner, func(runtime.SessionView) bool { return true })
	require.Equal(t, runtime.SessionStatusRunning, first.Status)
	require.Equal(t, "before disconnect, while offline", first.Messages[1].Content)

	runner.deltas <- ", after reconnect"
	live := readRecoverySnapshot(t, scanner, func(view runtime.SessionView) bool {
		return len(view.Messages) == 2 && strings.HasSuffix(view.Messages[1].Content, ", after reconnect")
	})
	require.Equal(t, runtime.SessionStatusRunning, live.Status, "new output must arrive before generation finishes")
	close(runner.deltas)
	final := readRecoverySnapshot(t, scanner, func(view runtime.SessionView) bool { return view.Status == runtime.SessionStatusIdle })
	require.Equal(t, "before disconnect, while offline, after reconnect", final.Messages[1].Content)
	foundDone := false
	for scanner.Scan() {
		foundDone = foundDone || scanner.Text() == "data: [DONE]"
	}
	require.NoError(t, scanner.Err())
	require.True(t, foundDone)
	require.EqualValues(t, 1, runner.calls.Load())

	// Reconnecting after completion returns the final state and closes immediately.
	completed, err := client.Get(resumeURL)
	require.NoError(t, err)
	defer completed.Body.Close()
	readRecoverySnapshot(t, bufio.NewScanner(completed.Body), func(view runtime.SessionView) bool { return view.Status == runtime.SessionStatusIdle })
	require.EqualValues(t, 1, runner.calls.Load())

	otherUser := newTestAISessionRouter(uuid.New(), NewAISessionHandler(manager))
	denied := performJSONRequest(t, otherUser, http.MethodGet, "/sessions/"+session.ID+"/chat/stream", nil)
	require.Equal(t, http.StatusNotFound, denied.Code)
}
