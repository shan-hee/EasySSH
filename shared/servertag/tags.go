// Package servertag defines canonical server labels. Names are their identity;
// there is no mutable shared metadata or cross-space ownership behind a label.
package servertag

import (
	"errors"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

var ErrInvalid = errors.New("invalid server tags: at most 64 names of 1 to 100 bytes")

func Normalize(values []string) ([]string, error) {
	if len(values) > 64 {
		return nil, ErrInvalid
	}
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		name := strings.TrimSpace(value)
		if name == "" || len(name) > 100 || !utf8.ValidString(name) {
			return nil, ErrInvalid
		}
		for _, r := range name {
			if unicode.IsControl(r) {
				return nil, ErrInvalid
			}
		}
		if !seen[name] {
			seen[name] = true
			result = append(result, name)
		}
	}
	sort.Strings(result)
	return result, nil
}
