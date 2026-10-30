// Package scriptutil defines the execution contract shared by both hosts.
package scriptutil

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"regexp"
	"sort"
	"strings"
)

var parameterName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)

func ValidParameterName(name string) bool { return parameterName.MatchString(name) }

func Version(language, content string) string {
	sum := sha256.Sum256([]byte("easyssh-script-v1\x00" + language + "\x00" + content))
	return hex.EncodeToString(sum[:])
}

func ValidateParameters(parameters map[string]string) error {
	if len(parameters) > 64 {
		return fmt.Errorf("too many script parameters")
	}
	total := 0
	for name, value := range parameters {
		if !ValidParameterName(name) || strings.ContainsRune(value, 0) || len(value) > 65536 {
			return fmt.Errorf("invalid script parameter %q", name)
		}
		total += len(name) + len(value)
	}
	if total > 128<<10 {
		return fmt.Errorf("script parameters exceed total size limit")
	}
	return nil
}

// ValidateParameterRules rejects grants that cannot be represented by the
// execution parameter contract. Values are data, never command fragments.
const MaxParameterRulesBytes = 64 << 10

func ValidateParameterRules(rules map[string]protocol.GrantParameterRule) error {
	rawBytes := 0
	if len(rules) > 64 {
		return fmt.Errorf("too many script parameter rules")
	}
	for name, rule := range rules {
		rawBytes += len(name)
		if !ValidParameterName(name) || rule.MaxBytes < 1 || rule.MaxBytes > 65536 || len(rule.Values) > 256 {
			return fmt.Errorf("invalid script parameter rule %q", name)
		}
		for _, value := range rule.Values {
			rawBytes += len(value)
			if rawBytes > MaxParameterRulesBytes {
				return fmt.Errorf("script parameter rules exceed size limit")
			}
			if len(value) > rule.MaxBytes || strings.ContainsRune(value, 0) {
				return fmt.Errorf("invalid allowed value for script parameter %q", name)
			}
		}
	}
	encoded, err := json.Marshal(rules)
	if err != nil || len(encoded) > MaxParameterRulesBytes {
		return fmt.Errorf("script parameter rules exceed size limit")
	}
	return nil
}

func ValidateMetadata(name, description string, tags []string) error {
	if strings.TrimSpace(name) == "" || len(name) > 100 || len(description) > 16384 || len(tags) > 64 {
		return fmt.Errorf("invalid script metadata")
	}
	return nil
}

func Interpreter(language string) (string, error) {
	switch language {
	case "bash":
		return "bash --noprofile --norc -c", nil
	case "sh":
		return "sh -c", nil
	case "python":
		return "python3 -c", nil
	case "javascript":
		return "node -e", nil
	case "powershell":
		return "pwsh -NoProfile -NonInteractive -Command", nil
	default:
		return "", fmt.Errorf("unsupported script language %q", language)
	}
}

// Values are never substituted into script source. A fixed prefix also prevents
// parameters named PATH, BASH_ENV or NODE_OPTIONS from changing the interpreter.
func Command(language, content string, parameters map[string]string) (string, error) {
	if content == "" || len(content) > 1<<20 || strings.ContainsRune(content, 0) {
		return "", fmt.Errorf("invalid script content")
	}
	interpreter, err := Interpreter(language)
	if err != nil {
		return "", err
	}
	if err := ValidateParameters(parameters); err != nil {
		return "", err
	}
	names := make([]string, 0, len(parameters))
	for name := range parameters {
		names = append(names, name)
	}
	sort.Strings(names)
	parts := []string{"env"}
	for _, name := range names {
		parts = append(parts, quote("EASYSSH_PARAM_"+name+"="+parameters[name]))
	}
	parts = append(parts, interpreter, quote(content))
	return strings.Join(parts, " "), nil
}

func quote(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'" }
