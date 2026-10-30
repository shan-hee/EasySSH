// Package runtimeorigin carries native provenance outside renderer-controlled headers.
package runtimeorigin

import "context"

type windowKey struct{}

func WithWindow(ctx context.Context, id uint) context.Context {
	return context.WithValue(ctx, windowKey{}, id)
}

func WindowID(ctx context.Context) (uint, bool) {
	id, ok := ctx.Value(windowKey{}).(uint)
	return id, ok
}
