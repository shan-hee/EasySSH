package sshutil

import (
	"bufio"
	"fmt"
	"regexp"
	"strings"

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
func FetchCompletionHistory(client *ssh.Client) ([]string, error) {
	shell := detectShellType(client)
	historyFile := completionHistoryFile(shell)

	session, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("create completion history session: %w", err)
	}
	defer session.Close()

	command := fmt.Sprintf("tail -n %d %s 2>/dev/null || true", CompletionHistoryLimit, historyFile)
	output, err := session.CombinedOutput(command)
	if err != nil {
		return nil, fmt.Errorf("read completion history: %w", err)
	}

	commands := parseCompletionHistory(shell, string(output))
	return deduplicateNewestFirst(commands), nil
}

func detectShellType(client *ssh.Client) shellType {
	session, err := client.NewSession()
	if err != nil {
		return shellBash
	}
	defer session.Close()

	output, err := session.CombinedOutput("printf '%s' \"$SHELL\"")
	if err != nil {
		return shellBash
	}

	shellPath := strings.TrimSpace(string(output))
	switch {
	case strings.HasSuffix(shellPath, "/zsh"):
		return shellZsh
	case strings.HasSuffix(shellPath, "/fish"):
		return shellFish
	case strings.HasSuffix(shellPath, "/bash"):
		return shellBash
	case strings.HasSuffix(shellPath, "/sh"):
		return shellSh
	default:
		return shellBash
	}
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

func parseCompletionHistory(shell shellType, content string) []string {
	commands := make([]string, 0)
	scanner := bufio.NewScanner(strings.NewReader(content))
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
	return commands
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
