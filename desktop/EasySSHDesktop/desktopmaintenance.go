package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/easyssh/shared/dbmigration"
	"github.com/easyssh/shared/instancebackup"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/zalando/go-keyring"
)

func runDesktopMaintenance(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: EasySSHDesktop maintenance backup|inspect|restore|migrate [options]")
	}
	flags := flag.NewFlagSet("maintenance "+args[0], flag.ContinueOnError)
	file := flags.String("file", "", "encrypted instance archive")
	passwordFile := flags.String("password-file", "", "backup password file")
	into := flags.String("into", "", "new data directory for restoration")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Hour)
	defer cancel()
	if args[0] == "restore" || args[0] == "inspect" {
		password, err := instancebackup.PasswordFile(*passwordFile)
		if err != nil {
			return err
		}
		stage, err := os.MkdirTemp("", "easyssh-desktop-restore-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(stage)
		manifest, err := instancebackup.Unpack(ctx, *file, stage, password)
		if err != nil {
			return err
		}
		if args[0] == "inspect" {
			return json.NewEncoder(os.Stdout).Encode(manifest)
		}
		lock, err := instancebackup.Lock(desktopDataDir())
		if err != nil {
			return err
		}
		defer lock.Close()
		return restoreDesktopInstance(ctx, stage, *into, manifest)
	}
	if args[0] != "backup" && args[0] != "migrate" {
		return errors.New("unknown maintenance action")
	}
	root := desktopDataDir()
	lock, err := instancebackup.Lock(root)
	if err != nil {
		return err
	}
	defer lock.Close()
	database, err := sql.Open("sqlite", filepath.Join(root, "easyssh-desktop.sqlite"))
	if err != nil {
		return err
	}
	defer database.Close()
	if args[0] == "migrate" {
		version, err := dbmigration.Version(ctx, database, "sqlite")
		if err != nil {
			return err
		}
		if version == 0 || version == dbmigration.Latest {
			return dbmigration.Up(ctx, database, "desktop", "sqlite")
		}
	}
	password, err := instancebackup.PasswordFile(*passwordFile)
	if err != nil {
		return err
	}
	if *file == "" {
		return errors.New("--file is required")
	}
	output, err := filepath.Abs(*file)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(root, output)
	if err != nil {
		return err
	}
	if relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return errors.New("backup output must be outside the data directory")
	}
	if err := createDesktopInstanceArchive(ctx, database, output, password); err != nil {
		return err
	}
	fmt.Fprintln(os.Stdout, "Desktop instance backup created:", output)
	if args[0] == "migrate" {
		return dbmigration.Up(ctx, database, "desktop", "sqlite")
	}
	return nil
}

func createDesktopInstanceArchive(ctx context.Context, database *sql.DB, output, password string) error {
	root := desktopDataDir()
	version, err := dbmigration.Version(ctx, database, "sqlite")
	if err != nil {
		return err
	}
	if version == 0 || version > dbmigration.Latest {
		return errors.New("database migration version mismatch")
	}
	if err = instancebackup.CheckSQLite(ctx, database); err != nil {
		return err
	}
	stage, err := os.MkdirTemp("", "easyssh-desktop-backup-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	if err := func() error {
		desktopInstanceFilesMu.Lock()
		defer desktopInstanceFilesMu.Unlock()
		desktopLogger.mu.Lock()
		defer desktopLogger.mu.Unlock()
		if err = instancebackup.SnapshotSQLite(ctx, database, filepath.Join(stage, "database.dump")); err != nil {
			return err
		}
		if err = instancebackup.CopyTree(ctx, root, filepath.Join(stage, "data"), func(name string) bool {
			return strings.Contains(name, ".stage-") || name == ".easyssh-instance.lock" || name == "easyssh-desktop.sqlite" || name == "easyssh-desktop.sqlite-wal" || name == "easyssh-desktop.sqlite-shm" || name == "easyssh-desktop.sqlite-journal"
		}); err != nil {
			return err
		}
		return nil
	}(); err != nil {
		return err
	}
	key, err := keyring.Get("EasySSH Desktop", "credential-encryption-v1")
	if err != nil {
		return err
	}
	if version == dbmigration.Latest {
		if err = verifyDesktopSnapshotCredentials(ctx, database, root, key); err != nil {
			return err
		}
	}
	if err = os.WriteFile(filepath.Join(stage, "root.key"), []byte(key), 0600); err != nil {
		return err
	}
	var databaseVersion string
	if err = database.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&databaseVersion); err != nil {
		return err
	}
	if err = instancebackup.Pack(ctx, stage, output, password, instancebackup.Manifest{Profile: "desktop", AppVersion: desktopBundledVersion, Driver: "sqlite", DatabaseVersion: databaseVersion, SchemaVersion: version, OriginalDataDir: root}); err != nil {
		return err
	}
	return nil
}

