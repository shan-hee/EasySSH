package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/easyssh/shared/instanceactivation"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/zalando/go-keyring"
)

var desktopInstanceStarted = make(chan struct{})

func waitForDesktopActivation(ctx context.Context) bool {
	if instanceactivation.FromEnvironment() == nil {
		return true
	}
	select {
	case <-desktopInstanceStarted:
		return true
	case <-ctx.Done():
		return false
	}
}

func desktopBackupDirectory() string {
	if value := os.Getenv("EASYSSH_DESKTOP_BACKUP_DIR"); value != "" {
		return value
	}
	return filepath.Join(filepath.Dir(desktopDataDir()), "backups")
}

func runDesktopInstanceLauncher() (bool, error) {
	if instanceactivation.FromEnvironment() != nil || os.Getenv("EASYSSH_INSTANCE_LAUNCHER") == "off" {
		return false, nil
	}
	root := desktopDataDir()
	directory := os.Getenv("EASYSSH_INSTANCE_STATE_DIR")
	if directory == "" {
		directory = filepath.Join(filepath.Dir(root), ".easyssh-desktop-runtime")
	}
	directory, err := filepath.Abs(directory)
	if err != nil {
		return true, err
	}
	backups, err := filepath.Abs(desktopBackupDirectory())
	if err != nil {
		return true, err
	}
	if err = os.MkdirAll(backups, 0700); err != nil {
		return true, err
	}
	backups, err = filepath.EvalSymlinks(backups)
	if err != nil {
		return true, err
	}
	return true, instanceactivation.RunWithOptions(directory, instanceactivation.Target{
		DSN: filepath.Join(root, "easyssh-desktop.sqlite"), Directory: root,
	}, "", backups, instanceactivation.Options{
		DatabaseName: "easyssh-desktop.sqlite",
		LogFile:      true, AllowDetachedHelpers: true,
		// The child opens the OS vault and validates every stored credential
		// before Ready. No desktop key is written to launcher files or env.
		Key: func(instanceactivation.Target) (string, error) { return "", nil },
		Environment: func(target instanceactivation.Target, _ string, backups string) map[string]string {
			return map[string]string{"EASYSSH_DESKTOP_DATA_DIR": target.Directory, "EASYSSH_DESKTOP_BACKUP_DIR": backups}
		},
	})
}

// Registered last: all Wails services must initialize before Ready.
type DesktopActivationService struct{ backup *DesktopBackupService }

// Keep business UI and its background work gated until the launcher commits.
// The window runtime must be allowed to load so it can confirm readiness first.
func (s *DesktopActivationService) WaitForStartup(ctx context.Context) error {
	if !waitForDesktopActivation(ctx) {
		return ctx.Err()
	}
	return nil
}

func (s *DesktopActivationService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	client := instanceactivation.FromEnvironment()
	if client == nil {
		return nil
	}
	db, err := s.backup.database()
	if err != nil {
		return err
	}
	account, err := desktopCredentialAccount(desktopDataDir())
	if err != nil {
		return err
	}
	key, err := keyring.Get("EasySSH Desktop", account)
	if err != nil {
		return err
	}
	if err = verifyDesktopSnapshotCredentials(ctx, db, desktopDataDir(), key); err != nil {
		return err
	}
	return client.Ready(ctx)
}

func (s *DesktopBackupService) ActivateInstanceBackup(id, directory string, confirm bool) (instanceactivation.Operation, error) {
	if !confirm {
		return instanceactivation.Operation{}, errors.New("activation confirmation is required")
	}
	return s.activateInstance(instanceactivation.Request{RecordID: id, Directory: directory})
}

func (s *DesktopBackupService) GetInstanceActivation() (instanceactivation.Info, error) {
	return instanceactivation.FromEnvironment().Info(context.Background())
}

func (s *DesktopBackupService) RollbackInstance(confirm bool) (instanceactivation.Operation, error) {
	if !confirm {
		return instanceactivation.Operation{}, errors.New("rollback confirmation is required")
	}
	return s.activateInstance(instanceactivation.Request{Rollback: true})
}

func (s *DesktopBackupService) activateInstance(request instanceactivation.Request) (instanceactivation.Operation, error) {
	client := instanceactivation.FromEnvironment()
	if client == nil {
		return instanceactivation.Operation{}, errors.New("instance launcher is unavailable")
	}
	h, err := s.instanceHistory()
	if err != nil {
		return instanceactivation.Operation{}, err
	}
	record, release, err := h.ReserveActivation(request.RecordID)
	if err != nil {
		return instanceactivation.Operation{}, err
	}
	if !request.Rollback && (request.Directory == "" || record.RestoredTo != request.Directory) {
		release()
		return instanceactivation.Operation{}, errors.New("restore selection changed; refresh the backup list")
	}
	op, err := client.Activate(context.Background(), request)
	if err == nil {
		return op, nil
	}
	// A lost response may still have committed a pending switch. Retain the
	// reservation until exit unless the launcher confirms it did not accept.
	info, infoErr := client.Info(context.Background())
	if infoErr == nil {
		if info.Operation != nil && info.Operation.Status == "switching" {
			return *info.Operation, nil
		}
		release()
	}
	return op, err
}

func managedDesktopRestore(directory, dataDir string) bool {
	if instanceactivation.FromEnvironment() == nil {
		return false
	}
	root, err := filepath.EvalSymlinks(filepath.Join(directory, "restored"))
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(root, dataDir)
	return err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}
