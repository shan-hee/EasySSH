package auth

import "github.com/easyssh/server/internal/pkg/password"

func ValidatePasswordWithDefault(value string) error { return password.ValidateWithDefault(value) }
