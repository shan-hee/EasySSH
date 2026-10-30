package application

import (
	"context"

	"github.com/wailsapp/wails/v3/internal/runtimeorigin"
	"github.com/wailsapp/wails/v3/pkg/errs"
)

// NativeRuntimeCall contains resolved, host-controlled provenance. Binding is
// the canonical fully-qualified Go method, never a renderer-supplied alias.
type NativeRuntimeCall struct {
	WindowID  uint
	Subsystem string
	Method    int
	Binding   string
}

// RuntimeWindowID only accepts native WebView provenance. Headers, ClientID,
// WindowKey and binding arguments cannot establish it.
func RuntimeWindowID(ctx context.Context) (uint, bool) {
	return runtimeorigin.WindowID(ctx)
}

func authorizeNativeRuntime(ctx context.Context, req *RuntimeRequest, binding string) error {
	id, ok := RuntimeWindowID(ctx)
	if !ok {
		return errs.NewInvalidRuntimeCallErrorf("native window provenance required")
	}
	if policy := globalApplication.options.NativeRuntimePolicy; policy != nil {
		if !policy(NativeRuntimeCall{WindowID: id, Subsystem: objectNames[req.Object], Method: req.Method, Binding: binding}) {
			return errs.NewInvalidRuntimeCallErrorf("native capability denied")
		}
	}
	return nil
}
