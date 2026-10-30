package app

import (
	"context"
	"net/http"
)

// HTTP Shutdown alone does not wait for hijacked WebSockets. Registration and
// shutdown use the same mutex so no handler can appear after Wait starts.
func (g *DesktopGateway) trackHandler(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		if g.stopping || len(g.handlers) >= 128 {
			g.mu.Unlock()
			http.Error(w, "desktop gateway is unavailable", http.StatusServiceUnavailable)
			return
		}
		ctx, cancel := context.WithCancel(r.Context())
		if g.handlers == nil {
			g.handlers = make(map[uint64]context.CancelFunc)
		}
		g.handlerID++
		id := g.handlerID
		g.handlers[id] = cancel
		g.handlerWG.Add(1)
		g.mu.Unlock()
		defer func() {
			cancel()
			g.mu.Lock()
			delete(g.handlers, id)
			g.mu.Unlock()
			g.handlerWG.Done()
		}()
		next(w, r.WithContext(ctx))
	}
}
