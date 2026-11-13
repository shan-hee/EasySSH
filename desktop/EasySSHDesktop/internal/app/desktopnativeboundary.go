package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type desktopNativeWindow struct {
	window      *application.WebviewWindow
	workspaceID string // empty only for the local owner's window
}

// desktopNativeBoundary is populated only by Go window creation. A workspace
// identifier received in a binding argument cannot select or elevate a caller.
type desktopNativeBoundary struct {
	mu      sync.RWMutex
	windows map[uint]desktopNativeWindow
}

func newDesktopNativeBoundary() *desktopNativeBoundary {
	return &desktopNativeBoundary{windows: make(map[uint]desktopNativeWindow)}
}

func (b *desktopNativeBoundary) register(window *application.WebviewWindow, workspaceID string) {
	b.mu.Lock()
	b.windows[window.ID()] = desktopNativeWindow{window, workspaceID}
	b.mu.Unlock()
	window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		b.mu.Lock()
		delete(b.windows, window.ID())
		b.mu.Unlock()
	})
}

func (b *desktopNativeBoundary) lookup(id uint) (desktopNativeWindow, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	window, ok := b.windows[id]
	return window, ok
}

func (b *desktopNativeBoundary) remoteWorkspace(ctx context.Context) (string, error) {
	id, ok := application.RuntimeWindowID(ctx)
	if !ok {
		return "", errors.New("native window provenance required")
	}
	window, ok := b.lookup(id)
	if !ok || window.workspaceID == "" {
		return "", errors.New("remote workspace required")
	}
	return window.workspaceID, nil
}

func (b *desktopNativeBoundary) allowRuntime(call application.NativeRuntimeCall) bool {
	window, ok := b.lookup(call.WindowID)
	if !ok {
		return false
	}
	if window.workspaceID == "" {
		return true
	}
	switch call.Subsystem {
	case "Call":
		return desktopRemoteBindingAllowed(call.Binding)
	case "CancelCall":
		return true // the runtime isolates cancellation by native window ID
	case "Window":
		switch call.Method {
		case application.WindowClose, application.WindowFocus, application.WindowMinimise,
			application.WindowMaximise, application.WindowUnMaximise, application.WindowToggleMaximise,
			application.WindowIsMaximised, application.WindowIsFullscreen, application.WindowIsMinimised,
			application.WindowSize, application.WindowWidth, application.WindowHeight:
			return true
		}
	}
	return false
}

func (b *desktopNativeBoundary) allowEvent(id uint, event *application.CustomEvent) bool {
	window, ok := b.lookup(id)
	if !ok {
		return false
	}
	// Remote delivery will use explicitly scoped streams, never local broadcasts.
	return window.workspaceID == ""
}

func (b *desktopNativeBoundary) allowMessage(id uint, message string, origin *application.OriginInfo) bool {
	window, ok := b.lookup(id)
	if !ok || origin == nil || (origin.FrameKnown && !origin.IsMainFrame) || !window.window.AllowsNavigation(origin.Origin, true) {
		return false
	}
	if origin.TopOrigin != "" && !window.window.AllowsNavigation(origin.TopOrigin, true) {
		return false
	}
	// Only shell chrome and runtime readiness use postMessage. Application
	// events and host operations must pass the typed runtime dispatcher.
	return message == "wails:runtime:ready" || message == "wails:drag" ||
		message == "wails:resize:n-resize" || message == "wails:resize:s-resize" ||
		message == "wails:resize:e-resize" || message == "wails:resize:w-resize" ||
		message == "wails:resize:ne-resize" || message == "wails:resize:nw-resize" ||
		message == "wails:resize:se-resize" || message == "wails:resize:sw-resize"
}

func (b *desktopNativeBoundary) assets(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := application.RuntimeWindowID(r.Context())
		window, known := b.lookup(id)
		if !ok || !known {
			http.Error(w, "native window provenance required", http.StatusForbidden)
			return
		}
		connect := "'self'"
		if window.workspaceID == "" {
			// The local terminal/file gateway is a separate authenticated loopback
			// service. Remote windows never receive its token or network access.
			connect += " http://127.0.0.1:* ws://127.0.0.1:*"
		}
		// Bundled dependencies compile WASM; this allows it without enabling JavaScript eval.
		w.Header().Set("Content-Security-Policy", strings.Join([]string{
			"default-src 'none'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
			"img-src 'self' data: blob:", "font-src 'self' data:", "worker-src 'self' blob:",
			"connect-src " + connect, "frame-src 'none'", "object-src 'none'", "base-uri 'none'",
			"form-action 'none'", "frame-ancestors 'none'",
		}, "; "))
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}
