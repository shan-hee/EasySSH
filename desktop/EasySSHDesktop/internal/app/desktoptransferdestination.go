package app

import (
	"context"
	"errors"
	"os"
	"path"

	"github.com/pkg/sftp"
)

func desktopRelayDestination(ctx context.Context, client *sftp.Client, directory, name string, limit int) (string, error) {
	info, err := client.Lstat(directory)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("relay target must be an existing directory")
	}
	for suffix := 1; suffix <= limit; suffix++ {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		candidate := name
		if suffix > 1 {
			candidate = desktopTransferSuffixedName(name, suffix)
		}
		if len(candidate) > 255 {
			return "", errors.New("relay target name is too long")
		}
		candidate = path.Join(directory, candidate)
		if _, err := client.Lstat(candidate); os.IsNotExist(err) {
			return candidate, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", errors.New("relay destination conflict limit exceeded")
}
