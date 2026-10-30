package application

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"encoding/json"

	"github.com/wailsapp/wails/v3/pkg/errs"
)

// bufferPool reduces allocations for reading request bodies.
// Buffers larger than maxPooledBufferSize are not returned to the pool
// to prevent memory bloat from occasional large requests (e.g., images).
const maxPooledBufferSize = 512 * 1024 // 512KB

var bufferPool = sync.Pool{
	New: func() any {
		return bytes.NewBuffer(make([]byte, 0, 4096))
	},
}

const (
	chunkIDHeader    = "x-wails-chunk-id"
	chunkIndexHeader = "x-wails-chunk-index"
	chunkTotalHeader = "x-wails-chunk-total"
	chunkTTL         = 30 * time.Second

	maxChunkTotal     = 1024
	maxChunkBodyBytes = 1024 * 1024
	maxAssembledBytes = 64 * 1024 * 1024
)

// pendingChunks accumulates request body chunks sent by the JS runtime
// to work around WebView2's ~2MB limit on request body content delivery
// via the WebResourceRequested event.
type pendingChunks struct {
	chunks    map[int][]byte
	total     int
	size      int
	createdAt time.Time
	finished  bool
}

type HTTPTransport struct {
	messageProcessor *MessageProcessor
	logger           *slog.Logger
	chunkMu          sync.Mutex
	chunkStore       map[nativeCallKey]*pendingChunks
	stopCleanup      chan struct{}
	stopOnce         sync.Once
}

func NewHTTPTransport(opts ...HTTPTransportOption) *HTTPTransport {
	t := &HTTPTransport{
		logger:     slog.Default(),
		chunkStore: make(map[nativeCallKey]*pendingChunks),
	}

	// Apply options
	for _, opt := range opts {
		opt(t)
	}

	return t
}

// HTTPTransportOption is a functional option for configuring HTTPTransport
type HTTPTransportOption func(*HTTPTransport)

// HTTPTransportWithLogger is a functional option to set the logger for HTTPTransport.
func HTTPTransportWithLogger(logger *slog.Logger) HTTPTransportOption {
	return func(t *HTTPTransport) {
		t.logger = logger
	}
}

func (t *HTTPTransport) Start(ctx context.Context, processor *MessageProcessor) error {
	t.messageProcessor = processor
	t.stopCleanup = make(chan struct{})
	go t.cleanupChunks(t.stopCleanup)
	return nil
}

func (t *HTTPTransport) cleanupChunks(stop <-chan struct{}) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			now := time.Now()
			t.chunkMu.Lock()
			for key, pending := range t.chunkStore {
				if now.Sub(pending.createdAt) > chunkTTL {
					delete(t.chunkStore, key)
				}
			}
			t.chunkMu.Unlock()
		}
	}
}

func (t *HTTPTransport) JSClient() []byte {
	return nil
}

func (t *HTTPTransport) Stop() error {
	if t.stopCleanup != nil {
		t.stopOnce.Do(func() { close(t.stopCleanup) })
	}
	return nil
}

type request struct {
	Object *int            `json:"object"`
	Method *int            `json:"method"`
	Args   json.RawMessage `json:"args"`
}

func (t *HTTPTransport) Handler() func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
			path := req.URL.Path
			switch path {
			case "/wails/runtime":
				t.handleRuntimeRequest(rw, req)
			default:
				next.ServeHTTP(rw, req)
			}
		})
	}
}

func (t *HTTPTransport) handleRuntimeRequest(rw http.ResponseWriter, r *http.Request) {
	if _, ok := RuntimeWindowID(r.Context()); !ok {
		http.Error(rw, "native window provenance required", http.StatusForbidden)
		return
	}
	rw.Header().Set("Cache-Control", "no-store")
	r.Body = http.MaxBytesReader(rw, r.Body, maxAssembledBytes)
	// Chunked upload: JS splits large bodies into smaller pieces to work
	// around WebView2's ~2MB request body delivery limit in WebResourceRequested.
	if chunkID := r.Header.Get(chunkIDHeader); chunkID != "" {
		t.handleChunkedRequest(rw, r, chunkID)
		return
	}

	buf := bufferPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer func() {
		if buf.Cap() <= maxPooledBufferSize {
			bufferPool.Put(buf)
		}
	}()

	if _, err := io.Copy(buf, r.Body); err != nil {
		t.httpError(rw, errs.WrapInvalidRuntimeCallErrorf(err, "Unable to read request body"))
		return
	}

	t.processBody(rw, r, buf.Bytes())
}

