package sftputil

import (
	"errors"
	"os"
	"strconv"
)

// ParsePermissionMode accepts the entire Unix octal mode, not a numeric prefix.
// Go's special mode bits occupy different positions from Unix's 07777 mask.
func ParsePermissionMode(raw string) (os.FileMode, error) {
	if len(raw) < 3 || len(raw) > 4 {
		return 0, errors.New("invalid permission mode")
	}
	for _, digit := range raw {
		if digit < '0' || digit > '7' {
			return 0, errors.New("invalid permission mode")
		}
	}
	value, err := strconv.ParseUint(raw, 8, 12)
	if err != nil {
		return 0, errors.New("invalid permission mode")
	}
	mode := os.FileMode(value & 0777)
	if value&04000 != 0 {
		mode |= os.ModeSetuid
	}
	if value&02000 != 0 {
		mode |= os.ModeSetgid
	}
	if value&01000 != 0 {
		mode |= os.ModeSticky
	}
	return mode, nil
}
