//go:build windows

package application

import (
	"unsafe"

	"github.com/wailsapp/wails/webview2/pkg/edge"
	"github.com/wailsapp/wails/webview2/pkg/webview2"
)

type nativeNavigationHandler struct {
	*edge.Chromium
	window    *WebviewWindow
	mainFrame bool
}

func (h *nativeNavigationHandler) NavigationStarting(_ *webview2.ICoreWebView2, args *webview2.ICoreWebView2NavigationStartingEventArgs) uintptr {
	target, err := args.GetUri()
	if err != nil || !h.window.AllowsNavigation(target, h.mainFrame) {
		if err := args.PutCancel(true); err != nil {
			globalApplication.handleFatalError(err)
		}
	}
	return 0
}

func (h *nativeNavigationHandler) NewWindowRequested(_ *webview2.ICoreWebView2, args *webview2.ICoreWebView2NewWindowRequestedEventArgs) uintptr {
	if h.window.options.RestrictNavigation {
		if err := args.PutHandled(true); err != nil {
			globalApplication.handleFatalError(err)
		}
	}
	return 0
}

func (w *windowsWebviewWindow) installNavigationPolicy() error {
	if !w.parent.options.RestrictNavigation {
		return nil
	}
	core, err := w.chromium.GetController().GetCoreWebView2()
	if err != nil {
		return err
	}
	// Both packages expose the same COM ICoreWebView2 ABI. The generated
	// package supplies navigation APIs absent from edge's convenience layer.
	native := (*webview2.ICoreWebView2)(unsafe.Pointer(core))
	defer native.Vtbl.Release.Call(uintptr(unsafe.Pointer(native)))
	w.navigationPolicy = webview2.NewICoreWebView2NavigationStartingEventHandler(&nativeNavigationHandler{w.chromium, w.parent, true})
	w.frameNavigationPolicy = webview2.NewICoreWebView2NavigationStartingEventHandler(&nativeNavigationHandler{w.chromium, w.parent, false})
	w.popupPolicy = webview2.NewICoreWebView2NewWindowRequestedEventHandler(&nativeNavigationHandler{w.chromium, w.parent, false})
	if _, err = native.AddNavigationStarting(w.navigationPolicy); err != nil {
		return err
	}
	if _, err = native.AddFrameNavigationStarting(w.frameNavigationPolicy); err != nil {
		return err
	}
	_, err = native.AddNewWindowRequested(w.popupPolicy)
	return err
}
