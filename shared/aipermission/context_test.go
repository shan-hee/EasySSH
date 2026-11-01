package aipermission

import "testing"

func TestRequiresConfirmation(t *testing.T) {
	for _, tc := range []struct {
		mode     string
		ordinary bool
		want     bool
	}{
		{ModeReadonly, false, false},
		{ModeReadonly, true, true},
		{ModeBalanced, false, false},
		{ModeBalanced, true, true},
		{"", false, false},
		{"", true, true},
		{ModePrivileged, false, false},
		{ModePrivileged, true, false},
		{" Privileged ", true, false},
	} {
		if got := RequiresConfirmation(tc.mode, tc.ordinary); got != tc.want {
			t.Errorf("RequiresConfirmation(%q, %v) = %v, want %v", tc.mode, tc.ordinary, got, tc.want)
		}
	}
}
