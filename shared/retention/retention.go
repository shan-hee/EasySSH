// Package retention defines how long finished records are kept. The server and
// the desktop each keep their own policy, because each cleans its own data.
package retention

import (
	"slices"
	"time"
)

// Forever disables cleanup for a category.
const Forever = 0

// DefaultDays applies until the user chooses a period.
const DefaultDays = 90

// DefaultDeletedDays applies to the recycle bin. It is shorter because the bin
// keeps what the user meant to remove, saved credentials included.
const DefaultDeletedDays = 30

// Choices are the periods offered in settings, in days.
var Choices = []int{7, 14, 30, 60, 90, 180, 365}

func Valid(days int) bool {
	return days == Forever || slices.Contains(Choices, days)
}

// Cutoff is the time before which records of a category are removed. It
// reports false when the category is kept forever.
func Cutoff(now time.Time, days int) (time.Time, bool) {
	if days == Forever {
		return time.Time{}, false
	}
	return now.AddDate(0, 0, -days), true
}
