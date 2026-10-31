//go:build !linux && !darwin && !freebsd && !windows

package main

import (
	"errors"
	"os"
)

func migrationAvailableBytes(string) (uint64, error) {
	return 0, errors.New("automatic migration disk preflight is unsupported on this operating system")
}
func syncMigrationDirectory(string) error                   { return nil }
func replaceMigrationFile(source, destination string) error { return os.Rename(source, destination) }
