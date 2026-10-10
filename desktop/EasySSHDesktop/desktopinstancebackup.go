package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/dbmigration"
	"github.com/easyssh/shared/instancebackup"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var desktopInstanceFilesMu sync.RWMutex

type DesktopInstanceBackupList struct {
	Items            []instancebackup.Record `json:"items"`
	RestoreAvailable bool                    `json:"restore_available"`
	MaxUploadBytes   int64                   `json:"max_upload_bytes"`
}

func (s *DesktopBackupService) instanceHistory() (*instancebackup.History, error) {
	s.historyMu.Lock()
	defer s.historyMu.Unlock()
	if s.history != nil {
		return s.history, nil
	}
	database, err := s.database()
	if err != nil {
		return nil, err
	}
	directory := os.Getenv("EASYSSH_DESKTOP_BACKUP_DIR")
	if directory == "" {
		directory = filepath.Join(filepath.Dir(desktopDataDir()), "backups")
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
	dataDir, err := filepath.EvalSymlinks(desktopDataDir())
	if err != nil {
		return nil, err
	}
	for _, pair := range [][2]string{{dataDir, directory}, {directory, dataDir}} {
		rel, err := filepath.Rel(pair[0], pair[1])
		if err != nil {
			return nil, err
		}
		if rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return nil, errors.New("backup storage must be separate from desktop data")
		}
	}
	s.history, err = instancebackup.NewHistory(instancebackup.HistoryOptions{
		AppVersion: desktopBundledVersion, Driver: "sqlite", SchemaVersion: dbmigration.Latest,
		Directory: directory,
		Snapshot: func(ctx context.Context, output, password string) error {
			return createDesktopInstanceArchive(ctx, database, output, password)
		},
		Validate: func(ctx context.Context, stage string, m instancebackup.Manifest) error {
			if m.Profile != "desktop" || m.Driver != "sqlite" {
				return errors.New("not a desktop instance backup")
			}
			if m.SchemaVersion < 1 || m.SchemaVersion > dbmigration.Latest {
				return errors.New("unsupported database migration version")
			}
			return instancebackup.CheckApplicationVersion(m.AppVersion, desktopBundledVersion)
		},
		Restore: func(ctx context.Context, stage string, m instancebackup.Manifest, id string) (string, error) {
			destination := filepath.Join(directory, "restored", id+"-"+time.Now().UTC().Format("20060102T150405.000000000"))
			if err := restoreDesktopInstance(ctx, stage, destination, m); err != nil {
				return "", err
			}
			return destination, nil
		},
	})
	return s.history, err
}

func (s *DesktopBackupService) ListInstanceBackups() (DesktopInstanceBackupList, error) {
	h, err := s.instanceHistory()
	if err != nil {
		return DesktopInstanceBackupList{}, err
	}
	items, err := h.List()
	return DesktopInstanceBackupList{Items: items, RestoreAvailable: true, MaxUploadBytes: instancebackup.MaxUploadBytes}, err
}
func (s *DesktopBackupService) CreateInstanceBackup(password string) (instancebackup.Record, error) {
	h, err := s.instanceHistory()
	if err != nil {
		return instancebackup.Record{}, err
	}
	return h.Create(password)
}
func (s *DesktopBackupService) InspectInstanceBackup(id, password string) (instancebackup.Record, error) {
	h, err := s.instanceHistory()
	if err != nil {
		return instancebackup.Record{}, err
	}
	return h.Inspect(id, password, false)
}
func (s *DesktopBackupService) RestoreInstanceBackup(id, password string, confirm bool) (instancebackup.Record, error) {
	if !confirm {
		return instancebackup.Record{}, errors.New("restore confirmation is required")
	}
	h, err := s.instanceHistory()
	if err != nil {
		return instancebackup.Record{}, err
	}
	return h.Inspect(id, password, true)
}
func (s *DesktopBackupService) DeleteInstanceBackup(id string) error {
	h, err := s.instanceHistory()
	if err != nil {
		return err
	}
	return h.Delete(id)
}
func (s *DesktopBackupService) UploadInstanceBackup() (*instancebackup.Record, error) {
	app := application.Get()
	if app == nil {
		return nil, errors.New("desktop application is unavailable")
	}
	path, err := app.Dialog.OpenFile().AddFilter("EasySSH backup", "*.age").PromptForSingleSelection()
	if err != nil || path == "" {
		return nil, err
	}
	if !strings.HasSuffix(strings.ToLower(path), ".easyssh.age") {
		return nil, errors.New("select an .easyssh.age backup archive")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > instancebackup.MaxUploadBytes {
		return nil, errors.New("backup file must be a regular file smaller than 16 GiB")
	}
	h, err := s.instanceHistory()
	if err != nil {
		return nil, err
	}
	record, err := h.Upload(file)
	return &record, err
}
func (s *DesktopBackupService) DownloadInstanceBackup(id string) error {
	app := application.Get()
	if app == nil {
		return errors.New("desktop application is unavailable")
	}
	h, err := s.instanceHistory()
	if err != nil {
		return err
	}
	file, record, release, err := h.Open(id)
	if err != nil {
		return err
	}
	defer release()
	defer file.Close()
	destination, err := app.Dialog.SaveFile().SetFilename(record.Name).AddFilter("EasySSH backup", "*.age").PromptForSingleSelection()
	if err != nil || destination == "" {
		return err
	}
	// Do not allow a save dialog to overwrite application data or another archive.
	for _, root := range []string{desktopDataDir(), h.Directory()} {
		absolute, err := filepath.Abs(destination)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, absolute)
		if err != nil {
			return err
		}
		if rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return errors.New("choose a location outside application data and backup storage")
		}
	}
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, file)
	if copyErr == nil {
		copyErr = out.Sync()
	}
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(destination)
		return copyErr
	}
	return closeErr
}
