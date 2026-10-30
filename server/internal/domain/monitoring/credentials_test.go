package monitoring

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/easyssh/server/internal/domain/auth"
)

func TestExternalMonitoringDoesNotFollowCredentialRedirects(t *testing.T) {
	for _, source := range []string{"nezha", "komari"} {
		t.Run(source, func(t *testing.T) {
			var redirected atomic.Int32
			target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Add(1); w.WriteHeader(http.StatusOK) }))
			defer target.Close()
			origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") == "" {
					t.Error("test request did not carry credentials")
				}
				http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
			}))
			defer origin.Close()
			var provider DataSourceProvider = NewNezhaDataSource(origin.URL, "private-token")
			if source == "komari" {
				provider = NewKomariDataSource(origin.URL, "private-token")
			}
			if err := provider.TestConnection(context.Background()); err == nil {
				t.Fatal("redirect treated as a successful API response")
			}
			if redirected.Load() != 0 {
				t.Fatal("monitoring followed an unconfigured destination")
			}
		})
	}
}

func TestStoredMonitorCredentialRequiresDecryptor(t *testing.T) {
	factory := NewDataSourceFactory(nil, nil, nil)
	for _, source := range []string{"nezha", "komari"} {
		owner := &auth.Owner{MonitorDataSource: source, NezhaAPIEndpoint: "https://example.test", KomariAPIEndpoint: "https://example.test", NezhaAPIToken: "encrypted-value", KomariAPIToken: "encrypted-value"}
		if _, err := factory.CreateDataSource(owner); err == nil {
			t.Fatal("encrypted credential accepted without decryptor")
		}
	}
}

func TestKomariPreservesConfiguredBasePath(t *testing.T) {
	source := NewKomariDataSource("https://monitor.example/base/", "")
	value, err := source.getHTTPURL("/api/nodes")
	if err != nil || value != "https://monitor.example/base/api/nodes" {
		t.Fatalf("wrong API destination: %s %v", value, err)
	}
}
