package application

import (
	"context"
	"errors"

	"github.com/wailsapp/wails/v3/pkg/errs"
)

type contextKey string

const (
	CallBinding            = 0
	WindowKey   contextKey = "Window"
)

type nativeCallKey struct {
	windowID uint
	callID   string
}

func (m *MessageProcessor) cancelWindow(id uint) {
	m.l.Lock()
	var cancels []context.CancelFunc
	for key, cancel := range m.runningCalls {
		if key.windowID == id {
			cancels = append(cancels, cancel)
		}
	}
	m.l.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

func (m *MessageProcessor) processCallCancelMethod(ctx context.Context, req *RuntimeRequest) (any, error) {
	callID := req.Args.AsMap().String("call-id")
	if callID == nil || *callID == "" || len(*callID) > 128 {
		return nil, errs.NewInvalidBindingCallErrorf("missing argument 'call-id'")
	}

	windowID, _ := RuntimeWindowID(ctx)
	key := nativeCallKey{windowID, *callID}
	var cancel func()
	func() {
		m.l.Lock()
		defer m.l.Unlock()
		cancel = m.runningCalls[key]
	}()

	if cancel != nil {
		cancel()
		m.Debug("Binding call cancelled:", "id", *callID)
	}
	return unit, nil
}

func (m *MessageProcessor) processCallMethod(ctx context.Context, req *RuntimeRequest, window Window) (any, error) {
	callID := req.Args.AsMap().String("call-id")
	if callID == nil || *callID == "" || len(*callID) > 128 {
		return nil, errs.NewInvalidBindingCallErrorf("missing argument 'call-id'")
	}

	windowID, _ := RuntimeWindowID(ctx)
	key := nativeCallKey{windowID, *callID}
	switch req.Method {
	case CallBinding:
		var options CallOptions
		err := req.Args.ToStruct(&options)
		if err != nil {
			return nil, errs.WrapInvalidBindingCallErrorf(err, "error parsing call options")
		}

		// Log call
		var methodRef any = options.MethodName
		if options.MethodName == "" {
			methodRef = options.MethodID
		}
		m.Debug("Binding call started:", "id", *callID, "method", methodRef)

		ctx, cancel := context.WithCancel(context.WithoutCancel(ctx))

		// Schedule cancel in case panics happen before starting the call.
		cancelRequired := true
		defer func() {
			if cancelRequired {
				cancel()
			}
		}()

		ambiguousID := false
		func() {
			m.l.Lock()
			defer m.l.Unlock()

			_, exists := globalApplication.Window.GetByID(windowID)
			if !exists || m.runningCalls[key] != nil {
				ambiguousID = true
			} else {
				m.runningCalls[key] = cancel
			}
		}()

		if ambiguousID {
			return nil, errs.NewInvalidBindingCallErrorf("ambiguous call id: %s", *callID)
		}

		defer func() {
			m.l.Lock()
			defer m.l.Unlock()
			delete(m.runningCalls, key)
		}()
		defer cancel()

		var boundMethod *BoundMethod
		if options.MethodName != "" {
			boundMethod = globalApplication.bindings.Get(&options)
			if boundMethod == nil {
				return nil, errs.NewBindingCallFailedErrorf("unknown bound method name '%s'", options.MethodName)
			}
		} else {
			boundMethod = globalApplication.bindings.GetByID(options.MethodID)
			if boundMethod == nil {
				return nil, errs.NewBindingCallFailedErrorf("unknown bound method id %d", options.MethodID)
			}
		}

		if err := authorizeNativeRuntime(ctx, req, boundMethod.FQN); err != nil {
			return nil, err
		}
		var result any
		defer func() {
			m.Debug("Binding call complete:", "id", *callID, "method", boundMethod.FQN)
		}()

		// Set the context values for the window
		if window != nil {
			ctx = context.WithValue(ctx, WindowKey, window)
		}

		result, err = boundMethod.Call(ctx, options.Args)
		if cerr := (*CallError)(nil); errors.As(err, &cerr) {
			switch cerr.Kind {
			case ReferenceError, TypeError:
				return nil, errs.WrapBindingCallFailedErrorf(cerr, "failed to call binding")
			case RuntimeError:

				return nil, errs.WrapBindingCallFailedErrorf(cerr, "Bound method returned an error")
			}
		}
		if err != nil {
			return nil, errs.WrapBindingCallFailedErrorf(err, "failed to call binding")
		}
		return result, nil

	default:
		return nil, errs.NewInvalidBindingCallErrorf("unknown method: %d", req.Method)
	}
}
