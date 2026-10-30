package aiprovider

import (
	"bytes"
	"io"
	"net/http"
	"time"
)

const (
	MaxAutomaticTurns       = 32
	MaxResponseBytes        = 2 << 20
	MaxToolCallsPerResponse = 64
	maxHTTPResponseBytes    = 16 << 20
	RequestTimeout          = 5 * time.Minute
	AutomaticRunTimeout     = 10 * time.Minute
)

// Deltas are counted once; completed tool payloads are checked independently
// because some compatible providers omit argument deltas altogether.
type responseBudget struct {
	deltaBytes     int
	completedBytes int
	startedCalls   int
	completedCalls int
}

func (b *responseBudget) accept(event Event) error {
	b.deltaBytes += len(event.Delta)
	if b.deltaBytes > MaxResponseBytes {
		return NewLimitError("ai_output_limit", "AI 单次输出超过 2 MiB，本轮已停止")
	}
	switch event.Type {
	case EventToolCallStarted:
		b.startedCalls++
	case EventToolCallCompleted:
		b.completedCalls++
		if event.ToolCall != nil {
			b.completedBytes += len(event.ToolCall.Arguments) + len(event.ToolCall.Name) + len(event.ToolCall.ID)
		}
	}
	if b.startedCalls > MaxToolCallsPerResponse || b.completedCalls > MaxToolCallsPerResponse {
		return NewLimitError("ai_tool_call_limit", "AI 单次响应工具调用超过 64 项，本轮已停止")
	}
	if b.completedBytes > MaxResponseBytes {
		return NewLimitError("ai_output_limit", "AI 工具参数总量超过 2 MiB，本轮已停止")
	}
	return nil
}

func validateTurnResult(result TurnResult) error {
	if len(result.ToolCalls) > MaxToolCallsPerResponse {
		return NewLimitError("ai_tool_call_limit", "AI 单次响应工具调用超过 64 项，本轮已停止")
	}
	size := len(result.Content) + len(result.Reasoning)
	for _, call := range result.ToolCalls {
		size += len(call.ID) + len(call.Name) + len(call.Arguments)
	}
	if size > MaxResponseBytes {
		return NewLimitError("ai_output_limit", "AI 单次输出超过 2 MiB，本轮已停止")
	}
	return nil
}

// Bound decoded HTTP bodies before SDK JSON/SSE accumulation, including an
// oversized single event and ignored event types. DefaultTransport performs
// decompression first, so the cap also applies to compressed responses.
type responseBudgetTransport struct{ base http.RoundTripper }

func (t responseBudgetTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.ContentLength > maxHTTPRequestBytes {
		if req.Body != nil {
			_ = req.Body.Close()
		}
		return nil, NewLimitError("ai_request_limit", "AI 请求编码后超过 64 MiB，未发送到提供商")
	}
	if req.Body != nil && req.ContentLength <= 0 {
		// SDK requests normally declare their length. Unknown-length bodies are
		// inspected before network dispatch so a size rejection has no remote effect.
		data, err := io.ReadAll(io.LimitReader(req.Body, maxHTTPRequestBytes+1))
		_ = req.Body.Close()
		if err != nil {
			return nil, err
		}
		if len(data) > maxHTTPRequestBytes {
			return nil, NewLimitError("ai_request_limit", "AI 请求编码后超过 64 MiB，未发送到提供商")
		}
		req = req.Clone(req.Context())
		req.Body = io.NopCloser(bytes.NewReader(data))
		req.ContentLength = int64(len(data))
	}
	response, err := t.base.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		_ = response.Body.Close()
		return nil, NewLimitError("provider_redirect_rejected", "AI 提供商返回了重定向，请使用最终 API 地址")
	}
	response.Body = &responseBudgetBody{ReadCloser: response.Body, remaining: maxHTTPResponseBytes}
	return response, nil
}

type responseBudgetBody struct {
	io.ReadCloser
	remaining int
}

func (b *responseBudgetBody) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if b.remaining == 0 {
		var probe [1]byte
		n, err := b.ReadCloser.Read(probe[:])
		if n > 0 {
			_ = b.Close()
			return 0, NewLimitError("ai_output_limit", "AI 响应数据超过 16 MiB，本轮已停止")
		}
		return 0, err
	}
	if len(p) > b.remaining {
		p = p[:b.remaining]
	}
	n, err := b.ReadCloser.Read(p)
	b.remaining -= n
	return n, err
}

func boundedHTTPClient() *http.Client {
	return &http.Client{Transport: responseBudgetTransport{base: http.DefaultTransport}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
