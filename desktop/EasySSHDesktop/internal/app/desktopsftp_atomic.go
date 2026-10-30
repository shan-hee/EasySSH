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

// Uploads, text edits and direct transfers share one commit boundary. No
// failure path removes/truncates the destination or retries the rename.
func writeDesktopSFTPAtomic(ctx context.Context, client *sftp.Client, target string, newMode os.FileMode, write func(*sftp.File) error) (info DesktopSFTPFileInfo, resultErr error) {
	return writeDesktopSFTPCommit(ctx, client, target, newMode, true, write)
}

func writeDesktopSFTPCommit(ctx context.Context, client *sftp.Client, target string, newMode os.FileMode, replace bool, write func(*sftp.File) error) (info DesktopSFTPFileInfo, resultErr error) {
	original, err := client.Lstat(target)
	if err != nil && !os.IsNotExist(err) {
		return info, err
	}
	if err == nil && !original.Mode().IsRegular() {
		return info, errors.New("target is not a regular file")
	}
	if original != nil && !replace {
		return info, errors.New("transfer target already exists")
	}
	if original != nil {
		newMode = original.Mode().Perm()
	}
	temporary := path.Join(path.Dir(target), ".easyssh-upload-"+uuid.NewString())
	file, err := client.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return info, err
	}
	closed, committed := false, false
	defer func() {
		if !closed {
			_ = file.Close()
		}
		if !committed {
			if err := client.Remove(temporary); err != nil && !os.IsNotExist(err) {
				resultErr = errors.Join(resultErr, fmt.Errorf("temporary file cleanup failed (%s): %w", temporary, err))
			}
		}
	}()
	// No content is sent before the temporary file has private permissions.
	if err = file.Chmod(0600); err != nil {
		return info, err
	}
	if err = write(file); err != nil {
		return info, err
	}
	if ctx.Err() != nil {
		return info, ctx.Err()
	}
	if _, ok := client.HasExtension("fsync@openssh.com"); ok {
		if err = file.Sync(); err != nil {
			return info, err
		}
	}
	if err = file.Chmod(newMode.Perm()); err != nil {
		return info, err
	}
	snapshot, err := file.Stat()
	if err != nil {
		return info, err
	}
	closed = true
	if err = file.Close(); err != nil {
		return info, err
	}
	current, err := client.Lstat(target)
	if original == nil {
		if !os.IsNotExist(err) {
			return info, errors.New("target changed during transfer")
		}
	} else if err != nil || !sameDesktopSFTPFile(original, current) {
		return info, errors.New("target changed during transfer")
	}
	if ctx.Err() != nil {
		return info, ctx.Err()
	}
	if _, supported := client.HasExtension("posix-rename@openssh.com"); supported && replace {
		err = client.PosixRename(temporary, target)
	} else {
		// Standard rename fails when the target already exists; never emulate
		// replacement with remove+rename because it destroys the old contents.
		err = client.Rename(temporary, target)
	}
	if err != nil {
		if sftputil.DefiniteStatus(err) {
			return info, err
		}
		return info, errors.Join(errDesktopSFTPCommitUnknown, err)
	}
	committed = true
	info = desktopSFTPFileInfoFromFileInfo(target, snapshot, "")
	info.Name = path.Base(target)
	return info, nil
}

func sameDesktopSFTPFile(before, after os.FileInfo) bool {
	return before != nil && after != nil && before.Mode().IsRegular() && after.Mode().IsRegular() &&
		before.Mode() == after.Mode() && before.Size() == after.Size() && before.ModTime().Equal(after.ModTime())
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
	if !sameDesktopSFTPFile(expected, before) {
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
	if !sameDesktopSFTPFile(before, after) {
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