func restoreDesktopInstance(ctx context.Context, stage, into string, manifest instancebackup.Manifest) error {
	if manifest.Profile != "desktop" || manifest.Driver != "sqlite" {
		return errors.New("not a desktop instance backup; use JSON application migration between desktop and server")
	}
	if err := instancebackup.CheckApplicationVersion(manifest.AppVersion, desktopBundledVersion); err != nil {
		return err
	}
	if manifest.SchemaVersion <= 0 || manifest.SchemaVersion > dbmigration.Latest {
		return errors.New("unsupported database migration version")
	}
	if into == "" {
		return errors.New("--into must name a new data directory")
	}
	destination, err := filepath.Abs(into)
	if err != nil {
		return err
	}
	if _, err = os.Lstat(destination); !os.IsNotExist(err) {
		return errors.New("restore destination must not exist")
	}
	encoded, err := os.ReadFile(filepath.Join(stage, "root.key"))
	if err != nil {
		return err
	}
	key := strings.TrimSpace(string(encoded))
	raw, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(raw) != 32 {
		return errors.New("invalid root key in instance backup")
	}
	existing, err := keyring.Get("EasySSH Desktop", "credential-encryption-v1")
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return err
	}
	if err == nil && existing != key {
		return errors.New("OS credential vault belongs to a different instance; restore in a separate OS account to preserve both encryption keys")
	}
	data := filepath.Join(stage, "data")
	if err = os.MkdirAll(data, 0700); err != nil {
		return err
	}
	if err = instancebackup.CopyFile(ctx, filepath.Join(stage, "database.dump"), filepath.Join(data, "easyssh-desktop.sqlite")); err != nil {
		return err
	}
	database, err := sql.Open("sqlite", filepath.Join(data, "easyssh-desktop.sqlite"))
	if err != nil {
		return err
	}
	defer database.Close()
	version, err := dbmigration.Version(ctx, database, "sqlite")
	if err != nil {
		return err
	}
	if version != manifest.SchemaVersion {
		return errors.New("manifest schema version does not match database")
	}
	if err = dbmigration.Up(ctx, database, "desktop", "sqlite"); err != nil {
		return err
	}
	if err = verifyDesktopSnapshotCredentials(ctx, database, data, key); err != nil {
		return err
	}
	if _, err = database.ExecContext(ctx, "UPDATE desktop_sync_state SET token='',enabled=0,revision=revision+1"); err != nil {
		return err
	}
	if err = instancebackup.CheckSQLite(ctx, database); err != nil {
		return err
	}
	if _, err = database.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		return err
	}
	if err = database.Close(); err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	publish, err := os.MkdirTemp(filepath.Dir(destination), ".easyssh-desktop-restored-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(publish)
	if err = instancebackup.CopyTree(ctx, data, publish, nil); err != nil {
		return err
	}
	// Install the original key only when the vault is empty; the original profile stays untouched.
	if existing == "" {
		if err = keyring.Set("EasySSH Desktop", "credential-encryption-v1", key); err != nil {
			return err
		}
	}
	if err = os.Rename(publish, destination); err != nil {
		return err
	}
	fmt.Fprintln(os.Stdout, "Restored desktop data:", destination, "; start with EASYSSH_DESKTOP_DATA_DIR set to this directory. Reauthorize device sync.")
	return nil
}

func verifyDesktopSnapshotCredentials(ctx context.Context, db *sql.DB, dataDir, key string) error {
	encryptor, err := crypto.NewEncryptor(key)
	if err != nil {
		return err
	}
	for _, spec := range []struct{ table, id, column, aadColumn string }{
		{"desktop_servers", "id", "password", "password"},
		{"desktop_ssh_keys", "fingerprint", "private_key", "private_key"},
		{"desktop_ai_config", "id", "custom_api_key", "custom_api_key"},
		{"desktop_sync_state", "id", "token", "token"},
		{"desktop_sync_objects", "space_id || ':' || id", "ciphertext", "value"},
	} {
		rows, err := db.QueryContext(ctx, "SELECT "+spec.id+","+spec.column+" FROM "+spec.table)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id, value string
			if err = rows.Scan(&id, &value); err != nil {
				rows.Close()
				return err
			}
			if _, err = encryptor.DecryptWithAAD(value, crypto.SecretAAD(spec.table, id, spec.aadColumn)); err != nil {
				rows.Close()
				return fmt.Errorf("stored %s credentials cannot be decrypted", spec.table)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
	}
	content, err := os.ReadFile(filepath.Join(dataDir, "preferences.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var preferences map[string]string
	if err = json.Unmarshal(content, &preferences); err != nil {
		return err
	}
	if raw := preferences[desktopProxyPreferenceKey]; raw != "" {
		var proxy desktopProxyConfig
		if err = json.Unmarshal([]byte(raw), &proxy); err != nil {
			return err
		}
		if _, err = encryptor.DecryptWithAAD(proxy.Password, crypto.SecretAAD("desktop_preferences", desktopProxyPreferenceKey, "password")); err != nil {
			return errors.New("proxy credentials cannot be decrypted")
		}
	}
	return nil
}
