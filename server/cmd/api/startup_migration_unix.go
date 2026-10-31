//go:build linux || darwin || freebsd

package main

import (
	"os"

	"golang.org/x/sys/unix"
)

func migrationAvailableBytes(path string) (uint64, error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return 0, err
	}
	return uint64(stat.Bavail) * uint64(stat.Bsize), nil
}

func syncMigrationDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func replaceMigrationFile(source, destination string) error { return os.Rename(source, destination) }
