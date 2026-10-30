package servertag

import (
	"slices"
	"strings"
	"testing"
)

func TestCanonicalNamesAndBounds(t *testing.T) {
	got, err := Normalize([]string{" prod ", "web", "prod", "Prod"})
	if err != nil || !slices.Equal(got, []string{"Prod", "prod", "web"}) {
		t.Fatalf("names: %v %v", got, err)
	}
	for _, input := range [][]string{{""}, {"a\x00b"}, {strings.Repeat("x", 101)}, make([]string, 65), {string([]byte{0xff})}} {
		if _, err := Normalize(input); err == nil {
			t.Fatal("invalid labels accepted")
		}
	}
}
