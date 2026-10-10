package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/easyssh/server/internal/api/rest"
	"github.com/easyssh/server/internal/infra/config"
	dbinfra "github.com/easyssh/server/internal/infra/db"
	"github.com/easyssh/shared/dbmigration"
	"github.com/easyssh/shared/instancebackup"
	crypto "github.com/easyssh/shared/secretcrypto"
	mysqlconfig "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
	"gorm.io/gorm"
)

func maintenanceDataDir(cfg *config.Config) string {
	if cfg.Database.Driver == "sqlite" {
		return filepath.Dir(sqliteDatabasePath(cfg.Database.DSN))
	}
	if value := os.Getenv("EASYSSH_DATA_DIR"); value != "" {
		return value
	}
	return "./data"
}
func sqliteDatabasePath(dsn string) string {
	value := strings.TrimPrefix(dsn, "file:")
	if index := strings.IndexByte(value, '?'); index >= 0 {
		value = value[:index]
	}
	return value
}

func runMaintenance(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: easyssh-api maintenance backup|inspect|restore|migrate [options]")
	}
	flags := flag.NewFlagSet("maintenance "+args[0], flag.ContinueOnError)
	file := flags.String("file", "", "encrypted .easyssh.age file")
	passwordFile := flags.String("password-file", "", "file containing the backup password")
	into := flags.String("into", "", "new data directory for restoration (must not exist)")
	targetEnv := flags.String("target-dsn-env", "EASYSSH_RESTORE_DSN", "environment variable containing an empty PostgreSQL/MySQL target database DSN")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected maintenance arguments")
	}
	if args[0] != "backup" && args[0] != "restore" && args[0] != "inspect" && args[0] != "migrate" {
		return errors.New("unknown maintenance action")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Hour)
	defer cancel()
	if args[0] == "restore" || args[0] == "inspect" {
		password, err := instancebackup.PasswordFile(*passwordFile)
		if err != nil {
			return err
		}
		stage, err := os.MkdirTemp("", "easyssh-restore-")
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
		return restoreInstance(ctx, stage, *into, os.Getenv(*targetEnv), manifest)
	}
	_ = godotenv.Load("../.env")
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	dataDir, err := filepath.Abs(maintenanceDataDir(cfg))
	if err != nil {
		return err
	}
	lock, err := instancebackup.Lock(dataDir)
	if err != nil {
		return err
	}
	defer lock.Close()
	// An advisory-lock connection is reserved in addition to normal database work.
	if cfg.Database.Driver != "sqlite" && cfg.Database.MaxOpenConns < 2 {
		cfg.Database.MaxOpenConns = 2
	}
	database, err := dbinfra.NewDB(&cfg.Database)
	if err != nil {
		return err
	}
	sqlDB, err := database.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	release, err := instancebackup.DatabaseLock(ctx, sqlDB, cfg.Database.Driver)
	if err != nil {
		return err
	}
	defer release()
	if args[0] == "migrate" {
		version, err := dbmigration.Version(ctx, sqlDB, cfg.Database.Driver)
		if err != nil {
			return err
		}
		if version == 0 || version == dbmigration.Latest {
			return dbmigration.Up(ctx, sqlDB, "server", cfg.Database.Driver)
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
	if withinPath(dataDir, output) {
		return errors.New("backup output must be outside the data directory")
	}
	if err = createInstanceArchive(ctx, cfg, database, output, password, func(capture func() error) error { return capture() }); err != nil {
		return err
	}
	fmt.Fprintln(os.Stdout, "Instance backup created:", output)
	if args[0] == "migrate" {
		return dbmigration.Up(ctx, sqlDB, "server", cfg.Database.Driver)
	}
	return nil
}

// createInstanceArchive is shared by the CLI and the managed backup worker.
func createInstanceArchive(ctx context.Context, cfg *config.Config, database *gorm.DB, output, password string, captureStorage func(func() error) error) error {
	sqlDB, err := database.DB()
	if err != nil {
		return err
	}
	dataDir, err := filepath.Abs(maintenanceDataDir(cfg))
	if err != nil {
		return err
	}
	version, err := dbmigration.Version(ctx, sqlDB, cfg.Database.Driver)
	if err != nil {
		return err
	}
	if version == 0 || version > dbmigration.Latest {
		return errors.New("backup requires the matching application/database version")
	}
	stage, err := os.MkdirTemp("", "easyssh-backup-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	manifest := instancebackup.Manifest{Profile: "server", AppVersion: readAppVersion(), Driver: cfg.Database.Driver, SchemaVersion: version, OriginalDataDir: dataDir}
	if err = captureStorage(func() error {
		encryptor, err := crypto.NewEncryptor(cfg.Server.EncryptionKey)
		if err != nil {
			return err
		}
		if version == dbmigration.Latest {
			if err = rest.NewBackupHandler(database, encryptor).VerifyStoredCredentials(ctx); err != nil {
				return err
			}
		}
		if err = nativeSnapshot(ctx, sqlDB, &cfg.Database, filepath.Join(stage, "database.dump")); err != nil {
			return err
		}
		manifest.DatabaseVersion, err = nativeDatabaseVersion(ctx, sqlDB, cfg.Database.Driver)
		if err != nil {
			return err
		}
		dbFile := filepath.Base(sqliteDatabasePath(cfg.Database.DSN))
		if err = instancebackup.CopyTree(ctx, dataDir, filepath.Join(stage, "data"), func(name string) bool {
			return name == ".easyssh-instance.lock" || name == "easyssh-root.key" || (cfg.Database.Driver == "sqlite" && (name == dbFile || name == dbFile+"-wal" || name == dbFile+"-shm" || name == dbFile+"-journal"))
		}); err != nil {
			return err
		}
		var configured sql.NullString
		if err = sqlDB.QueryRowContext(ctx, "SELECT transfer_storage_path FROM system_config LIMIT 1").Scan(&configured); err != nil && err != sql.ErrNoRows {
			return err
		}
		transferRoot := filepath.Join(dataDir, "transfers")
		if configured.Valid && strings.TrimSpace(configured.String) != "" {
			transferRoot, err = filepath.Abs(configured.String)
			if err != nil {
				return err
			}
		}
		manifest.TransferRoot = transferRoot
		if transferRoot != filepath.Join(dataDir, "transfers") {
			if _, err = os.Stat(filepath.Join(stage, "data", "transfers")); err == nil {
				return errors.New("custom transfer storage conflicts with data/transfers; consolidate storage before backup")
			}
			if _, err = os.Stat(transferRoot); err == nil {
				if err = instancebackup.CopyTree(ctx, transferRoot, filepath.Join(stage, "data", "transfers"), nil); err != nil {
					return err
				}
			} else if !os.IsNotExist(err) {
				return err
			}
		}
		if err = os.WriteFile(filepath.Join(stage, "root.key"), []byte(cfg.Server.EncryptionKey), 0600); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return err
	}
	if err = instancebackup.Pack(ctx, stage, output, password, manifest); err != nil {
		return err
	}
	return nil
}

func withinPath(root, filename string) bool {
	relative, err := filepath.Rel(root, filename)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
func nativeDatabaseVersion(ctx context.Context, db *sql.DB, driver string) (string, error) {
	query := "SELECT version()"
	if driver == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	var version string
	err := db.QueryRowContext(ctx, query).Scan(&version)
	return version, err
}

func nativeCommand(ctx context.Context, cfg *config.DatabaseConfig, restore bool, filename string) error {
	var cmd *exec.Cmd
	var input *os.File
	var output *os.File
	if cfg.Driver == "postgres" {
		parsed, err := pgx.ParseConfig(cfg.DSN)
		if err != nil {
			return err
		}
		publicDSN, err := postgresPublicDSN(cfg.DSN)
		if err != nil {
			return err
		}
		tool := "pg_dump"
		args := []string{"--format=custom", "--no-owner", "--no-acl", "--dbname", publicDSN}
		if restore {
			tool = "pg_restore"
			args = []string{"--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "--dbname", publicDSN, filename}
		}
		cmd = exec.CommandContext(ctx, tool, args...)
		cmd.Env = append(os.Environ(), "PGHOST="+parsed.Host, fmt.Sprintf("PGPORT=%d", parsed.Port), "PGUSER="+parsed.User, "PGPASSWORD="+parsed.Password, "PGDATABASE="+parsed.Database)

	} else if cfg.Driver == "mysql" {
		parsed, err := mysqlconfig.ParseDSN(cfg.DSN)
		if err != nil {
			return err
		}
		if parsed.TLSConfig != "" && parsed.TLSConfig != "false" && parsed.TLSConfig != "true" && parsed.TLSConfig != "skip-verify" && parsed.TLSConfig != "preferred" {
			return errors.New("custom registered MySQL TLS configurations require a native client connection configured by the operator")
		}
		opts, err := os.CreateTemp("", "easyssh-mysql-*.cnf")
		if err != nil {
			return err
		}
		defer os.Remove(opts.Name())
		quote := func(value string) string {
			return "\"" + strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "\n", "\\n", "\r", "\\r").Replace(value) + "\""
		}
		content := "[client]\nuser=" + quote(parsed.User) + "\npassword=" + quote(parsed.Passwd) + "\n"
		if parsed.Net == "unix" {
			content += "protocol=socket\nsocket=" + quote(parsed.Addr) + "\n"
		} else {
			host, port, err := splitMySQLAddress(parsed.Addr)
			if err != nil {
				opts.Close()
				return err
			}
			content += "protocol=tcp\nhost=" + quote(host) + "\nport=" + port + "\n"
		}
		if _, err = opts.WriteString(content); err != nil {
			opts.Close()
			return err
		}
		if err = opts.Close(); err != nil {
			return err
		}
		tool := "mysqldump"
		args := []string{"--defaults-extra-file=" + opts.Name(), "--single-transaction", "--quick", "--hex-blob", "--skip-add-locks", "--no-tablespaces", parsed.DBName}
		if restore {
			tool = "mysql"
			args = []string{"--defaults-extra-file=" + opts.Name(), "--binary-mode", parsed.DBName}
		}
		clientVersion, err := exec.CommandContext(ctx, tool, "--version").Output()
		if err != nil {
			return fmt.Errorf("native MySQL client unavailable: %w", err)
		}
		tlsArgs := []string{}
		if strings.Contains(strings.ToLower(string(clientVersion)), "mariadb") {
			switch parsed.TLSConfig {
			case "true":
				tlsArgs = []string{"--ssl", "--ssl-verify-server-cert"}
			case "skip-verify", "preferred":
				tlsArgs = []string{"--ssl"}
			default:
				tlsArgs = []string{"--skip-ssl"}
			}
		} else {
			if !restore {
				tlsArgs = append(tlsArgs, "--set-gtid-purged=OFF")
			}
			mode := "DISABLED"
			switch parsed.TLSConfig {
			case "true":
				mode = "VERIFY_IDENTITY"
			case "skip-verify":
				mode = "REQUIRED"
			case "preferred":
				mode = "PREFERRED"
			}
			tlsArgs = append(tlsArgs, "--ssl-mode="+mode)
		}
		args = append(args[:len(args)-1], append(tlsArgs, parsed.DBName)...)
		cmd = exec.CommandContext(ctx, tool, args...)
	} else {
		return errors.New("unsupported native database driver")
	}
	if restore && cfg.Driver == "mysql" {
		var err error
		input, err = os.Open(filename)
		if err != nil {
			return err
		}
		defer input.Close()
		cmd.Stdin = input
	}
	if !restore {
		var err error
		output, err = os.OpenFile(filename, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		defer output.Close()
		cmd.Stdout = output
	}
	// Native client errors may contain connection details; do not echo credentials or DSNs.
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("native database tool %s failed: %w (check client/server versions and database permissions)", filepath.Base(cmd.Path), err)
	}
	if output != nil {
		return output.Sync()
	}
	return nil
}

func nativeSnapshot(ctx context.Context, database *sql.DB, cfg *config.DatabaseConfig, filename string) error {
	if cfg.Driver == "sqlite" {
		if err := instancebackup.CheckSQLite(ctx, database); err != nil {
			return err
		}
		return instancebackup.SnapshotSQLite(ctx, database, filename)
	}
	if cfg.Driver == "mysql" {
		var count int
		if err := database.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' AND engine <> 'InnoDB'").Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			return errors.New("native consistent backup requires InnoDB tables")
		}
	}
	return nativeCommand(ctx, cfg, false, filename)
}

func restoreInstance(ctx context.Context, stage, into, targetDSN string, manifest instancebackup.Manifest) error {
	if into == "" {
		return errors.New("--into must name a new data directory")
	}
	if manifest.Profile != "server" {
		return errors.New("this is not a server instance backup; use application JSON for cross-profile migration")
	}
	if err := instancebackup.CheckApplicationVersion(manifest.AppVersion, readAppVersion()); err != nil {
		return err
	}
	if manifest.SchemaVersion <= 0 || manifest.SchemaVersion > dbmigration.Latest {
		return errors.New("unsupported database migration version")
	}
	destination, err := filepath.Abs(into)
	if err != nil {
		return err
	}
	if _, err = os.Lstat(destination); !os.IsNotExist(err) {
		return errors.New("restore destination already exists or is inaccessible")
	}
	rootKey, err := os.ReadFile(filepath.Join(stage, "root.key"))
	if err != nil {
		return err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(rootKey)))
	if err != nil || len(raw) != 32 {
		return errors.New("invalid root encryption key in backup")
	}
	cfg := config.DatabaseConfig{Driver: manifest.Driver, DSN: targetDSN, MaxIdleConns: 1, MaxOpenConns: 3, ConnMaxLifetime: 60, ConnMaxIdleTime: 10}
	data := filepath.Join(stage, "data")
	if err = os.MkdirAll(data, 0700); err != nil {
		return err
	}
	if cfg.Driver == "sqlite" {
		cfg.DSN = filepath.Join(data, "easyssh.db")
		if err = instancebackup.CopyFile(ctx, filepath.Join(stage, "database.dump"), cfg.DSN); err != nil {
			return err
		}
	} else if targetDSN == "" {
		return errors.New("set the target DSN environment variable to a new empty database before restore")
	}
	database, err := dbinfra.NewDB(&cfg)
	if err != nil {
		return err
	}
	sqlDB, err := database.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	release, err := instancebackup.DatabaseLock(ctx, sqlDB, cfg.Driver)
	if err != nil {
		return err
	}
	defer release()
	if cfg.Driver != "sqlite" {
		tables, err := dbmigration.Tables(ctx, sqlDB, cfg.Driver)
		if err != nil {
			return err
		}
		if len(tables) != 0 {
			return errors.New("restore target database must be empty")
		}
		if err = nativeCommand(ctx, &cfg, true, filepath.Join(stage, "database.dump")); err != nil {
			return err
		}
	}
	version, err := dbmigration.Version(ctx, sqlDB, cfg.Driver)
	if err != nil {
		return err
	}
	if version != manifest.SchemaVersion {
		return errors.New("manifest and database schema versions differ")
	}
	if err = dbmigration.Up(ctx, sqlDB, "server", cfg.Driver); err != nil {
		return err
	}
	encryptor, err := crypto.NewEncryptor(strings.TrimSpace(string(rootKey)))
	if err != nil {
		return err
	}
	if err = rest.NewBackupHandler(database, encryptor).VerifyStoredCredentials(ctx); err != nil {
		return err
	}
	// Restored grants/sessions must not resurrect credentials revoked after the snapshot.
	tx := database.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	defer tx.Rollback()
	for _, table := range []string{"user_sessions", "auth_tickets", "totp_replays", "trusted_devices", "sync_authorizations", "sync_devices", "oauth_grants", "oauth_login_challenges", "oauth_client_assertions"} {
		if err = tx.Exec("DELETE FROM " + table).Error; err != nil {
			return err
		}
	}
	transferRoot := filepath.Join(destination, "transfers")
	if err = tx.Exec("UPDATE system_config SET transfer_storage_path=?", transferRoot).Error; err != nil {
		return err
	}
	rows, err := tx.Table("transfer_jobs").Select("id, artifact_path").Rows()
	if err != nil {
		return err
	}
	type artifact struct{ ID, Path string }
	var artifacts []artifact
	for rows.Next() {
		var id string
		var value sql.NullString
		if err = rows.Scan(&id, &value); err != nil {
			rows.Close()
			return err
		}
		if value.Valid && value.String != "" {
			artifacts = append(artifacts, artifact{id, value.String})
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, item := range artifacts {
		if !withinPath(manifest.TransferRoot, item.Path) {
			return errors.New("transfer artifact lies outside recorded storage root")
		}
		relative, err := filepath.Rel(manifest.TransferRoot, item.Path)
		if err != nil {
			return err
		}
		if err = tx.Table("transfer_jobs").Where("id=?", item.ID).Update("artifact_path", filepath.Join(transferRoot, relative)).Error; err != nil {
			return err
		}
	}
	if err = tx.Commit().Error; err != nil {
		return err
	}
	if cfg.Driver == "sqlite" {
		if err = instancebackup.CheckSQLite(ctx, sqlDB); err != nil {
			return err
		}
		if _, err = sqlDB.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
			return err
		}
	}
	release()
	if err = sqlDB.Close(); err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(data, "easyssh-root.key"), rootKey, 0600); err != nil {
		return err
	}
	// Copy into a sibling directory so final publication is an atomic rename on one filesystem.
	if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	publish, err := os.MkdirTemp(filepath.Dir(destination), ".easyssh-restored-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(publish)
	if err = instancebackup.CopyTree(ctx, data, publish, nil); err != nil {
		return err
	}
	if _, err = os.Lstat(destination); !os.IsNotExist(err) {
		return errors.New("restore destination was created concurrently")
	}
	if err = os.Rename(publish, destination); err != nil {
		return err
	}
	fmt.Fprintln(os.Stdout, "Restored instance verified at:", destination)
	fmt.Fprintln(os.Stdout, "Use this data directory and its root key when starting EasySSH. Existing data was not replaced. Login and device grants were invalidated.")
	return nil
}

// Keep maintenance completely independent of HTTP handlers and normal application startup.
func splitMySQLAddress(value string) (string, string, error) {
	if value == "" {
		return "127.0.0.1", "3306", nil
	}
	return net.SplitHostPort(value)
}

// Remove passwords from native tool argv while retaining libpq TLS and connection options.
func postgresPublicDSN(dsn string) (string, error) {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			return "", err
		}
		if parsed.User != nil {
			parsed.User = url.User(parsed.User.Username())
		}
		query := parsed.Query()
		query.Del("password")
		parsed.RawQuery = query.Encode()
		return parsed.String(), nil
	}
	var parts []string
	for i := 0; i < len(dsn); {
		for i < len(dsn) && unicode.IsSpace(rune(dsn[i])) {
			i++
		}
		if i == len(dsn) {
			break
		}
		start := i
		for i < len(dsn) && dsn[i] != '=' && !unicode.IsSpace(rune(dsn[i])) {
			i++
		}
		key := dsn[start:i]
		for i < len(dsn) && unicode.IsSpace(rune(dsn[i])) {
			i++
		}
		if i == len(dsn) || dsn[i] != '=' {
			return "", errors.New("invalid PostgreSQL DSN")
		}
		i++
		for i < len(dsn) && unicode.IsSpace(rune(dsn[i])) {
			i++
		}
		quoted := i < len(dsn) && dsn[i] == '\''
		if quoted {
			i++
		}
		closed := !quoted
		for i < len(dsn) {
			if dsn[i] == '\\' {
				i += 2
				continue
			}
			if quoted && dsn[i] == '\'' {
				i++
				closed = true
				break
			}
			if !quoted && unicode.IsSpace(rune(dsn[i])) {
				break
			}
			i++
		}
		if !closed || i > len(dsn) {
			return "", errors.New("invalid PostgreSQL DSN")
		}
		if key != "password" {
			parts = append(parts, dsn[start:i])
		}
	}
	return strings.Join(parts, " "), nil
}
