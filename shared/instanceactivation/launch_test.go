package instanceactivation

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func launchFixture() *supervisor {
	return &supervisor{token: "child-control-token", serving: true, launches: newLaunchInbox(func(raw string) error {
		if raw == "" || raw == "valid-launch" {
			return nil
		}
		return errors.New("invalid")
	})}
}

func launchRequest(s *supervisor, path, token, body, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+token)
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func TestLaunchInboxKeepsUnreadAndDeduplicatesAfterAck(t *testing.T) {
	s := launchFixture()
	message := LaunchMessage{ID: randomID(), URL: "valid-launch"}
	body, _ := json.Marshal(message)
	for i := 0; i < 2; i++ {
		w := launchRequest(s, "/launch", s.launches.token, string(body), "")
		if w.Code != http.StatusNoContent {
			t.Fatalf("enqueue: %d", w.Code)
		}
	}
	for i := 0; i < 2; i++ {
		w := launchRequest(s, "/launches", s.token, `{"ack":[]}`, "")
		var got []LaunchMessage
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || len(got) != 1 || got[0].ID != message.ID {
			t.Fatalf("read %d: %s (%v)", w.Code, w.Body.String(), err)
		}
	}
	ack := `{"ack":["` + message.ID + `"]}`
	w := launchRequest(s, "/launches", s.token, ack, "")
	if strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("ack did not remove entry: %s", w.Body.String())
	}
	launchRequest(s, "/launch", s.launches.token, string(body), "")
	w = launchRequest(s, "/launches", s.token, ack, "")
	if strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("retry replayed acknowledged launch: %s", w.Body.String())
	}
}

func TestLaunchTokenCannotReadOrControlAndBrowserCannotEnqueue(t *testing.T) {
	s := launchFixture()
	for _, path := range []string{"/launches", "/info", "/activate", "/control", "/ready"} {
		if got := launchRequest(s, path, s.launches.token, `{}`, "").Code; got != http.StatusUnauthorized {
			t.Fatalf("launch token accepted at %s: %d", path, got)
		}
	}
	body, _ := json.Marshal(LaunchMessage{ID: randomID(), URL: "valid-launch"})
	if got := launchRequest(s, "/launch", s.launches.token, string(body), "https://attacker.example").Code; got != http.StatusUnauthorized {
		t.Fatalf("browser enqueue accepted: %d", got)
	}
}

func TestLaunchInboxCapacityExpiryAndMalformedInput(t *testing.T) {
	s := launchFixture()
	for i := 0; i < 16; i++ {
		if err := s.launches.add(LaunchMessage{ID: randomID()}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.launches.add(LaunchMessage{ID: randomID()}); err == nil {
		t.Fatal("unbounded launch inbox")
	}
	s.launches.entries[0].ExpiresAt = time.Now().Add(-time.Second)
	if err := s.launches.add(LaunchMessage{ID: randomID()}); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{"id":"` + randomID() + `","url":"bad-url"}`, `{"id":"` + randomID() + `","command":"exec"}`, `{} {}`} {
		if got := launchRequest(s, "/launch", s.launches.token, body, "").Code; got < 400 {
			t.Fatalf("accepted malformed input: %d", got)
		}
	}
}
