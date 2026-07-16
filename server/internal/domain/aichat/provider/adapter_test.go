package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFactoryNormalizesOpenAITextAndChunkedToolCalls(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/chat/completions", r.URL.Path)
		w.Header().Set("Content-Type", "text/event-stream")

		writeSSEData(t, w, `{"id":"chunk-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"content":"正在"},"finish_reason":""}]}`)
		writeSSEData(t, w, `{"id":"chunk-2","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"content":"查询"},"finish_reason":""}]}`)
		writeSSEData(t, w, `{"id":"chunk-3","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"list_servers","arguments":"{\"status\":\"on"}}]},"finish_reason":""}]}`)
		writeSSEData(t, w, `{"id":"chunk-4","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"type":"function","function":{"arguments":"line\"}"}}]},"finish_reason":"tool_calls"}]}`)
		_, err := w.Write([]byte("data: [DONE]\n\n"))
		require.NoError(t, err)
	}))
	defer server.Close()

	var events []Event
	result, err := NewFactory().StreamTurn(
		context.Background(),
		Config{Provider: "openai", APIKey: "test-key", Endpoint: server.URL},
		TurnRequest{Model: "test-model", Messages: []Message{{Role: "user", Content: "列出在线服务器"}}},
		func(event Event) error {
			if event.Type == EventTextDelta {
				events = append(events, event)
			}
			return nil
		},
	)

	require.NoError(t, err)
	require.Equal(t, "正在查询", result.Content)
	require.Equal(t, []Event{
		{Type: EventTextDelta, Delta: "正在"},
		{Type: EventTextDelta, Delta: "查询"},
	}, events)
	require.Len(t, result.ToolCalls, 1)
	require.Equal(t, "call-1", result.ToolCalls[0].ID)
	require.Equal(t, "list_servers", result.ToolCalls[0].Name)
	require.JSONEq(t, `{"status":"online"}`, string(result.ToolCalls[0].Arguments))
}

func TestFactoryKeepsOpenAIToolCallOrderWithoutIndexes(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		writeSSEData(t, w, `{"id":"chunk-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"tool_calls":[{"id":"call-a","type":"function","function":{"name":"list_servers","arguments":"{}"}},{"id":"call-b","type":"function","function":{"name":"get_server_metrics","arguments":"{\"server_id\":\"srv"}}]},"finish_reason":""}]}`)
		writeSSEData(t, w, `{"id":"chunk-2","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"tool_calls":[{"id":"call-b","type":"function","function":{"arguments":"-1\"}"}}]},"finish_reason":"tool_calls"}]}`)
		_, err := w.Write([]byte("data: [DONE]\n\n"))
		require.NoError(t, err)
	}))
	defer server.Close()

	result, err := NewFactory().StreamTurn(
		context.Background(),
		Config{Provider: "openai", APIKey: "test-key", Endpoint: server.URL},
		TurnRequest{Model: "test-model", Messages: []Message{{Role: "user", Content: "查询服务器"}}},
		func(Event) error { return nil },
	)

	require.NoError(t, err)
	require.Len(t, result.ToolCalls, 2)
	require.Equal(t, "call-a", result.ToolCalls[0].ID)
	require.Equal(t, "list_servers", result.ToolCalls[0].Name)
	require.JSONEq(t, `{}`, string(result.ToolCalls[0].Arguments))
	require.Equal(t, "call-b", result.ToolCalls[1].ID)
	require.Equal(t, "get_server_metrics", result.ToolCalls[1].Name)
	require.JSONEq(t, `{"server_id":"srv-1"}`, string(result.ToolCalls[1].Arguments))
}

