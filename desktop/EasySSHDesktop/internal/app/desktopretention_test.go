package app

import (
	"testing"

	"github.com/easyssh/shared/retention"
)

func TestDesktopRetentionDaysFallsBackToTheDefault(t *testing.T) {
	preferences := DesktopPreferenceSnapshot{
		desktopTaskRetentionPreference: "30",
		desktopLogRetentionPreference:  "0",
		"other":                        "45",
	}
	if days := desktopRetentionDays(preferences, desktopTaskRetentionPreference); days != 30 {
		t.Fatalf("chosen period ignored: %d", days)
	}
	if days := desktopRetentionDays(preferences, desktopLogRetentionPreference); days != retention.Forever {
		t.Fatalf("keep forever ignored: %d", days)
	}
	for _, value := range []string{"", "soon", "45", "-1"} {
		preferences[desktopTaskRetentionPreference] = value
		if days := desktopRetentionDays(preferences, desktopTaskRetentionPreference); days != retention.DefaultDays {
			t.Fatalf("%q did not fall back to the default: %d", value, days)
		}
	}
}
