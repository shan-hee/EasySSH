package aipermission

import (
	"slices"
	"testing"
)

func TestToolPolicies(t *testing.T) {
	for tool, policy := range toolPolicies {
		if ToolAllowed(ModeReadonly, tool) == policy.Changes || slices.Contains(policy.Modes(), ModeReadonly) == policy.Changes {
			t.Errorf("%s: changes remote state=%v, but readonly disagrees", tool, policy.Changes)
		}
		if !ToolAllowed(ModeBalanced, tool) || !ToolAllowed(ModePrivileged, tool) {
			t.Errorf("%s is not available outside readonly mode", tool)
		}
		if ChangesRemoteState(tool) != policy.Changes {
			t.Errorf("%s: execution tracking disagrees with its policy", tool)
		}
		if (policy.Dangerous || policy.Confirm) && !policy.Changes {
			t.Errorf("%s is confirmed or dangerous without changing remote state", tool)
		}
	}
	if ToolAllowed(ModePrivileged, "undeclared_tool") || ChangesRemoteState("undeclared_tool") {
		t.Error("a tool without a policy has permissions")
	}
}
