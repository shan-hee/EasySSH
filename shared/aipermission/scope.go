package aipermission

import (
	"encoding/json"
	"strings"

	"github.com/easyssh/shared/protocol"
)

// NormalizeScope infers terminal scope from either target identifier.
func NormalizeScope(scopes ...protocol.AISessionScope) protocol.AISessionScope {
	if len(scopes) == 0 {
		return protocol.AISessionScope{}
	}
	scope := scopes[0]
	normalized := protocol.AISessionScope{
		Kind:              strings.ToLower(strings.TrimSpace(scope.Kind)),
		TerminalSessionID: strings.TrimSpace(scope.TerminalSessionID),
		ServerID:          strings.TrimSpace(scope.ServerID),
		ServerName:        strings.TrimSpace(scope.ServerName),
		Host:              strings.TrimSpace(scope.Host),
		Port:              scope.Port,
		Username:          strings.TrimSpace(scope.Username),
	}

	switch normalized.Kind {
	case "terminal":
		return normalized
	default:
		if normalized.TerminalSessionID != "" || normalized.ServerID != "" {
			normalized.Kind = "terminal"
			return normalized
		}
		return protocol.AISessionScope{}
	}
}

func ScopeMatches(target, filter protocol.AISessionScope) bool {
	target = NormalizeScope(target)
	filter = NormalizeScope(filter)
	if filter.Kind == "" {
		return true
	}
	if target.Kind != filter.Kind {
		return false
	}
	if filter.TerminalSessionID != "" && target.TerminalSessionID != filter.TerminalSessionID {
		return false
	}
	if filter.ServerID != "" && target.ServerID != filter.ServerID {
		return false
	}
	return true
}

// NormalizeScopePointer preserves the optional scope representation used by desktop.
func NormalizeScopePointer(scope *protocol.AISessionScope) *protocol.AISessionScope {
	if scope == nil {
		return nil
	}
	normalized := NormalizeScope(*scope)
	if normalized.Kind == "" {
		return nil
	}
	return &normalized
}

// DecodeScope applies the same normalization to persisted and request scopes.
func DecodeScope(raw string) *protocol.AISessionScope {
	var scope protocol.AISessionScope
	if err := json.Unmarshal([]byte(raw), &scope); err != nil {
		return nil
	}
	return NormalizeScopePointer(&scope)
}
