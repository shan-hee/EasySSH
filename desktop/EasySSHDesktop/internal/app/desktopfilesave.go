package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

type desktopFileSave struct {
	root     *os.Root
	name     string
	original os.FileInfo
}

func prepareDesktopFileSave(selected string) (*desktopFileSave, error) {
	root, err := os.OpenRoot(filepath.Dir(selected))
	if err != nil {
		return nil, remoteError("local_destination_unavailable")
	}
	name := filepath.Base(selected)
	original, err := root.Lstat(name)
	if (err != nil && !errors.Is(err, os.ErrNotExist)) || (err == nil && !original.Mode().IsRegular()) {
		root.Close()
		return nil, remoteError("local_destination_not_regular")
	}
	return &desktopFileSave{root, name, original}, nil
}

func (save *desktopFileSave) commit(ctx context.Context, temporary string) error {
	current, err := save.root.Lstat(save.name)
	if save.original == nil {
		if !errors.Is(err, os.ErrNotExist) {
			return remoteError("local_destination_changed")
		}
	} else {
		if err != nil || !current.Mode().IsRegular() || !os.SameFile(current, save.original) || current.Size() != save.original.Size() || !current.ModTime().Equal(save.original.ModTime()) {
			return remoteError("local_destination_changed")
		}
	}
	if ctx.Err() != nil {
		return context.Cause(ctx)
	}
	if err = save.root.Rename(temporary, save.name); err != nil {
		return remoteError("local_commit_failed")
	}
	return nil
}

func sameDesktopUploadFile(file *os.File, snapshot os.FileInfo) bool {
	current, err := file.Stat()
	return err == nil && current.Mode().IsRegular() && os.SameFile(current, snapshot) && current.Size() == snapshot.Size() && current.ModTime().Equal(snapshot.ModTime())
}
