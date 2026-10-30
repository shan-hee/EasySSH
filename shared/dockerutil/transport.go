package dockerutil

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptrace"
	"sync/atomic"
)

const MaxResponseBytes int64 = 16 << 20
const MaxListItems = 20000

var ErrResponseTooLarge = errors.New("Docker response exceeds limit")

type mutationContextKey struct{}
type mutationObservation struct {
	attempted atomic.Bool
	status    atomic.Int32
}

type boundedTransport struct{ base *http.Transport }

func (t *boundedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	observation, _ := req.Context().Value(mutationContextKey{}).(*mutationObservation)
	mutation := observation != nil && (req.Method == http.MethodPost || req.Method == http.MethodDelete)
	if mutation {
		// No acquired connection means the request was not dispatched. Once a
		// connection is assigned, a write/response failure cannot prove that
		// the daemon did not receive the operation. Trace state is per action.
		trace := &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { observation.attempted.Store(true) }}
		req = req.Clone(httptrace.WithClientTrace(req.Context(), trace))
	}
	response, err := t.base.RoundTrip(req)
	if err != nil {
		return response, err
	}
	if mutation {
		observation.status.Store(int32(response.StatusCode))
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 && response.StatusCode != http.StatusNotModified {
		_ = response.Body.Close()
		return nil, errors.New("Docker redirect response rejected")
	}
	response.Body = &boundedResponseBody{ReadCloser: response.Body, remaining: MaxResponseBytes}
	return response, nil
}

type boundedResponseBody struct {
	io.ReadCloser
	remaining int64
}

func (r *boundedResponseBody) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if r.remaining == 0 {
		var extra [1]byte
		n, err := r.ReadCloser.Read(extra[:])
		if n > 0 {
			return 0, ErrResponseTooLarge
		}
		return 0, err
	}
	if int64(len(p)) > r.remaining {
		p = p[:r.remaining]
	}
	n, err := r.ReadCloser.Read(p)
	r.remaining -= int64(n)
	return n, err
}
