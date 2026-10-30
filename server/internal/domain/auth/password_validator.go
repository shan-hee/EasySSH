package auth

import (
	"fmt"
	"github.com/easyssh/server/internal/pkg/password"
)

func ValidatePasswordWithDefault(value string) error {
	if len(value) > 72 {
		return fmt.Errorf("%w: password exceeds 72 bytes", ErrInvalidInput)
	}
	if err := password.ValidateWithDefault(value); err != nil {
		return fmt.Errorf("%w: %s", ErrInvalidInput, err)
	}
	return nil
}
