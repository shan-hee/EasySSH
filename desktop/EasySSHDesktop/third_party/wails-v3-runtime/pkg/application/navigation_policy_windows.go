//go:build windows

package application

import (
	"sync/atomic"
	"unsafe"

	"github.com/wailsapp/wails/webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

// Slots in the stable WebView2 COM interfaces, including IUnknown's 3 slots.
// Keep these few native calls here: importing the generated pkg/webview2
// registers invalid string-valued callbacks during init and panics on Windows.
const (
	webViewAddNavigationStarting      = 7
	webViewAddFrameNavigationStarting = 17
	webViewAddNewWindowRequested      = 44
	navigationArgsGetURI              = 3
	navigationArgsPutCancel           = 8
	newWindowArgsPutHandled           = 6
	webViewControllerClose            = 24
)

var (
	nativeIUnknownIID          = windows.GUID{Data4: [8]byte{0xc0, 0, 0, 0, 0, 0, 0, 0x46}}
	nativeNavigationHandlerIID = windows.GUID{
		Data1: 0x9adbe429, Data2: 0xf36d, Data3: 0x432b,
		Data4: [8]byte{0x9d, 0xdc, 0xf8, 0x88, 0x1f, 0xbd, 0x76, 0xe3},
	}
	nativeNewWindowHandlerIID = windows.GUID{
		Data1: 0xd4c185fe, Data2: 0xc81c, Data3: 0x4989,
		Data4: [8]byte{0x97, 0xaf, 0x2d, 0x3f, 0xa7, 0xab, 0x56, 0x51},
	}
)

func nativeWebViewMethod(object unsafe.Pointer, slot int) edge.ComProc {
	vtable := *(*unsafe.Pointer)(object)
	return *(*edge.ComProc)(unsafe.Add(vtable, uintptr(slot)*unsafe.Sizeof(uintptr(0))))
}

func nativeWebViewError(hr uintptr) error {
	if int32(hr) < 0 {
		return windows.Errno(uint32(hr))
	}
	return nil
}

// The window retains these handlers for the lifetime of its WebView controller.
type nativeNavigationHandler struct {
	vtable    *[4]edge.ComProc
	refs      atomic.Int32
	window    *WebviewWindow
	mainFrame bool
	popup     bool
}

var nativeNavigationHandlerVTable = [4]edge.ComProc{
	edge.NewComProc(nativeNavigationQueryInterface),
	edge.NewComProc(nativeNavigationAddRef),
	edge.NewComProc(nativeNavigationRelease),
	edge.NewComProc(nativeNavigationInvoke),
}

func newNativeNavigationHandler(window *WebviewWindow, mainFrame, popup bool) *nativeNavigationHandler {
	handler := &nativeNavigationHandler{
		vtable: &nativeNavigationHandlerVTable, window: window, mainFrame: mainFrame, popup: popup,
	}
	handler.refs.Store(1)
	return handler
}

func nativeNavigationQueryInterface(h *nativeNavigationHandler, iid *windows.GUID, object *unsafe.Pointer) uintptr {
	if object == nil || iid == nil {
		return 0x80004003 // E_POINTER
	}
	*object = nil
	handlerIID := nativeNavigationHandlerIID
	if h.popup {
		handlerIID = nativeNewWindowHandlerIID
	}
	if *iid != nativeIUnknownIID && *iid != handlerIID {
		return 0x80004002 // E_NOINTERFACE
	}
	*object = unsafe.Pointer(h)
	nativeNavigationAddRef(h)
	return 0
}

func nativeNavigationAddRef(h *nativeNavigationHandler) uintptr {
	return uintptr(h.refs.Add(1))
}

func nativeNavigationRelease(h *nativeNavigationHandler) uintptr {
	return uintptr(h.refs.Add(-1))
}

// Every callback argument is a native pointer. URI results use LPWSTR* and
// Cancel/Handled use a BOOL value, not a pointer to a Go bool.
func nativeNavigationInvoke(h *nativeNavigationHandler, _ unsafe.Pointer, args unsafe.Pointer) uintptr {
	if h.popup {
		if !h.window.options.RestrictNavigation {
			return 0
		}
	} else {
		var uri *uint16
		hr, _, _ := nativeWebViewMethod(args, navigationArgsGetURI).Call(
			uintptr(args), uintptr(unsafe.Pointer(&uri)),
		)
		target := windows.UTF16PtrToString(uri)
		if uri != nil {
			windows.CoTaskMemFree(unsafe.Pointer(uri))
		}
		if nativeWebViewError(hr) == nil && h.window.AllowsNavigation(target, h.mainFrame) {
			return 0
		}
	}
	slot := navigationArgsPutCancel
	if h.popup {
		slot = newWindowArgsPutHandled
	}
	hr, _, _ := nativeWebViewMethod(args, slot).Call(uintptr(args), 1)
	if err := nativeWebViewError(hr); err != nil {
		globalApplication.handleFatalError(err)
	}
	return 0
}

func closeNativeWebViewController(controller *edge.ICoreWebView2Controller) error {
	hr, _, _ := nativeWebViewMethod(unsafe.Pointer(controller), webViewControllerClose).Call(
		uintptr(unsafe.Pointer(controller)),
	)
	return nativeWebViewError(hr)
}

func (w *windowsWebviewWindow) installNavigationPolicy() error {
	if !w.parent.options.RestrictNavigation {
		return nil
	}
	core, err := w.chromium.GetController().GetCoreWebView2()
	if err != nil {
		return err
	}
	defer core.Release()
	w.navigationPolicy = newNativeNavigationHandler(w.parent, true, false)
	w.frameNavigationPolicy = newNativeNavigationHandler(w.parent, false, false)
	w.popupPolicy = newNativeNavigationHandler(w.parent, false, true)
	for _, event := range []struct {
		slot    int
		handler *nativeNavigationHandler
	}{
		{webViewAddNavigationStarting, w.navigationPolicy},
		{webViewAddFrameNavigationStarting, w.frameNavigationPolicy},
		{webViewAddNewWindowRequested, w.popupPolicy},
	} {
		var token int64
		hr, _, _ := nativeWebViewMethod(unsafe.Pointer(core), event.slot).Call(
			uintptr(unsafe.Pointer(core)), uintptr(unsafe.Pointer(event.handler)), uintptr(unsafe.Pointer(&token)),
		)
		if err := nativeWebViewError(hr); err != nil {
			return err
		}
	}
	return nil
}