// handleChunkedRequest stores an incoming chunk and, once all chunks are
// received, assembles them and delegates to processBody.
func (t *HTTPTransport) handleChunkedRequest(rw http.ResponseWriter, r *http.Request, chunkID string) {
	windowID, ok := RuntimeWindowID(r.Context())
	if !ok || len(chunkID) > 128 {
		t.httpError(rw, errs.NewInvalidRuntimeCallErrorf("invalid native chunk source"))
		return
	}
	key := nativeCallKey{windowID, chunkID}
	indexStr := r.Header.Get(chunkIndexHeader)
	totalStr := r.Header.Get(chunkTotalHeader)

	total, err := strconv.Atoi(totalStr)
	if err != nil || total <= 0 || total > maxChunkTotal {
		t.httpError(rw, errs.NewInvalidRuntimeCallErrorf("invalid chunk total: %s", totalStr))
		return
	}

	index, err := strconv.Atoi(indexStr)
	if err != nil || index < 0 || index >= total {
		t.httpError(rw, errs.NewInvalidRuntimeCallErrorf("invalid chunk index: %s", indexStr))
		return
	}

	r.Body = http.MaxBytesReader(rw, r.Body, int64(maxChunkBodyBytes))

	buf := bufferPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer func() {
		if buf.Cap() <= maxPooledBufferSize {
			bufferPool.Put(buf)
		}
	}()

	if _, err := io.Copy(buf, r.Body); err != nil {
		t.httpError(rw, errs.WrapInvalidRuntimeCallErrorf(err, "unable to read chunk body"))
		return
	}

	chunk := make([]byte, buf.Len())
	copy(chunk, buf.Bytes())

	// One lock owns assembly, accounting and completion. Keep completed IDs as
	// bounded TTL tombstones so concurrent last chunks cannot dispatch twice.
	t.chunkMu.Lock()
	pc := t.chunkStore[key]
	var totalBytes, windowBytes, windowRequests int
	for k, pending := range t.chunkStore {
		totalBytes += pending.size
		if k.windowID == windowID {
			windowBytes += pending.size
			windowRequests++
		}
	}
	if pc == nil {
		if len(t.chunkStore) >= 128 || windowRequests >= 32 {
			t.chunkMu.Unlock()
			t.httpError(rw, errs.NewInvalidRuntimeCallErrorf("too many chunk requests"))
			return
		}
		pc = &pendingChunks{chunks: make(map[int][]byte), total: total, createdAt: time.Now()}
		t.chunkStore[key] = pc
	}
	if pc.finished || time.Since(pc.createdAt) > chunkTTL || pc.total != total {
		t.chunkMu.Unlock()
		t.httpError(rw, errs.NewInvalidRuntimeCallErrorf("expired, completed or inconsistent chunk request"))
		return
	}
	if previous, exists := pc.chunks[index]; exists {
		equal := bytes.Equal(previous, chunk)
		t.chunkMu.Unlock()
		if !equal {
			t.httpError(rw, errs.NewInvalidRuntimeCallErrorf("conflicting duplicate chunk"))
			return
		}
		rw.WriteHeader(http.StatusOK)
		return
	}
	if windowBytes+len(chunk) > maxAssembledBytes || totalBytes+len(chunk) > 2*maxAssembledBytes {
		pc.finished, pc.chunks, pc.size = true, nil, 0
		t.chunkMu.Unlock()
		t.httpError(rw, errs.NewInvalidRuntimeCallErrorf("chunk memory limit exceeded"))
		return
	}
	pc.chunks[index] = chunk
	pc.size += len(chunk)
	if len(pc.chunks) < total {
		t.chunkMu.Unlock()
		rw.WriteHeader(http.StatusOK)
		return
	}
	assembled := make([]byte, 0, pc.size)
	for i := 0; i < pc.total; i++ {
		assembled = append(assembled, pc.chunks[i]...)
	}
	pc.finished, pc.chunks, pc.size = true, nil, 0
	t.chunkMu.Unlock()

	t.processBody(rw, r, assembled)
}

