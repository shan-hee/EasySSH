package sftputil

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"

	"github.com/google/uuid"
	"github.com/pkg/sftp"
)

type AtomicWrite struct {
	// Mode applies to a new file. A replaced file keeps its own permissions.
	Mode os.FileMode
	// Replace allows an existing regular file at the target.
	Replace bool
	// Check runs after the content is complete and before the commit.
	Check func() error
}

// WriteAtomic is the one commit boundary for uploads, text edits and transfers
// on both hosts. The content goes to a private temporary file beside the target
// and reaches it in one rename or link. No failure path removes or truncates
// the target, and the commit is never retried.
func WriteAtomic(ctx context.Context, client *sftp.Client, target string, options AtomicWrite, write func(*sftp.File) error) (info os.FileInfo, resultErr error) {
	original, err := client.Lstat(target)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	exists := err == nil
	mode := options.Mode
	if exists {
		if !original.Mode().IsRegular() {
			return nil, errors.New("target is not a regular file")
		}
		if !options.Replace {
			return nil, errors.New("transfer target already exists")
		}
		mode = original.Mode()
	}
	temporary := path.Join(path.Dir(target), ".easyssh-upload-"+uuid.NewString())
	file, err := client.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return nil, err
	}
	closed, renamed := false, false
	defer func() {
		if !closed {
			_ = file.Close()
		}
		if !renamed {
			if err := client.Remove(temporary); err != nil && !os.IsNotExist(err) && resultErr != nil {
				resultErr = errors.Join(resultErr, fmt.Errorf("temporary file cleanup failed (%s): %w", temporary, err))
			}
		}
	}()
	// No content is sent before the temporary file has private permissions.
	if err = file.Chmod(0600); err != nil {
		return nil, err
	}
	if err = write(file); err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if _, supported := client.HasExtension("fsync@openssh.com"); supported {
		if err = file.Sync(); err != nil {
			return nil, err
		}
	}
	if err = file.Chmod(mode.Perm()); err != nil {
		return nil, err
	}
	snapshot, err := file.Stat()
	if err != nil {
		return nil, err
	}
	closed = true
	if err = file.Close(); err != nil {
		return nil, err
	}
	if options.Check != nil {
		if err = options.Check(); err != nil {
			return nil, err
		}
	}
	current, err := client.Lstat(target)
	switch {
	case err != nil && !os.IsNotExist(err):
		return nil, err
	case exists != (err == nil), exists && !SameFile(original, current):
		return nil, errors.New("target changed during transfer")
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	_, posixRename := client.HasExtension("posix-rename@openssh.com")
	_, hardLink := client.HasExtension("hardlink@openssh.com")
	switch {
	case options.Replace && posixRename:
		err = client.PosixRename(temporary, target)
		renamed = err == nil
	case !options.Replace && hardLink:
		// A link refuses an existing target atomically. The target is in place
		// once it succeeds, so removing the temporary name cannot fail the write.
		err = client.Link(temporary, target)
	default:
		// Standard rename fails when the target already exists; never emulate
		// replacement with remove+rename because it destroys the old contents.
		err = client.Rename(temporary, target)
		renamed = err == nil
	}
	if err != nil {
		return nil, MutationError(err)
	}
	return snapshot, nil
}

// SameFile compares what SFTP v3 exposes: size and mtime, not an immutable
// snapshot.
func SameFile(before, after os.FileInfo) bool {
	return before != nil && after != nil && before.Mode().IsRegular() && after.Mode().IsRegular() &&
		before.Mode() == after.Mode() && before.Size() == after.Size() && before.ModTime().Equal(after.ModTime())
}
