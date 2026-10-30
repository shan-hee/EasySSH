package application

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/internal/runtimeorigin"
)

func nativePolicyFixture(t *testing.T) *MessageProcessor {
	t.Helper()
	previous := globalApplication
	app := &App{windows: map[uint]Window{
		1: &WebviewWindow{id: 1, options: WebviewWindowOptions{Name: "owner"}},
		2: &WebviewWindow{id: 2, options: WebviewWindowOptions{Name: "remote"}},
	}}
	app.Window = newWindowManager(app)
	app.bindings = NewBindings(nil, map[uint32]uint32{99: 10})
	method := &BoundMethod{FQN: "host.Credentials.Reveal", ID: 10}
	app.bindings.boundMethods[method.FQN], app.bindings.boundByID[10] = method, method
	globalApplication = app
	t.Cleanup(func() { globalApplication = previous })
	return NewMessageProcessor(slog.Default())
}

func TestNativeRuntimeRejectsForgedWindowMetadata(t *testing.T) {
	m := nativePolicyFixture(t)
	req := &RuntimeRequest{Object: windowRequest, Method: WindowName, Args: &Args{json.RawMessage(`{}`)}, WebviewWindowID: 1, ClientID: "owner"}
	if _, err := m.HandleRuntimeCallWithIDs(context.Background(), req); err == nil {
		t.Fatal("renderer metadata established native authority")
	}
	if _, err := m.HandleRuntimeCallWithIDs(runtimeorigin.WithWindow(context.Background(), 2), req); err == nil {
		t.Fatal("remote caller selected owner window")
	}
	req.WebviewWindowID = 0
	value, err := m.HandleRuntimeCallWithIDs(runtimeorigin.WithWindow(context.Background(), 2), req)
	if err != nil || value != "remote" {
		t.Fatalf("client ID changed trusted caller: %v %v", value, err)
	}
}

func TestNativePolicyChecksResolvedBindingIncludingAlias(t *testing.T) {
	m := nativePolicyFixture(t)
	checked := 0
	globalApplication.options.NativeRuntimePolicy = func(call NativeRuntimeCall) bool {
		if call.WindowID != 2 || call.Binding != "host.Credentials.Reveal" {
			t.Fatalf("unresolved policy input: %+v", call)
		}
		checked++
		return false
	}
	for _, args := range []string{
		`{"call-id":"a","methodName":"host.Credentials.Reveal"}`,
		`{"call-id":"a","methodID":10}`,
		`{"call-id":"a","methodID":99}`,
	} {
		_, err := m.HandleRuntimeCallWithIDs(runtimeorigin.WithWindow(context.Background(), 2), &RuntimeRequest{Object: callRequest, Method: CallBinding, Args: &Args{json.RawMessage(args)}})
		if err == nil || !strings.Contains(err.Error(), "capability denied") {
			t.Fatalf("binding bypassed policy: %v", err)
		}
	}
	if checked != 3 {
		t.Fatalf("policy calls: %d", checked)
	}
}

func TestNativeCallCancellationIsWindowScoped(t *testing.T) {
	m := nativePolicyFixture(t)
	owner, cancelOwner := context.WithCancel(context.Background())
	defer cancelOwner()
	remote, cancelRemote := context.WithCancel(context.Background())
	defer cancelRemote()
	m.runningCalls[nativeCallKey{1, "same"}] = cancelOwner
	m.runningCalls[nativeCallKey{2, "same"}] = cancelRemote
	req := &RuntimeRequest{Object: cancelCallRequest, Args: &Args{json.RawMessage(`{"call-id":"same"}`)}}
	if _, err := m.HandleRuntimeCallWithIDs(runtimeorigin.WithWindow(context.Background(), 2), req); err != nil {
		t.Fatal(err)
	}
	if owner.Err() != nil || remote.Err() == nil {
		t.Fatal("cancellation crossed native window boundary")
	}
}

func TestRuntimeHTTPHeadersCannotForgeNativeProvenance(t *testing.T) {
	transport := NewHTTPTransport()
	r := httptest.NewRequest(http.MethodPost, "/wails/runtime", strings.NewReader(`{"object":0,"method":0}`))
	r.Header.Set("x-wails-window-id", "1")
	r.Header.Set("x-wails-window-name", "owner")
	w := httptest.NewRecorder()
	transport.handleRuntimeRequest(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestRestrictedNavigationRejectsExternalDocumentsAndFrames(t *testing.T) {
	w := &WebviewWindow{assetOrigin: "http://wails.localhost/", options: WebviewWindowOptions{RestrictNavigation: true}}
	for _, target := range []string{"https://example.com/", "file:///tmp/page.html", "javascript:alert(1)", "http://wails.localhost.evil/", "http://user@wails.localhost/", "http://wails.localhost:80/"} {
		if w.AllowsNavigation(target, true) {
			t.Fatalf("allowed %q", target)
		}
	}
	if !w.AllowsNavigation("http://wails.localhost/#/remote-workspace/a", true) {
		t.Fatal("bundled UI rejected")
	}
	if w.AllowsNavigation("http://wails.localhost/", false) {
		t.Fatal("child frame accepted")
	}
}
