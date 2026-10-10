package datasync

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"github.com/easyssh/shared/syncdata"
)

type Peer struct {
	Document string   `json:"document,omitempty"`
	Changes  []string `json:"changes,omitempty"`
	Heads    []string `json:"heads,omitempty"`
}
type Conflict struct {
	Key    string   `json:"key"`
	Field  string   `json:"field"`
	Values []string `json:"values"`
}
type Resolution struct {
	Key   string `json:"key"`
	Field string `json:"field"`
	Value string `json:"value"`
}
type EngineInput struct {
	Document   string            `json:"document"`
	Current    syncdata.Snapshot `json:"current"`
	Peer       Peer              `json:"peer"`
	Resolution *Resolution       `json:"resolution,omitempty"`
}
type EngineResult struct {
	Document  string            `json:"document"`
	Snapshot  syncdata.Snapshot `json:"snapshot"`
	Conflicts []Conflict        `json:"conflicts"`
	Response  Peer              `json:"response"`
}

type Engine struct {
	mu     sync.Mutex
	cmd    *exec.Cmd
	input  io.WriteCloser
	output *bufio.Scanner
}

func (e *Engine) stop() {
	if e.cmd != nil {
		_ = e.cmd.Process.Kill()
		_ = e.cmd.Wait()
		e.cmd = nil
	}
}
func (e *Engine) Close() { e.mu.Lock(); defer e.mu.Unlock(); e.stop() }
func (e *Engine) Run(ctx context.Context, input EngineInput) (EngineResult, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return EngineResult{}, err
	}
	if e.cmd == nil {
		path := os.Getenv("EASYSSH_SYNC_ENGINE")
		if path == "" {
			path = filepath.Join("sync-runtime", "engine.mjs")
			if _, err := os.Stat(path); err != nil {
				exe, _ := os.Executable()
				path = filepath.Join(filepath.Dir(exe), "sync-runtime", "engine.mjs")
			}
		}
		cmd := exec.Command("node", "--max-old-space-size=128", path)
		cmd.Stderr = os.Stderr
		stdin, err := cmd.StdinPipe()
		if err != nil {
			return EngineResult{}, err
		}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			_ = stdin.Close()
			return EngineResult{}, err
		}
		if err = cmd.Start(); err != nil {
			return EngineResult{}, fmt.Errorf("start sync runtime (Node.js 22+ required): %w", err)
		}
		e.cmd = cmd
		e.input = stdin
		e.output = bufio.NewScanner(stdout)
		e.output.Buffer(make([]byte, 4096), 32<<20)
	}
	type response struct {
		Result EngineResult `json:"result"`
		Error  string       `json:"error"`
	}
	done := make(chan error, 1)
	var result response
	go func() {
		if err := json.NewEncoder(e.input).Encode(input); err != nil {
			done <- err
			return
		}
		if !e.output.Scan() {
			err := e.output.Err()
			if err == nil {
				err = io.ErrUnexpectedEOF
			}
			done <- err
			return
		}
		done <- json.Unmarshal(e.output.Bytes(), &result)
	}()
	select {
	case <-ctx.Done():
		e.stop()
		<-done
		return EngineResult{}, ctx.Err()
	case err := <-done:
		if err != nil {
			e.stop()
			return EngineResult{}, fmt.Errorf("sync runtime: %w", err)
		}
	}
	if result.Error != "" {
		return EngineResult{}, errors.New(result.Error)
	}
	if len(result.Result.Document) > 8<<20 {
		return EngineResult{}, errors.New("sync history exceeds the 8 MiB limit")
	}
	if err := syncdata.Validate(result.Result.Snapshot); err != nil {
		return EngineResult{}, err
	}
	return result.Result, nil
}
