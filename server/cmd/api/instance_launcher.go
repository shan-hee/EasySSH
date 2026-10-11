package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/easyssh/server/internal/infra/config"
	"github.com/easyssh/shared/instanceactivation"
)

func runInstanceLauncher(cfg *config.Config) (bool, error) {
	if !instanceLauncherSupported() || instanceactivation.FromEnvironment() != nil || cfg.Database.Driver != "sqlite" || os.Getenv("EASYSSH_INSTANCE_LAUNCHER") == "off" {
		return false, nil
	}
	// Preserve existing startup for in-memory/URI databases and external managers.
	if strings.HasPrefix(cfg.Database.DSN, "file:") || strings.ContainsAny(cfg.Database.DSN, "?\x00") || cfg.Database.DSN == ":memory:" {
		return false, nil
	}
	dsn, err := filepath.Abs(cfg.Database.DSN)
	if err != nil {
		return true, err
	}
	directory := os.Getenv("EASYSSH_INSTANCE_STATE_DIR")
	if directory == "" {
		directory = ".easyssh-runtime"
	}
	directory, err = filepath.Abs(directory)
	if err != nil {
		return true, err
	}
	backupDir := os.Getenv("EASYSSH_BACKUP_DIR")
	if backupDir == "" {
		backupDir = filepath.Join(filepath.Dir(filepath.Dir(dsn)), "backups")
	}
	backupDir, err = filepath.Abs(backupDir)
	if err != nil {
		return true, err
	}
	if err = os.MkdirAll(backupDir, 0700); err != nil {
		return true, err
	}
	backupDir, err = filepath.EvalSymlinks(backupDir)
	if err != nil {
		return true, err
	}
	return true, instanceactivation.Run(directory, instanceactivation.Target{DSN: dsn, Directory: filepath.Dir(dsn)}, cfg.Server.EncryptionKey, backupDir)
}
