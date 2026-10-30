package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGatewayShutdownWaitsForCanceledHandler(t *testing.T) {
	g := &DesktopGateway{}
	entered, canceled, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
	handler := g.trackHandler(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
		close(canceled)
		<-release
	})
	go func() { handler(httptest.NewRecorder(), httptest.NewRequest("GET", "/terminal", nil)); close(done) }()
	<-entered
	shutdown := make(chan error, 1)
	go func() { shutdown <- g.ServiceShutdown() }()
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("handler was not canceled")
	}
	select {
	case <-shutdown:
		t.Fatal("shutdown did not wait for connection cleanup")
	default:
	}
	w := httptest.NewRecorder()
	handler(w, httptest.NewRequest("GET", "/terminal", nil))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatal("shutdown admitted another connection")
	}
	close(release)
	<-done
	select {
	case err := <-shutdown:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown did not join handler")
	}
}
