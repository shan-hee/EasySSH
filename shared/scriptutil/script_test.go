package scriptutil

import (
	"github.com/easyssh/shared/protocol"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestParameterIsDataNotShellSource(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash is required")
	}
	marker := filepath.Join(t.TempDir(), "unexpected-execution")
	value := "x'; touch '" + marker + "'; # $(touch '" + marker + "')\n$HOME"
	command, err := Command("bash", `printf '%s' "$EASYSSH_PARAM_message"`, map[string]string{"message": value, "PATH": "/nonexistent"})
	if err != nil {
		t.Fatal(err)
	}
	output, err := exec.Command("sh", "-c", command).CombinedOutput()
	if err != nil {
		t.Fatalf("execute script: %v: %s", err, output)
	}
	if string(output) != value {
		t.Fatalf("parameter was evaluated: %q", output)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("parameter caused shell execution: %v", err)
	}
}

func TestVersionPinsLanguageAndContent(t *testing.T) {
	base := Version("bash", "echo ready")
	if len(base) != 64 {
		t.Fatal("version must be a full SHA-256 digest")
	}
	if base == Version("sh", "echo ready") || base == Version("bash", "echo changed") {
		t.Fatal("execution change must invalidate version")
	}
}

func TestRejectUnsafeOrOversizedParameters(t *testing.T) {
	for _, parameters := range []map[string]string{
		{"x=y": "z"}, {"x;touch": "z"}, {"valid": "nul\x00value"}, {"valid": strings.Repeat("x", 65537)},
	} {
		if _, err := Command("bash", "true", parameters); err == nil {
			t.Fatalf("accepted invalid parameters %v", parameters)
		}
	}
	if _, err := Command("bash; echo injected", "true", nil); err == nil {
		t.Fatal("accepted arbitrary interpreter")
	}
}

func TestParameterRulesMatchExecutableLimits(t *testing.T) {
	for _, rules := range []map[string]protocol.GrantParameterRule{
		{"value": {MaxBytes: 0}}, {"value": {MaxBytes: 65537}},
		{"bad-name": {MaxBytes: 10}}, {"value": {MaxBytes: 3, Values: []string{"four"}}},
		{"value": {MaxBytes: 10, Values: []string{"a\x00b"}}},
	} {
		if err := ValidateParameterRules(rules); err == nil {
			t.Fatal("invalid execution rule accepted")
		}
	}
	if err := ValidateParameterRules(map[string]protocol.GrantParameterRule{"value": {Required: true, MaxBytes: 100, Values: []string{"$(ordinary data)", "value"}}}); err != nil {
		t.Fatal(err)
	}
}

func TestParameterRulesBoundEncodedMetadata(t *testing.T) {
	for _, rules := range []map[string]protocol.GrantParameterRule{
		{"value": {MaxBytes: 65536, Values: []string{strings.Repeat("<", 12000)}}},
		{"value": {MaxBytes: 1, Values: make([]string, 257)}},
		{"value": {MaxBytes: 65536, Values: []string{strings.Repeat("a", 40000), strings.Repeat("b", 40000)}}},
	} {
		if err := ValidateParameterRules(rules); err == nil {
			t.Fatal("oversized catalogue metadata accepted")
		}
	}
}
