package sftputil

import (
	"errors"
	"github.com/pkg/sftp"
	"io"
	"os"
	"testing"
)

func TestMutationResponseDistinguishesRejectionFromLostReply(t *testing.T) {
	for _, err := range []error{io.EOF, &sftp.StatusError{Code: 6}, &sftp.StatusError{Code: 7}} {
		if !errors.Is(MutationError(err), ErrMutationOutcomeUnknown) {
			t.Fatalf("lost reply became a known rejection: %v", err)
		}
	}
	for _, err := range []error{os.ErrPermission, &sftp.StatusError{Code: 3}, os.ErrNotExist} {
		if errors.Is(MutationError(err), ErrMutationOutcomeUnknown) {
			t.Fatalf("explicit rejection lost: %v", err)
		}
	}
}
