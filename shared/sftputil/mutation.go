package sftputil

import (
	"errors"
	"github.com/pkg/sftp"
	"os"
)

var ErrMutationOutcomeUnknown = errors.New("remote file mutation outcome unknown")

// DefiniteStatus excludes transport-level SFTP statuses: they do not acknowledge
// whether a mutation happened on the remote filesystem.
func DefiniteStatus(err error) bool {
	var status *sftp.StatusError
	if errors.As(err, &status) {
		return status.Code != 6 && status.Code != 7
	}
	return os.IsExist(err) || os.IsPermission(err) || os.IsNotExist(err)
}

// MutationError is used only after a mutating request was attempted.
func MutationError(err error) error {
	if err == nil || DefiniteStatus(err) {
		return err
	}
	return errors.Join(ErrMutationOutcomeUnknown, err)
}
