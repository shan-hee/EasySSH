package app

import (
	"context"
	"errors"
	"net/http/httptrace"
	"net/url"
	"sync/atomic"
	"time"
)

// This helper is private. Exported methods supply fixed routes and schemas; the
// renderer supplies neither an origin, a credential nor an arbitrary API path.
func (session *desktopRemoteSession) requestRecord(ctx context.Context, method, path string, query url.Values, input, out any, mutationOutcome string) error {
	if err := session.beginOpening(); err != nil {
		return err
	}
	defer session.opening.Done()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var attempted atomic.Bool
	if mutationOutcome != "" {
		ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { attempted.Store(true) }})
	}
	err := session.client.requestWithOptions(ctx, method, path, input, out, true, desktopRemoteRequestOptions{query: query})
	if isRemoteAccessEnded(err) {
		session.cancel()
	}
	if err != nil && mutationOutcome != "" && attempted.Load() && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || err.Error() == "remote_unavailable" || err.Error() == "invalid_remote_response" || err.Error() == "remote_request_failed" || err.Error() == "remote_redirect_rejected") {
		return remoteError(mutationOutcome)
	}
	return err
}
