// Package instanceactivation coordinates a launcher and its application child.
// The launcher owns durable configuration; the child never edits .env or a database.
package instanceactivation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"sync"
	"time"
)

const addressEnv = "EASYSSH_LAUNCHER_ADDRESS"
const tokenEnv = "EASYSSH_LAUNCHER_TOKEN"

type Operation struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

type Info struct {
	Available       bool       `json:"available"`
	ActiveBackupID  string     `json:"active_backup_id,omitempty"`
	ActiveDirectory string     `json:"active_directory,omitempty"`
	CanRollback     bool       `json:"can_rollback"`
	Operation       *Operation `json:"operation,omitempty"`
}

type Request struct {
	RecordID  string `json:"record_id"`
	Directory string `json:"directory"`
	Rollback  bool   `json:"rollback"`
}

type Client struct{ address, token string }

func FromEnvironment() *Client {
	address, token := os.Getenv(addressEnv), os.Getenv(tokenEnv)
	if address == "" || token == "" {
		return nil
	}
	return &Client{address: address, token: token}
}

func (c *Client) call(ctx context.Context, path string, input, output any) error {
	if c == nil {
		return errors.New("instance activation requires the managed instance launcher")
	}
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.address+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	// The private loopback channel must not use a deployment's HTTP proxy.
	client := &http.Client{Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}}
	defer client.CloseIdleConnections()
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("instance launcher is unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var failure struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&failure)
		if failure.Error != "" {
			return errors.New(failure.Error)
		}
		return fmt.Errorf("instance launcher returned %d", resp.StatusCode)
	}
	if output != nil {
		return json.NewDecoder(resp.Body).Decode(output)
	}
	return nil
}

func (c *Client) Info(ctx context.Context) (Info, error) {
	if c == nil {
		return Info{}, nil
	}
	var info Info
	err := c.call(ctx, "/info", nil, &info)
	return info, err
}

func (c *Client) Activate(ctx context.Context, request Request) (Operation, error) {
	var operation Operation
	err := c.call(ctx, "/activate", request, &operation)
	return operation, err
}

func (c *Client) Status(ctx context.Context, id string) (Operation, error) {
	info, err := c.Info(ctx)
	if err != nil {
		return Operation{}, err
	}
	if info.Operation == nil || info.Operation.ID != id {
		return Operation{}, errors.New("activation operation not found")
	}
	return *info.Operation, nil
}

// Ready is sent only after database/credential validation and binding the HTTP port.
// It permits the accept loop to start; Serving performs the final commit handshake.
func (c *Client) Ready(ctx context.Context) error {
	if c == nil {
		return nil
	}
	return c.call(ctx, "/ready", nil, nil)
}

// Serving confirms that HTTP Serve has entered its accept loop. Workers and
// public requests stay gated until the launcher durably commits the selection.
func (c *Client) Serving(ctx context.Context) error {
	if c == nil {
		return nil
	}
	return c.call(ctx, "/serving", nil, nil)
}

type Listening struct {
	net.Listener
	Accepting chan struct{}
	once      sync.Once
}

func (l *Listening) Accept() (net.Conn, error) {
	l.once.Do(func() { close(l.Accepting) })
	return l.Listener.Accept()
}

func (c *Client) Shutdown(ctx context.Context) <-chan struct{} {
	shutdown := make(chan struct{})
	if c == nil {
		return shutdown
	}
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		failures := 0
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				var control struct {
					Stop bool `json:"stop"`
				}
				if err := c.call(ctx, "/control", nil, &control); err != nil {
					failures++
				} else {
					failures = 0
				}
				if control.Stop || failures >= 3 {
					close(shutdown)
					return
				}
			}
		}
	}()
	return shutdown
}
