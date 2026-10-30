package dockerutil

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"unicode/utf8"

	mobyclient "github.com/moby/moby/client"
)

func dockerTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/_ping") {
			w.Header().Set("API-Version", mobyclient.MaxAPIVersion)
			_, _ = io.WriteString(w, "OK")
			return
		}
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	client, err := NewClient(func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	}, "/var/run/docker.sock")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func TestMutationDroppedResponseIsUnknownWithoutReplay(t *testing.T) {
	for _, action := range []protocol.DockerAction{protocol.DockerActionRestart, protocol.DockerActionRemove} {
		t.Run(string(action), func(t *testing.T) {
			var calls atomic.Int32
			client := dockerTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				conn, _, err := w.(http.Hijacker).Hijack()
				if err != nil {
					t.Error(err)
					return
				}
				_ = conn.Close()
			})
			err := client.Apply(context.Background(), action, "example", false)
			status, code, _ := Outcome(err)
			if !errors.Is(err, ErrMutationOutcomeUnknown) || status != "unknown" || code != "docker_outcome_unknown" || calls.Load() != 1 {
				t.Fatalf("lost reply: %v %s/%s calls=%d", err, status, code, calls.Load())
			}
		})
	}
}

func TestMutationNegotiationDialFailureIsNotUnknown(t *testing.T) {
	client, err := NewClient(func(context.Context, string, string) (net.Conn, error) { return nil, errors.New("dial refused") }, "/var/run/docker.sock")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	err = client.Apply(context.Background(), protocol.DockerActionRestart, "example", false)
	if err == nil || errors.Is(err, ErrMutationOutcomeUnknown) {
		t.Fatalf("negotiation failure: %v", err)
	}
}

func TestMutationDaemonFailureAndSuccess(t *testing.T) {
	for _, code := range []int{http.StatusNoContent, http.StatusNotFound, http.StatusInternalServerError} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			var calls atomic.Int32
			client := dockerTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(code)
				if code != http.StatusNoContent {
					_, _ = io.WriteString(w, `{"message":"rejected"}`)
				}
			})
			err := client.Apply(context.Background(), protocol.DockerActionStart, "example", false)
			status, _, _ := Outcome(err)
			expected := "failed"
			if code == http.StatusNoContent {
				expected = "succeeded"
			}
			if status != expected || calls.Load() != 1 {
				t.Fatalf("%d: %s %v calls=%d", code, status, err, calls.Load())
			}
		})
	}
}

func TestMutationCancellationAfterDispatchRemainsUnknown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client := dockerTestClient(t, func(w http.ResponseWriter, r *http.Request) { cancel(); <-r.Context().Done() })
	err := client.Apply(ctx, protocol.DockerActionRestart, "example", false)
	if status, _, _ := Outcome(err); status != "unknown" {
		t.Fatalf("in-flight cancel: %s %v", status, err)
	}
}

func TestMutationValidationBeforeNetworking(t *testing.T) {
	var calls atomic.Int32
	client, err := NewClient(func(context.Context, string, string) (net.Conn, error) {
		calls.Add(1)
		return nil, errors.New("must not dial")
	}, "/var/run/docker.sock")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	for _, input := range []struct {
		action protocol.DockerAction
		ref    string
		force  bool
	}{{"invalid", "container", false}, {protocol.DockerActionStart, "container", true}, {protocol.DockerActionStart, "../container", false}} {
		if err := client.Apply(context.Background(), input.action, input.ref, input.force); err == nil {
			t.Fatal("invalid input accepted")
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid input reached network")
	}
}

func TestOutcomePrecedenceAndBoundedUTF8(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status string
	}{{nil, "succeeded"}, {context.Canceled, "canceled"}, {context.DeadlineExceeded, "timeout"}, {errors.Join(ErrMutationOutcomeUnknown, context.Canceled), "unknown"}, {&daemonResponseError{500, context.Canceled}, "failed"}} {
		if status, _, _ := Outcome(tc.err); status != tc.status {
			t.Fatalf("%v: %s", tc.err, status)
		}
	}
	_, _, message := Outcome(errors.New(strings.Repeat("错", 2000) + "\xff"))
	if !utf8.ValidString(message) || len(message) > 4096 {
		t.Fatal("unbounded or invalid error message")
	}
}

type closeTrackedBody struct {
	io.Reader
	closed bool
}

func (b *closeTrackedBody) Close() error { b.closed = true; return nil }
func TestBoundedResponseBodyExactLimitAndClose(t *testing.T) {
	for _, size := range []int{3, 4, 5} {
		body := &closeTrackedBody{Reader: strings.NewReader(strings.Repeat("a", size))}
		limited := &boundedResponseBody{ReadCloser: body, remaining: 4}
		data, err := io.ReadAll(limited)
		if size <= 4 && (err != nil || len(data) != size) || size > 4 && (!errors.Is(err, ErrResponseTooLarge) || len(data) != 4) {
			t.Fatalf("size=%d length=%d error=%v", size, len(data), err)
		}
		_ = limited.Close()
		if !body.closed {
			t.Fatal("underlying body leaked")
		}
	}
}

func TestImageTagExpansionHasAggregateLimit(t *testing.T) {
	for _, count := range []int{MaxListItems, MaxListItems + 1} {
		t.Run(strconv.Itoa(count), func(t *testing.T) {
			tags := make([]string, count)
			for i := range tags {
				tags[i] = "example:tag" + strconv.Itoa(i)
			}
			client := dockerTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode([]any{map[string]any{"Id": "sha256:abc", "RepoTags": tags}})
			})
			result, err := client.ListImages(context.Background())
			if count == MaxListItems && (err != nil || len(result) != count) || count > MaxListItems && !errors.Is(err, ErrResponseTooLarge) {
				t.Fatalf("tags=%d results=%d error=%v", count, len(result), err)
			}
		})
	}
}
