package sftputil

import (
	"os"
	"testing"
)

func TestPOSIXPathsPreserveFilenameBytes(t *testing.T) {
	for _, value := range []string{"/notes ", "/ spaced /name ", `/name\with\backslash`, "/a\nname", "/a?#b"} {
		if got := NormalizePath(value); got != value {
			t.Fatalf("changed path %q to %q", value, got)
		}
	}
	if got := JoinPath("/folder", `notes\draft `); got != `/folder/notes\draft ` {
		t.Fatalf("changed filename: %q", got)
	}
}

func TestPermissionModeStrictAndSpecialBits(t *testing.T) {
	for _, raw := range []string{"755junk", "0755 ", "-755", "888", "10000", "75"} {
		if _, err := ParsePermissionMode(raw); err == nil {
			t.Fatalf("accepted %q", raw)
		}
	}
	for raw, want := range map[string]os.FileMode{"644": 0644, "0000": 0, "4755": 0755 | os.ModeSetuid, "2770": 0770 | os.ModeSetgid, "1777": 0777 | os.ModeSticky} {
		got, err := ParsePermissionMode(raw)
		if err != nil || got != want {
			t.Fatalf("%s: got %v want %v (%v)", raw, got, want, err)
		}
	}
}
