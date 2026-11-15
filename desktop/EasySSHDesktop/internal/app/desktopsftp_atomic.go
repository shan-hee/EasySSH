package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"

	"github.com/easyssh/shared/sftputil"
	"github.com/google/uuid"
	"github.com/pkg/sftp"
)

var errDesktopSFTPCommitUnknown = errors.New("remote replacement outcome unknown")

func writeDesktopSFTPAtomic(ctx context.Context, client *sftp.Client, target string, newMode os.FileMode, write func(*sftp.File) error) (DesktopSFTPFileInfo, error) {
	return writeDesktopSFTPCommit(ctx, client, target, newMode, true, write)
}

func writeDesktopSFTPCommit(ctx context.Context, client *sftp.Client, target string, newMode os.FileMode, replace bool, write func(*sftp.File) error) (DesktopSFTPFileInfo, error) {
	snapshot, err := sftputil.WriteAtomic(ctx, client, target, sftputil.AtomicWrite{Mode: newMode, Replace: replace}, write)
	if errors.Is(err, sftputil.ErrMutationOutcomeUnknown) {
		return DesktopSFTPFileInfo{}, errors.Join(errDesktopSFTPCommitUnknown, err)
	}
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	info := desktopSFTPFileInfoFromFileInfo(target, snapshot, "")
	info.Name = path.Base(target)
	return info, nil
}

// A changing source must not silently produce a valid-looking short file.
// Size/mtime checks are available in SFTP v3, not an immutable snapshot or CAS.
func copyDesktopSFTPExact(writer io.Writer, source *sftp.File, expected os.FileInfo) (int64, error) {
	if expected == nil || !expected.Mode().IsRegular() || expected.Size() < 0 {
		return 0, errors.New("source is not a regular file")
	}
	before, err := source.Stat()
	if err != nil {
		return 0, err
	}
	if !sftputil.SameFile(expected, before) {
		return 0, errors.New("source changed before transfer")
	}
	copied, err := io.CopyN(writer, source, expected.Size())
	if err != nil {
		return copied, err
	}
	var extra [1]byte
	if n, err := source.Read(extra[:]); n != 0 || err != io.EOF {
		return copied, errors.New("source length changed during transfer")
	}
	after, err := source.Stat()
	if err != nil {
		return copied, err
	}
	if !sftputil.SameFile(before, after) {
		return copied, errors.New("source changed during transfer")
	}
	return copied, nil
}

func writeDesktopLocalAtomic(ctx context.Context, target string, write func(*os.File) error) (resultErr error) {
	save, err := prepareDesktopFileSave(target)
	if err != nil {
		return err
	}
	defer save.root.Close()
	temporary := ".easyssh-download-" + uuid.NewString()
	file, err := save.root.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer func() {
		_ = file.Close()
		if err := save.root.Remove(temporary); err != nil && !errors.Is(err, os.ErrNotExist) {
			resultErr = errors.Join(resultErr, fmt.Errorf("local temporary file cleanup failed: %w", err))
		}
	}()
	if err = write(file); err != nil {
		return err
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return save.commit(ctx, temporary)
}