func TestFactoryUsesOpenAIResponsesAPI(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/responses", r.URL.Path)
		w.Header().Set("Content-Type", "text/event-stream")

		writeSSEData(t, w, `{"type":"response.created","sequence_number":0,"response":{"id":"resp-1","model":"test-model","status":"in_progress"}}`)
		writeSSEData(t, w, `{"type":"response.output_text.delta","sequence_number":1,"item_id":"msg-1","output_index":0,"content_index":0,"delta":"正在查询"}`)
		writeSSEData(t, w, `{"type":"response.output_item.added","sequence_number":2,"output_index":1,"item":{"id":"fc-1","type":"function_call","call_id":"call-1","name":"get_server_info","arguments":""}}`)
		writeSSEData(t, w, `{"type":"response.function_call_arguments.delta","sequence_number":3,"item_id":"fc-1","output_index":1,"delta":"{\"server_id\":\"srv-1\"}"}`)
		writeSSEData(t, w, `{"type":"response.output_item.done","sequence_number":4,"output_index":1,"item":{"id":"fc-1","type":"function_call","call_id":"call-1","name":"get_server_info","arguments":"{\"server_id\":\"srv-1\"}"}}`)
		writeSSEData(t, w, `{"type":"response.completed","sequence_number":5,"response":{"id":"resp-1","model":"test-model","status":"completed","service_tier":"default","usage":{"input_tokens":10,"input_tokens_details":{"cached_tokens":2,"cache_write_tokens":0},"output_tokens":4,"output_tokens_details":{"reasoning_tokens":1},"total_tokens":14}}}`)
	}))
	defer server.Close()

	result, err := NewFactory().StreamTurn(
		context.Background(),
		Config{Provider: "openai-response", APIKey: "test-key", Endpoint: server.URL},
		TurnRequest{Model: "test-model", Messages: []Message{{Role: "user", Content: "查询服务器"}}},
		func(Event) error { return nil },
	)

	require.NoError(t, err)
	require.Equal(t, "正在查询", result.Content)
	require.Equal(t, "responses", result.Metadata.API)
	require.Equal(t, "resp-1", result.Metadata.ResponseID)
	require.Equal(t, int64(14), result.Usage.TotalTokens)
	require.Len(t, result.ToolCalls, 1)
	require.Equal(t, "call-1", result.ToolCalls[0].ID)
	require.Equal(t, "get_server_info", result.ToolCalls[0].Name)
	require.JSONEq(t, `{"server_id":"srv-1"}`, string(result.ToolCalls[0].Arguments))
}

func TestFactoryNormalizesAnthropicTextAndToolUse(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/messages", r.URL.Path)
		w.Header().Set("Content-Type", "text/event-stream")

		writeSSEEvent(t, w, "message_start", `{"type":"message_start","message":{"id":"msg-1","type":"message","role":"assistant","content":[],"model":"claude-test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}`)
		writeSSEEvent(t, w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
		writeSSEEvent(t, w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"正在"}}`)
		writeSSEEvent(t, w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"查询"}}`)
		writeSSEEvent(t, w, "content_block_stop", `{"type":"content_block_stop","index":0}`)
		writeSSEEvent(t, w, "content_block_start", `{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu-1","name":"list_servers","input":{}}}`)
		writeSSEEvent(t, w, "content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"status\":\"on"}}`)
		writeSSEEvent(t, w, "content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"line\"}"}}`)
		writeSSEEvent(t, w, "content_block_stop", `{"type":"content_block_stop","index":1}`)
		writeSSEEvent(t, w, "message_delta", `{"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":12}}`)
		writeSSEEvent(t, w, "message_stop", `{"type":"message_stop"}`)
	}))
	defer server.Close()

	var events []Event
	result, err := NewFactory().StreamTurn(
		context.Background(),
		Config{Provider: "anthropic", APIKey: "test-key", Endpoint: server.URL},
		TurnRequest{Model: "claude-test", Messages: []Message{{Role: "user", Content: "列出在线服务器"}}},
		func(event Event) error {
			if event.Type == EventTextDelta {
				events = append(events, event)
			}
			return nil
		},
	)

	require.NoError(t, err)
	require.Equal(t, "正在查询", result.Content)
	require.Equal(t, []Event{
		{Type: EventTextDelta, Delta: "正在"},
		{Type: EventTextDelta, Delta: "查询"},
	}, events)
	require.Len(t, result.ToolCalls, 1)
	require.Equal(t, "toolu-1", result.ToolCalls[0].ID)
	require.Equal(t, "list_servers", result.ToolCalls[0].Name)
	require.JSONEq(t, `{"status":"online"}`, string(result.ToolCalls[0].Arguments))
}

func writeSSEData(t *testing.T, w http.ResponseWriter, data string) {
	t.Helper()
	_, err := w.Write([]byte("data: " + data + "\n\n"))
	require.NoError(t, err)
}

func writeSSEEvent(t *testing.T, w http.ResponseWriter, event string, data string) {
	t.Helper()
	_, err := w.Write([]byte("event: " + event + "\n" + "data: " + data + "\n\n"))
	require.NoError(t, err)
}
