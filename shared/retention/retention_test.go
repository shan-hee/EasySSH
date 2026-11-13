package retention

import (
	"testing"
	"time"
)

func TestValidAcceptsOnlyOfferedPeriods(t *testing.T) {
	for _, days := range append([]int{Forever}, Choices...) {
		if !Valid(days) {
			t.Fatalf("%d days rejected", days)
		}
	}
	for _, days := range []int{-1, 1, 45, 3650} {
		if Valid(days) {
			t.Fatalf("%d days accepted", days)
		}
	}
	if !Valid(DefaultDays) {
		t.Fatal("default period is not offered")
	}
}

func TestCutoff(t *testing.T) {
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)
	if _, ok := Cutoff(now, Forever); ok {
		t.Fatal("forever produced a cutoff")
	}
	cutoff, ok := Cutoff(now, 30)
	if !ok || !cutoff.Equal(time.Date(2026, 5, 31, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("30 day cutoff: %v %v", cutoff, ok)
	}
}