func (t *HTTPTransport) processBody(rw http.ResponseWriter, r *http.Request, bodyBytes []byte) {
	var body request
	var err error

	if len(bodyBytes) > 0 {
		if err = json.Unmarshal(bodyBytes, &body); err != nil {
			t.httpError(rw, errs.WrapInvalidRuntimeCallErrorf(err, "Unable to parse request body as JSON"))
			return
		}
	} else {
		// Fallback: WebKitGTK 6.0 may send POST data as query params for custom URI schemes
		query := r.URL.Query()
		if objStr := query.Get("object"); objStr != "" {
			obj, parseErr := strconv.Atoi(objStr)
			if parseErr == nil {
				body.Object = &obj
			}
		}
		if methStr := query.Get("method"); methStr != "" {
			meth, parseErr := strconv.Atoi(methStr)
			if parseErr == nil {
				body.Method = &meth
			}
		}
		if argsStr := query.Get("args"); argsStr != "" {
			var args json.RawMessage
			if json.Unmarshal([]byte(argsStr), &args) == nil {
				body.Args = args
			}
		}
	}

	if body.Object == nil {
		t.httpError(rw, errs.NewInvalidRuntimeCallErrorf("missing object value"))
		return
	}

	if body.Method == nil {
		t.httpError(rw, errs.NewInvalidRuntimeCallErrorf("missing method value"))
		return
	}

	windowID, ok := RuntimeWindowID(r.Context())
	if !ok {
		t.httpError(rw, errs.NewInvalidRuntimeCallErrorf("native window provenance required"))
		return
	}

	resp, err := t.messageProcessor.HandleRuntimeCallWithIDs(r.Context(), &RuntimeRequest{
		Object:          *body.Object,
		Method:          *body.Method,
		Args:            &Args{body.Args},
		WebviewWindowID: uint32(windowID),
	})

	if err != nil {
		t.httpError(rw, err)
		return
	}

	if stringResp, ok := resp.(string); ok {
		t.text(rw, stringResp)
		return
	}

	t.json(rw, resp)
}

func (t *HTTPTransport) text(rw http.ResponseWriter, data string) {
	rw.Header().Set("Content-Type", "text/plain")
	rw.WriteHeader(http.StatusOK)
	_, err := rw.Write([]byte(data))
	if err != nil {
		t.error("Unable to write json payload. Please report this to the Wails team!", "error", err)
		return
	}
}

func (t *HTTPTransport) json(rw http.ResponseWriter, data any) {
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	// convert data to json
	var jsonPayload = []byte("{}")
	var err error
	if data != nil {
		jsonPayload, err = json.Marshal(data)
		if err != nil {
			t.error("Unable to convert data to JSON. Please report this to the Wails team!", "error", err)
			return
		}
	}
	_, err = rw.Write(jsonPayload)
	if err != nil {
		t.error("Unable to write json payload. Please report this to the Wails team!", "error", err)
		return
	}
}

func (t *HTTPTransport) httpError(rw http.ResponseWriter, err error) {
	t.error(err.Error())
	// return JSON error if it's a CallError
	var bytes []byte
	if cerr := (*CallError)(nil); errors.As(err, &cerr) {
		if data, jsonErr := json.Marshal(cerr); jsonErr == nil {
			rw.Header().Set("Content-Type", "application/json")
			bytes = data
		} else {
			rw.Header().Set("Content-Type", "text/plain")
			bytes = []byte(err.Error())
		}
	} else {
		rw.Header().Set("Content-Type", "text/plain")
		bytes = []byte(err.Error())
	}
	rw.WriteHeader(http.StatusUnprocessableEntity)

	_, err = rw.Write(bytes)
	if err != nil {
		t.error("Unable to write error response:", "error", err)
	}
}

func (t *HTTPTransport) error(message string, args ...any) {
	t.logger.Error(message, args...)
}
