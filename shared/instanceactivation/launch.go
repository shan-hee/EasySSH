package instanceactivation

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// LaunchMessage contains untrusted activation data, never authority to use the
// local workspace. IDs permit retries after a lost forwarding/read response.
type LaunchMessage struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

type launchEndpoint struct {
	Address string `json:"address"`
	Token   string `json:"token"`
}

type launchEntry struct {
	LaunchMessage
	acked bool
}

type launchInbox struct {
	mu       sync.Mutex
	token    string
	validate func(string) error
	entries  []launchEntry
}

func newLaunchInbox(validate func(string) error) *launchInbox {
	return &launchInbox{token: randomID(), validate: validate}
}

func (q *launchInbox) prune() {
	now := time.Now()
	kept := q.entries[:0]
	for _, entry := range q.entries {
		if entry.ExpiresAt.After(now) {
			kept = append(kept, entry)
		}
	}
	clear(q.entries[len(kept):])
	q.entries = kept
}

func (q *launchInbox) add(message LaunchMessage) error {
	id, err := hex.DecodeString(message.ID)
	if err != nil || len(id) != 32 || len(message.URL) > 4096 {
		return errors.New("invalid launch request")
	}
	if err := q.validate(message.URL); err != nil {
		return errors.New("invalid launch URL")
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.prune()
	active := 0
	for _, entry := range q.entries {
		if entry.ID == message.ID {
			if entry.URL != message.URL {
				return errors.New("launch request ID reused")
			}
			return nil
		}
		if !entry.acked {
			active++
		}
	}
	// Keep acknowledged entries for the same TTL to deduplicate lost responses.
	if active >= 16 || len(q.entries) >= 128 {
		return errors.New("launch inbox full")
	}
	message.ExpiresAt = time.Now().Add(2 * time.Minute)
	q.entries = append(q.entries, launchEntry{LaunchMessage: message})
	return nil
}

func decodeLaunchBody(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("invalid launch payload")
	}
	return nil
}

func (q *launchInbox) serveForward(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	// A separate token can enqueue URLs only; it cannot read the queue, switch
	// databases or access the child control API. Browser requests are rejected.
	if r.Method != http.MethodPost || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") != "" ||
		subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+q.token)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var message LaunchMessage
	if err := decodeLaunchBody(w, r, &message); err != nil {
		http.Error(w, "invalid launch request", http.StatusBadRequest)
		return
	}
	if err := q.add(message); err != nil {
		http.Error(w, "launch request rejected", http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// serveRead is called only after authentication with the current child token.
func (q *launchInbox) serveRead(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Ack []string `json:"ack"`
	}
	if err := decodeLaunchBody(w, r, &input); err != nil || len(input.Ack) > 16 {
		http.Error(w, "invalid launch acknowledgement", http.StatusBadRequest)
		return
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.prune()
	result := make([]LaunchMessage, 0, 16)
	for i := range q.entries {
		entry := &q.entries[i]
		for _, id := range input.Ack {
			if id == entry.ID {
				entry.acked = true
			}
		}
		if !entry.acked {
			result = append(result, entry.LaunchMessage)
		}
	}
	_ = json.NewEncoder(w).Encode(result)
}

func (c *Client) Launches(ctx context.Context, acknowledged []string) ([]LaunchMessage, error) {
	var result []LaunchMessage
	err := c.call(ctx, "/launches", struct {
		Ack []string `json:"ack"`
	}{acknowledged}, &result)
	return result, err
}

// ForwardLaunch is called before opening any database. A bounded retry covers
// the interval between acquiring the launcher lock and publishing the inbox.
func ForwardLaunch(ctx context.Context, directory, rawURL string) error {
	message := LaunchMessage{ID: randomID(), URL: rawURL}
	body, err := json.Marshal(message)
	if err != nil || len(body) > 8192 {
		return errors.New("invalid launch request")
	}
	client := &http.Client{Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true},
		Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	for {
		if forwardLaunchOnce(ctx, client, filepath.Join(directory, "launch-endpoint.json"), body) == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return errors.New("running desktop did not accept the launch request")
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func forwardLaunchOnce(ctx context.Context, client *http.Client, path string, body []byte) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	var endpoint launchEndpoint
	if err := json.NewDecoder(io.LimitReader(f, 4096)).Decode(&endpoint); err != nil {
		return err
	}
	u, err := url.Parse(endpoint.Address)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return errors.New("invalid launch endpoint")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 {
		return errors.New("invalid launch port")
	}
	token, err := hex.DecodeString(endpoint.Token)
	if err != nil || len(token) != 32 {
		return errors.New("invalid launch token")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.Address+"/launch", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+endpoint.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("launch inbox unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return errors.New("launch rejected")
	}
	return nil
}
