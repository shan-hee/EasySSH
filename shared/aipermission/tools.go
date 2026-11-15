package aipermission

import (
	"github.com/easyssh/shared/aitooloutput"
	"github.com/easyssh/shared/aiworkspace"
)

// ToolPolicy is what decides whether an agent tool is offered and may run.
// Both hosts take it from here, so a tool cannot be confirmation-free, or
// open to read-only sessions, on one host only.
type ToolPolicy struct {
	// Changes is set for tools that change the remote server. Read-only
	// sessions do not get them, and each run is recorded before it starts.
	Changes bool
	// Dangerous marks the tool in the interface.
	Dangerous bool
	// Confirm asks the user before each run, except in privileged mode.
	Confirm bool
}

// Modes are the permission modes that see the tool and may run it.
func (p ToolPolicy) Modes() []string {
	if p.Changes {
		return []string{ModeBalanced, ModePrivileged}
	}
	return []string{ModeReadonly, ModeBalanced, ModePrivileged}
}

var toolPolicies = map[string]ToolPolicy{
	aiworkspace.CreateTool:      {},
	aitooloutput.ReadResultTool: {},
	"list_servers":              {},
	"get_server_info":           {},
	"get_system_info":           {},
	"list_directory":            {},
	"read_file":                 {},
	"create_directory":          {Changes: true},
	"execute_command":           {Changes: true, Dangerous: true, Confirm: true},
	"write_file":                {Changes: true, Dangerous: true, Confirm: true},
	"delete_file":               {Changes: true, Dangerous: true, Confirm: true},
}

// PolicyFor is for building a tool catalog. A tool without a policy is a
// programming error: no host may offer it.
func PolicyFor(tool string) ToolPolicy {
	policy, found := toolPolicies[tool]
	if !found {
		panic("agent tool has no permission policy: " + tool)
	}
	return policy
}

// ToolAllowed reports whether the mode may run the tool. A tool without a
// policy may not run.
func ToolAllowed(mode, tool string) bool {
	policy, found := toolPolicies[tool]
	return found && (!policy.Changes || NormalizeMode(mode) != ModeReadonly)
}

// ChangesRemoteState reports whether a run of the tool must be recorded
// before it starts.
func ChangesRemoteState(tool string) bool { return toolPolicies[tool].Changes }

// SupportsMode respects the host registry's explicit modes, including custom tools.
func SupportsMode(mode string, supported []string) bool {
	if len(supported) == 0 {
		return true
	}
	for _, candidate := range supported {
		if candidate == mode {
			return true
		}
	}
	return false
}
