package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/easyssh/server/internal/infra/config"
	"github.com/easyssh/shared/dbmigration"
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
	if withinPath(dataDir, directory) || withinPath(directory, dataDir) {
		return nil, errors.New("backup storage must be separate from the instance data directory")
	}
	return instancebackup.NewHistory(instancebackup.HistoryOptions{
		AppVersion: readAppVersion(), Driver: cfg.Database.Driver, SchemaVersion: dbmigration.Latest,
		Directory: directory,
		Snapshot: func(ctx context.Context, output, password string) error {
			return createInstanceArchive(ctx, cfg, database, output, password, func(capture func() error) error {
				return freeze(func() error {
					// A custom transfer directory must not contain the backup catalog.
					var root string
					if err := database.WithContext(ctx).Raw("SELECT COALESCE(transfer_storage_path,'') FROM system_config LIMIT 1").Scan(&root).Error; err != nil {
						return err
					}
					if root != "" {
						absolute, err := filepath.Abs(root)
						if err != nil {
							return err
						}
						if resolved, resolveErr := filepath.EvalSymlinks(absolute); resolveErr == nil {
							absolute = resolved
						} else if !os.IsNotExist(resolveErr) {
							return resolveErr
						}
						if withinPath(absolute, directory) || withinPath(directory, absolute) {
							return errors.New("backup storage must be separate from transfer storage")
						}
					}
					return capture()
				})
			})
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
