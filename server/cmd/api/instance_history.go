package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/easyssh/server/internal/infra/config"
	"github.com/easyssh/shared/dbmigration"
	"github.com/easyssh/shared/instanceactivation"
	"github.com/easyssh/shared/instancebackup"
	"gorm.io/gorm"
)

func newInstanceHistory(cfg *config.Config, database *gorm.DB, freeze func(func() error) error) (*instancebackup.History, error) {
	dataDir, err := filepath.Abs(maintenanceDataDir(cfg))
	if err != nil {
		return nil, err
	}
	directory := os.Getenv("EASYSSH_BACKUP_DIR")
	if directory == "" {
		directory = filepath.Join(filepath.Dir(dataDir), "backups")
	}
	directory, err = filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	directory, err = filepath.EvalSymlinks(directory)
	if err != nil {
		return nil, err
	}
	dataDir, err = filepath.EvalSymlinks(dataDir)
	if err != nil {
		return nil, err
	}
	// A launcher-selected restored child keeps its original catalog. Snapshot
	// output is outside that child's data; arbitrary overlapping roots stay invalid.
	managedRestore := instanceactivation.FromEnvironment() != nil && withinPath(filepath.Join(directory, "restored"), dataDir) && dataDir != filepath.Join(directory, "restored")
	if withinPath(dataDir, directory) || (withinPath(directory, dataDir) && !managedRestore) {
		return nil, errors.New("backup storage must be separate from the instance data directory")
	}
	return instancebackup.NewHistory(instancebackup.HistoryOptions{
		AppVersion: readAppVersion(), Driver: cfg.Database.Driver, SchemaVersion: dbmigration.Latest,
		Directory: directory,
		Snapshot: func(ctx context.Context, output, password string) error {
			return createInstanceArchive(ctx, cfg, database, output, password, freeze)
		},
		Validate: func(ctx context.Context, stage string, m instancebackup.Manifest) error {
			if m.Profile != "server" || m.Driver != cfg.Database.Driver {
				return errors.New("backup profile/database type does not match this instance")
			}
			if m.SchemaVersion < 1 || m.SchemaVersion > dbmigration.Latest {
				return errors.New("unsupported database migration version")
			}
			return instancebackup.CheckApplicationVersion(m.AppVersion, readAppVersion())
		},
		Restore: func(ctx context.Context, stage string, m instancebackup.Manifest, id string) (string, error) {
			destination := filepath.Join(directory, "restored", id+"-"+time.Now().UTC().Format("20060102T150405.000000000"))
			if err := restoreInstance(ctx, stage, destination, os.Getenv("EASYSSH_RESTORE_DSN"), m); err != nil {
				return "", err
			}
			return destination, nil
		},
	})
}
