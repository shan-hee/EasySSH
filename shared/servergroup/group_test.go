package servergroup

import (
	"github.com/easyssh/shared/protocol"
	"strings"
	"testing"
)

func TestRejectsInvalidMetadata(t *testing.T) {
	for _, input := range []protocol.ServerGroupInput{{Name: ""}, {Name: "a\x00b"}, {Name: strings.Repeat("x", 101)}, {Name: "group", SortOrder: -1}} {
		if _, err := Normalize(input); err == nil {
			t.Fatal("invalid group accepted")
		}
	}
}
