//go:build linux && purego && !android && !server

package application

import "github.com/ebitengine/purego"

var (
	navigationAction  func(uintptr) uintptr
	navigationRequest func(uintptr) uintptr
	navigationFrame   func(uintptr) string
	navigationURI     func(uintptr) string
	ignoreNavigation  func(uintptr)
	connectNavigation func(uintptr, string, uintptr, uintptr, uintptr, uint32) uint64
)

func bindNavigationPolicy(bind func(any, string)) {
	bind(&navigationAction, "webkit_navigation_policy_decision_get_navigation_action")
	bind(&navigationRequest, "webkit_navigation_action_get_request")
	bind(&navigationFrame, "webkit_navigation_action_get_frame_name")
	bind(&navigationURI, "webkit_uri_request_get_uri")
	bind(&ignoreNavigation, "webkit_policy_decision_ignore")
	bind(&connectNavigation, "g_signal_connect_data")
}

var decideNavigationCallback = purego.NewCallback(func(view, decision uintptr, kind int32, windowID uintptr) int32 {
	if kind == 2 { // WEBKIT_POLICY_DECISION_TYPE_RESPONSE
		return 0
	}
	action := navigationAction(decision)
	mainFrame := kind == 0 && navigationFrame(action) == ""
	if nativeNavigationAllowed(uint(windowID), navigationURI(navigationRequest(action)), mainFrame) {
		return 0
	}
	ignoreNavigation(decision)
	return 1
})
