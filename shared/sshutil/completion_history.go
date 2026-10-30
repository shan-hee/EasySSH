package sshutil

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

const CompletionHistoryLimit = 500

type shellType string

const (
	shellBash shellType = "bash"
	shellZsh  shellType = "zsh"
	shellFish shellType = "fish"
	shellSh   shellType = "sh"
)

var (
	zshHistoryPattern  = regexp.MustCompile(`^:\s*\d+:\d+;(.*)$`)
	fishHistoryPattern = regexp.MustCompile(`^-\s+cmd:\s+(.*)$`)
)

// FetchCompletionHistory reads the current SSH user's shell history using the
// same fixed policy for every EasySSH client.
func FetchCompletionHistory(ctx context.Context, client *ssh.Client) ([]string, error) {
	if client == nil {
		return nil, errors.New("SSH client is required for completion history")
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	output, err := CommandOutput(ctx, client, "printf '%s' \"$SHELL\"", 4096)
	if err != nil {
		return nil, err
	}
	shell := shellBash
	shellPath := strings.TrimSpace(string(output))
	switch {
	case strings.HasSuffix(shellPath, "/zsh"):
		shell = shellZsh
	case strings.HasSuffix(shellPath, "/fish"):
		shell = shellFish
	case strings.HasSuffix(shellPath, "/sh"):
		shell = shellSh
	}
	command := fmt.Sprintf("tail -n %d %s 2>/dev/null || true", CompletionHistoryLimit, completionHistoryFile(shell))
	output, err = CommandOutput(ctx, client, command, 128<<10)
	if err != nil {
		return nil, err
	}
	commands, err := parseCompletionHistory(shell, string(output))
	if err != nil {
		return nil, err
	}
	return deduplicateNewestFirst(commands), nil
}

var errCompletionOutputLimit = errors.New("completion history exceeds output limit")

type completionBuffer struct {
	mu       sync.Mutex
	data     bytes.Buffer
	limit    int
	overflow bool
	cancel   context.CancelFunc
}

func (b *completionBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.data.Len()+len(p) > b.limit {
		b.overflow = true
		b.cancel()
		return 0, errCompletionOutputLimit
	}
	return b.data.Write(p)
}

// CommandOutput runs a bounded-output command on a borrowed SSH client. A peer
// that refuses channel cancellation may force closure of the shared transport.
func CommandOutput(ctx context.Context, client *ssh.Client, command string, limit int) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// SSH channel-open has no cancellation API: close the transport and wait
	// for channel-open to return before handing ownership back to the caller.
	opened := make(chan struct{})
	stopOpen := context.AfterFunc(ctx, func() { defer close(opened); _ = client.Close() })
	session, err := client.NewSession()
	if !stopOpen() {
		<-opened
	}
	if ctx.Err() != nil {
		if session != nil {
			_ = session.Close()
		}
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, err
	}
	// Even sending CHANNEL_CLOSE can block behind a stalled transport writer.
	// Join the close worker on both normal and canceled completion.
	var closeOnce sync.Once
	closeSession := func() {
		closeOnce.Do(func() {
			finished := make(chan struct{})
			go func() { defer close(finished); _ = session.Close() }()
			timer := time.NewTimer(time.Second)
			defer timer.Stop()
			select {
			case <-finished:
			case <-timer.C:
				_ = client.Close()
				<-finished
			}
		})
	}
	defer closeSession()
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	buffer := &completionBuffer{limit: limit, cancel: cancel}
	session.Stdout, session.Stderr = buffer, buffer
	closed := make(chan struct{})
	stop := context.AfterFunc(runCtx, func() { defer close(closed); closeSession() })
	defer func() {
		if !stop() {
			<-closed
		}
	}()
	completed := make(chan error, 1)
	go func() { completed <- session.Run(command) }()
	err = nil
	select {
	case err = <-completed:
	case <-runCtx.Done():
		// Give a cooperative peer time to close this channel. If it ignores
		// cancellation, close the transport so Run cannot leak indefinitely.
		grace := time.NewTimer(time.Second)
		select {
		case err = <-completed:
		case <-grace.C:
			_ = client.Close()
			err = <-completed
		}
		grace.Stop()
	}
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	if buffer.overflow {
		return nil, errCompletionOutputLimit
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, err
	}
	return append([]byte(nil), buffer.data.Bytes()...), nil
}

func completionHistoryFile(shell shellType) string {
	switch shell {
	case shellZsh:
		return "~/.zsh_history"
	case shellFish:
		return "~/.local/share/fish/fish_history"
	case shellSh:
		return "~/.sh_history"
	case shellBash:
		fallthrough
	default:
		return "~/.bash_history"
	}
}

func parseCompletionHistory(shell shellType, content string) ([]string, error) {
	commands := make([]string, 0)
	scanner := bufio.NewScanner(strings.NewReader(content))
	scanner.Buffer(make([]byte, 4096), 8192)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		switch shell {
		case shellZsh:
			if matches := zshHistoryPattern.FindStringSubmatch(line); len(matches) > 1 {
				line = strings.TrimSpace(matches[1])
			}
		case shellFish:
			matches := fishHistoryPattern.FindStringSubmatch(line)
			if len(matches) <= 1 {
				continue
			}
			line = strings.TrimSpace(matches[1])
		}

		if line != "" {
			commands = append(commands, line)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("invalid completion history line: %w", err)
	}
	return commands, nil
}

func deduplicateNewestFirst(commands []string) []string {
	seen := make(map[string]struct{}, len(commands))
	result := make([]string, 0, len(commands))
	for index := len(commands) - 1; index >= 0; index-- {
		command := strings.TrimSpace(commands[index])
		if command == "" {
			continue
		}
		if _, exists := seen[command]; exists {
			continue
		}
		seen[command] = struct{}{}
		result = append(result, command)
	}
	return result
}
