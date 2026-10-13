package password

import (
	"errors"
	"unicode/utf8"
)

type ValidationError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *ValidationError) Error() string { return e.Message }

// Bcrypt supports at most 72 bytes; the minimum is counted in Unicode characters.
func ValidateWithDefault(value string) error {
	if utf8.RuneCountInString(value) < 9 {
		return &ValidationError{Code: "password_too_short", Message: "密码至少需要 9 个字符"}
	}
	if len(value) > 72 {
		return &ValidationError{Code: "password_too_long", Message: "密码不能超过 72 字节"}
	}
	return nil
}
func IsValidationError(err error) bool { var target *ValidationError; return errors.As(err, &target) }
