// Package servergroup defines stable grouping metadata shared by both hosts.
package servergroup

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

var ErrInvalid = errors.New("invalid server group")

func Normalize(input protocol.ServerGroupInput) (protocol.ServerGroupInput, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 100 || !utf8.ValidString(input.Name) || input.SortOrder < 0 || input.SortOrder > 1000000 {
		return input, ErrInvalid
	}
	for _, r := range input.Name {
		if unicode.IsControl(r) {
			return input, ErrInvalid
		}
	}
	return input, nil
}
func ValidID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id != uuid.Nil && id.String() == value
}
