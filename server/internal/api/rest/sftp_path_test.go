package rest

import "testing"

func TestBackgroundDeletePreservesPOSIXTarget(t *testing.T) {
	for _, value := range []string{"/tmp/notes ", `/tmp/name\child`, "/tmp/line\nbreak"} {
		got, err := validateBackgroundDeletePath(value)
		if err != nil || got != value {
			t.Fatalf("delete target changed: %q -> %q (%v)", value, got, err)
		}
	}
	for _, value := range []string{"/", "/etc", "/tmp/../etc", "relative", "/tmp/a\x00b"} {
		if _, err := validateBackgroundDeletePath(value); err == nil {
			t.Fatalf("unsafe delete path accepted: %q", value)
		}
	}
}
