package application

import "net/url"

// AllowsNavigation uses an origin captured by Go at window creation. It never
// derives authority from location, HTTP headers or frontend window metadata.
func (w *WebviewWindow) AllowsNavigation(raw string, mainFrame bool) bool {
	if !w.options.RestrictNavigation {
		return true
	}
	if !mainFrame {
		return false
	}
	target, err := url.Parse(raw)
	if err != nil || target.User != nil || target.Opaque != "" {
		return false
	}
	base, err := url.Parse(w.assetOrigin)
	return err == nil && base.Scheme != "" && base.Host != "" &&
		target.Scheme == base.Scheme && target.Host == base.Host
}

func nativeNavigationAllowed(windowID uint, raw string, mainFrame bool) bool {
	window, ok := globalApplication.Window.GetByID(windowID)
	if !ok {
		return false
	}
	webview, ok := window.(*WebviewWindow)
	return ok && webview.AllowsNavigation(raw, mainFrame)
}

func nativeWindowIsolated(windowID uint) bool {
	window, ok := globalApplication.Window.GetByID(windowID)
	if !ok {
		return false
	}
	webview, ok := window.(*WebviewWindow)
	return ok && webview.options.IsolatedStorage
}
