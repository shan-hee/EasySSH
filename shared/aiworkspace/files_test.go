package aiworkspace

import "testing"

func TestCheckExpectedHash(t *testing.T) {
	for _, tc := range []struct {
		name, content, expected string
		exists, wantError       bool
	}{
		{"matching", "before", Hash("before"), true, false},
		{"changed", "after", Hash("before"), true, true},
		{"whitespace is not omitted", "before", " ", true, true},
		{"deleted", "", Hash("before"), false, true},
		{"deleted empty file", "", Hash(""), false, true},
		{"existing empty file", "", Hash(""), true, false},
		{"omitted on existing", "before", "", true, false},
		{"omitted on new file", "", "", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := CheckExpectedHash(tc.content, tc.exists, tc.expected); (err != nil) != tc.wantError {
				t.Fatalf("unexpected result: %v", err)
			}
		})
	}
}
