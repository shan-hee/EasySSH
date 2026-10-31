package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/easyssh/server/internal/api/rest"
	"github.com/easyssh/server/internal/infra/config"
	"github.com/easyssh/server/internal/storage/schema"
	"github.com/easyssh/shared/dbmigration"
	"github.com/easyssh/shared/instanceactivation"
	"github.com/easyssh/shared/instancebackup"
	crypto "github.com/easyssh/shared/secretcrypto"
	mysqlconfig "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"
)

// Stored outside the database so a failed DDL operation cannot erase its recovery
// information. The database version remains the authority for completed steps.
type startupMigration struct {
	Format      int            `json:"format"`
	Identity    string         `json:"database_identity"`
	Driver      string         `json:"driver"`
	From        int64          `json:"from"`
	To          int64          `json:"to"`
	Digest      string         `json:"scripts_sha256"`
	Phase       string         `json:"phase"`
	Archive     string         `json:"archive"`
	ArchiveHash string         `json:"archive_sha256,omitempty"`
	ForeignKeys map[string]int `json:"foreign_key_baseline"`
	StartedAt   time.Time      `json:"started_at"`
	CompletedAt *time.Time     `json:"completed_at,omitempty"`
}

func migrationPassword(root string) (string, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(root))
	if err != nil || len(key) != 32 {
		return "", errors.New("migration backup requires a valid instance root key")
	}
	hash := hmac.New(sha256.New, key)
	hash.Write([]byte("easyssh/server/schema-recovery/v1"))
	return base64.RawStdEncoding.EncodeToString(hash.Sum(nil)), nil
}

func migrationIdentity(cfg *config.Config) (string, error) {
	identity := cfg.Database.Driver + ":"
	switch cfg.Database.Driver {
	case "sqlite":
		path, err := filepath.Abs(sqliteDatabasePath(cfg.Database.DSN))
		if err != nil {
			return "", err
		}
		if resolved, err := filepath.EvalSymlinks(path); err == nil {
			path = resolved
		}
		identity += path
	case "postgres":
		parsed, err := pgx.ParseConfig(cfg.Database.DSN)
		if err != nil {
			return "", errors.New("invalid PostgreSQL configuration")
		}
		identity += fmt.Sprintf("%s:%d/%s", parsed.Host, parsed.Port, parsed.Database)
	case "mysql":
		parsed, err := mysqlconfig.ParseDSN(cfg.Database.DSN)
		if err != nil {
			return "", errors.New("invalid MySQL configuration")
		}
		identity += parsed.Net + ":" + parsed.Addr + "/" + parsed.DBName
	default:
		return "", errors.New("unsupported migration database")
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(identity))), nil
}

func saveMigration(path string, state *startupMigration) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".migration-state-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = replaceMigrationFile(file.Name(), path); err != nil {
		return err
	}
	return syncMigrationDirectory(filepath.Dir(path))
}

type migrationOptions struct {
	Manual                 bool
	ResumeInterruptedMySQL bool
}

// startDatabase runs only while both existing instance/database locks are held.
// HTTP listeners and background workers have not been started yet.
func startDatabase(cfg *config.Config, database *gorm.DB, launcher *instanceactivation.Client, options migrationOptions) error {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("EASYSSH_AUTO_MIGRATE")))
	if mode != "" && mode != "on" && mode != "off" {
		return errors.New("EASYSSH_AUTO_MIGRATE must be on or off")
	}
	timeout, err := instanceactivation.MigrationTimeout()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	db, err := database.DB()
	if err != nil {
		return err
	}
	version, err := dbmigration.Version(ctx, db, cfg.Database.Driver)
	if err != nil {
		return err
	}
	if version > schema.Version {
		return fmt.Errorf("database schema %d is newer than this executable (%d); automatic downgrade is disabled", version, schema.Version)
	}
	if version != 0 && version < 5 {
		return fmt.Errorf("automatic upgrade does not support schema %d", version)
	}
	identity, err := migrationIdentity(cfg)
	if err != nil {
		return err
	}
	statePath := filepath.Join(maintenanceDataDir(cfg), ".easyssh-migration-"+identity[:24]+".json")
	var state startupMigration
	data, err := os.ReadFile(statePath)
	if err == nil {
		if err = json.Unmarshal(data, &state); err != nil {
			return fmt.Errorf("invalid migration record %s", statePath)
		}
		if state.Format != 1 || state.Identity != identity || state.Driver != cfg.Database.Driver {
			return errors.New("migration record does not match this database")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if version == 0 {
		if state.Format != 0 {
			return fmt.Errorf("empty database has an existing migration record %s; restore the database or explicitly use a new data directory", statePath)
		}
		return schema.Start(ctx, db, cfg.Database.Driver)
	}
	pending := state.Format != 0 && state.Phase != "complete"
	if !pending && version == schema.Version {
		return nil
	}
	if mode == "off" && !options.Manual {
		return fmt.Errorf("schema %d requires migration or pending migration validation; EASYSSH_AUTO_MIGRATE=off prevents startup (use maintenance schema-upgrade)", version)
	}
	if pending && (state.To != schema.Version || state.From < 5 || state.From >= state.To || version < state.From || version > state.To) {
		return fmt.Errorf("unfinished migration in %s requires its matching executable or manual recovery", statePath)
	}

	var phase atomic.Value
	phase.Store("checking")
	if err = launcher.Migration(ctx, "checking"); err != nil {
		return err
	}
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				current := phase.Load().(string)
				log.Printf("[migration] %s (target schema %d)", current, schema.Version)
				if err := launcher.Migration(ctx, current); err != nil {
					log.Print("[migration] launcher heartbeat failed; cancelling maintenance")
					cancel()
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-heartbeatDone }()

	password, err := migrationPassword(cfg.Server.EncryptionKey)
	if err != nil {
		return err
	}
	from := version
	if pending {
		from = state.From
	}
	digest, err := schema.UpgradeDigest(cfg.Database.Driver, from)
	if err != nil {
		return err
	}
	if pending && digest != state.Digest {
		return errors.New("unfinished migration scripts changed; restore the matching executable before retrying")
	}
	if pending {
		switch state.Phase {
		case "backup", "prepared", "migrating", "validating":
		default:
			return errors.New("unknown persisted migration phase; manual inspection required")
		}
		if (state.Phase == "backup" || state.Phase == "prepared") && version != state.From {
			return errors.New("database changed before recorded migration started")
		}
		if state.Phase == "migrating" && cfg.Database.Driver == "mysql" && version != state.To && !options.ResumeInterruptedMySQL {
			return fmt.Errorf("interrupted MySQL DDL requires inspection; recovery point: %s; record: %s (see migration recovery documentation)", state.Archive, statePath)
		}
		if state.Phase == "validating" && version != state.To {
			return errors.New("database version changed during pending validation")
		}
	}
	if err = schema.CheckUpgradeSource(ctx, db, cfg.Database.Driver, version); err != nil {
		return err
	}
	baseline, err := migrationIntegrity(ctx, db, cfg.Database.Driver)
	if err != nil {
		return err
	}
	encryptor, err := crypto.NewEncryptor(cfg.Server.EncryptionKey)
	if err != nil {
		return err
	}
	// These credential columns exist in all supported source schemas (5+).
	if err = rest.VerifyStoredCredentials(ctx, database, encryptor); err != nil {
		return err
	}
	if !pending {
		directory, err := migrationBackupDirectory(cfg)
		if err != nil {
			return err
		}
		state = startupMigration{Format: 1, Identity: identity, Driver: cfg.Database.Driver, From: version, To: schema.Version, Digest: digest, Phase: "backup", ForeignKeys: baseline, StartedAt: time.Now().UTC(),
			Archive: filepath.Join(directory, fmt.Sprintf("schema-%d-to-%d-%s-%s.age", version, schema.Version, identity[:12], time.Now().UTC().Format("20060102T150405.000000000")))}
		if err = saveMigration(statePath, &state); err != nil {
			return err
		}
	}
	if err = compareMigrationIntegrity(state.ForeignKeys, baseline); err != nil {
		return err
	}
	if len(state.ForeignKeys) > 0 {
		log.Printf("[migration] retaining %d existing SQLite foreign-key violation identities; new violations will block startup", len(state.ForeignKeys))
	}
	if state.Phase == "backup" {
		phase.Store("backup")
		if err = createMigrationRecovery(ctx, cfg, db, &state, password); err != nil {
			return fmt.Errorf("migration recovery point failed (database not upgraded): %w", err)
		}
		state.Phase = "prepared"
		if err = saveMigration(statePath, &state); err != nil {
			return err
		}
	} else if err = verifyMigrationRecovery(ctx, &state, password); err != nil {
		return err
	}
	log.Printf("[migration] recovery point: %s", state.Archive)
	if version < state.To {
		phase.Store("checking")
		if err = migrationDDLPreflight(ctx, db, cfg.Database.Driver, identity[:16]); err != nil {
			return fmt.Errorf("migration DDL preflight failed: %w", err)
		}
		state.Phase = "migrating"
		if err = saveMigration(statePath, &state); err != nil {
			return err
		}
		phase.Store("migrating")
		log.Printf("[migration] upgrading schema %d -> %d", version, state.To)
		if err = schema.Migrate(ctx, db, cfg.Database.Driver, false); err != nil {
			return fmt.Errorf("schema upgrade failed; recovery point %s; record %s: %w", state.Archive, statePath, err)
		}
	}
	state.Phase = "validating"
	if err = saveMigration(statePath, &state); err != nil {
		return err
	}
	phase.Store("validating")
	installed, err := dbmigration.Version(ctx, db, cfg.Database.Driver)
	if err != nil {
		return err
	}
	if installed != state.To {
		return fmt.Errorf("migration ended at schema %d, expected %d", installed, state.To)
	}
	if err = schema.CheckUpgradeSource(ctx, db, cfg.Database.Driver, installed); err != nil {
		return err
	}
	after, err := migrationIntegrity(ctx, db, cfg.Database.Driver)
	if err != nil {
		return err
	}
	if err = compareMigrationIntegrity(state.ForeignKeys, after); err != nil {
		return err
	}
	if err = rest.VerifyStoredCredentials(ctx, database, encryptor); err != nil {
		return err
	}
	now := time.Now().UTC()
	if err = ctx.Err(); err != nil {
		return err
	}
	state.Phase, state.CompletedAt = "complete", &now
	// Retain the final report next to its recovery point even after a later upgrade.
	if err = saveMigration(state.Archive+".json", &state); err != nil {
		return err
	}
	if err = saveMigration(statePath, &state); err != nil {
		return err
	}
	// Stop heartbeats before ending maintenance; no late heartbeat may reopen it.
	cancel()
	<-heartbeatDone
	finishCtx, finishCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer finishCancel()
	if err = launcher.Migration(finishCtx, ""); err != nil {
		return err
	}
	log.Printf("[migration] schema %d ready; upgrade recovery point retained", installed)
	return nil
}

func migrationBackupDirectory(cfg *config.Config) (string, error) {
	dataDir, err := filepath.Abs(maintenanceDataDir(cfg))
	if err != nil {
		return "", err
	}
	dataDir, err = filepath.EvalSymlinks(dataDir)
	if err != nil {
		return "", err
	}
	root := os.Getenv("EASYSSH_BACKUP_DIR")
	if root == "" {
		root = filepath.Join(filepath.Dir(dataDir), "backups")
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	directory := filepath.Join(root, "migrations")
	if withinPath(dataDir, directory) || withinPath(directory, dataDir) {
		return "", errors.New("migration recovery storage must be separate from instance data")
	}
	if err = os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("migration recovery directory must be a real directory")
	}
	return directory, nil
}

// SQLite's native full-backup validation rejects all historical FK anomalies.
// Startup migration instead preserves their identities and rejects any additions.
func migrationIntegrity(ctx context.Context, db *sql.DB, driver string) (map[string]int, error) {
	result := map[string]int{}
	if driver != "sqlite" {
		return result, nil
	}
	var integrity string
	if err := db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil {
		return nil, err
	}
	if integrity != "ok" {
		return nil, errors.New("SQLite physical integrity check failed; migration stopped")
	}
	rows, err := db.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return nil, err
	}
	type violation struct {
		table, parent string
		row           sql.NullInt64
		constraint    int64
	}
	var violations []violation
	for rows.Next() {
		var item violation
		if err = rows.Scan(&item.table, &item.row, &item.parent, &item.constraint); err != nil {
			rows.Close()
			return nil, err
		}
		violations = append(violations, item)
	}
	err = rows.Err()
	rows.Close() // Release the single SQLite connection before looking up keys.
	if err != nil {
		return nil, err
	}
	keys := map[string]string{}
	quote := func(name string) string { return `"` + strings.ReplaceAll(name, `"`, `""`) + `"` }
	for _, item := range violations {
		if !item.row.Valid {
			return nil, errors.New("historical foreign-key violations on WITHOUT ROWID tables require repair before automatic migration")
		}
		projection, ok := keys[item.table]
		if !ok {
			columns, err := db.QueryContext(ctx, `SELECT name FROM pragma_table_info(?) WHERE pk > 0 OR name IN (SELECT "from" FROM pragma_foreign_key_list(?)) ORDER BY cid`, item.table, item.table)
			if err != nil {
				return nil, err
			}
			var names []string
			for columns.Next() {
				var name string
				if err = columns.Scan(&name); err != nil {
					columns.Close()
					return nil, err
				}
				names = append(names, quote(name))
			}
			err = columns.Err()
			columns.Close()
			if err != nil {
				return nil, err
			}
			projection = strings.Join(names, ",")
			if projection == "" {
				projection = "*"
			}
			keys[item.table] = projection
		}
		// VACUUM INTO may renumber rowids in tables with a text/composite PK.
		// Compare logical primary keys and referenced values, hashing to avoid recording
		// business data in the plaintext migration journal.
		row, err := db.QueryContext(ctx, "SELECT "+projection+" FROM "+quote(item.table)+" WHERE rowid=?", item.row.Int64)
		if err != nil {
			return nil, err
		}
		columns, err := row.Columns()
		if err != nil {
			row.Close()
			return nil, err
		}
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for index := range values {
			pointers[index] = &values[index]
		}
		if !row.Next() {
			err := row.Err()
			row.Close()
			if err != nil {
				return nil, err
			}
			return nil, errors.New("foreign-key violation changed during inspection")
		}
		err = row.Scan(pointers...)
		row.Close()
		if err != nil {
			return nil, err
		}
		identity, err := json.Marshal([]any{item.table, values, item.parent, item.constraint})
		if err != nil {
			return nil, err
		}
		result[fmt.Sprintf("%x", sha256.Sum256(identity))]++
	}
	return result, nil
}

func compareMigrationIntegrity(before, after map[string]int) error {
	for identity, count := range after {
		if count > before[identity] {
			return errors.New("new SQLite foreign-key violations detected; startup blocked and recovery point retained")
		}
	}
	return nil
}

func migrationFileHash(ctx context.Context, path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	buffer := make([]byte, 128*1024)
	for {
		if err = ctx.Err(); err != nil {
			return "", err
		}
		n, readErr := file.Read(buffer)
		if n > 0 {
			hash.Write(buffer[:n])
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return "", readErr
		}
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

func verifyMigrationRecovery(ctx context.Context, state *startupMigration, password string) error {
	hash, err := migrationFileHash(ctx, state.Archive)
	if err != nil {
		return err
	}
	if state.ArchiveHash != "" && state.ArchiveHash != hash {
		return errors.New("migration recovery archive checksum changed")
	}
	stage := state.Archive + ".verify"
	if err = os.RemoveAll(stage); err != nil {
		return err
	}
	if err = os.Mkdir(stage, 0700); err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	manifest, err := instancebackup.Unpack(ctx, state.Archive, stage, password)
	if err != nil {
		return err
	}
	if manifest.Profile != "server-migration" || manifest.Driver != state.Driver || manifest.SchemaVersion != state.From {
		return errors.New("migration recovery manifest mismatch")
	}
	var captured startupMigration
	data, err := os.ReadFile(filepath.Join(stage, "upgrade.json"))
	if err != nil {
		return err
	}
	if err = json.Unmarshal(data, &captured); err != nil {
		return err
	}
	if captured.Identity != state.Identity || captured.Digest != state.Digest || captured.To != state.To || !captured.StartedAt.Equal(state.StartedAt) {
		return errors.New("migration recovery belongs to a different upgrade")
	}
	if _, ok := manifest.Files["database.dump"]; !ok {
		return errors.New("migration recovery has no database snapshot")
	}
	if state.Driver == "sqlite" {
		path := filepath.ToSlash(filepath.Join(stage, "database.dump"))
		if !strings.HasPrefix(path, "/") {
			path = "/" + path
		}
		uri := (&url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro"}).String()
		snapshot, err := sql.Open("sqlite", uri)
		if err != nil {
			return err
		}
		defer snapshot.Close()
		version, err := dbmigration.Version(ctx, snapshot, "sqlite")
		if err != nil {
			return err
		}
		if version != state.From {
			return errors.New("SQLite snapshot version differs from migration source")
		}
		violations, err := migrationIntegrity(ctx, snapshot, "sqlite")
		if err != nil {
			return err
		}
		if err = compareMigrationIntegrity(state.ForeignKeys, violations); err != nil {
			return err
		}
	}
	state.ArchiveHash = hash
	// A hard kill after publishing the encrypted archive can leave its private
	// plaintext staging tree behind. Remove it only after verifying the archive.
	if err = os.RemoveAll(state.Archive + ".staging"); err != nil {
		return err
	}
	return nil
}

func createMigrationRecovery(ctx context.Context, cfg *config.Config, db *sql.DB, state *startupMigration, password string) error {
	// A crash after archive publication but before recording prepared reuses the
	// same verified archive; a partial archive is never used for migration.
	if _, err := os.Lstat(state.Archive); err == nil {
		return verifyMigrationRecovery(ctx, state, password)
	} else if !os.IsNotExist(err) {
		return err
	}
	stage := state.Archive + ".staging"
	partial := state.Archive + ".partial"
	// This path is reserved by this persisted upgrade, never arbitrary user data.
	if err := os.RemoveAll(stage); err != nil {
		return err
	}
	if err := os.Remove(partial); err != nil && !os.IsNotExist(err) {
		return err
	}
	// Reclaim interrupted temporary output before estimating free space.
	if err := migrationSpacePreflight(ctx, db, cfg, filepath.Dir(state.Archive)); err != nil {
		return err
	}
	if err := os.Mkdir(stage, 0700); err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	var err error
	if cfg.Database.Driver == "sqlite" {
		err = instancebackup.SnapshotSQLite(ctx, db, filepath.Join(stage, "database.dump"))
	} else {
		err = nativeSnapshot(ctx, db, &cfg.Database, filepath.Join(stage, "database.dump"))
	}
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(stage, "upgrade.json"), data, 0600); err != nil {
		return err
	}
	// The root key is inside the encrypted archive, never beside it. An external
	// copy of that original key is still needed to derive the archive password.
	if err = os.WriteFile(filepath.Join(stage, "root.key"), []byte(cfg.Server.EncryptionKey), 0600); err != nil {
		return err
	}
	dataDir, err := filepath.Abs(maintenanceDataDir(cfg))
	if err != nil {
		return err
	}
	manifest := instancebackup.Manifest{Profile: "server-migration", AppVersion: readAppVersion(), Driver: cfg.Database.Driver, SchemaVersion: state.From, OriginalDataDir: dataDir}
	manifest.DatabaseVersion, err = nativeDatabaseVersion(ctx, db, cfg.Database.Driver)
	if err != nil {
		return err
	}
	if err = instancebackup.Pack(ctx, stage, partial, password, manifest); err != nil {
		return err
	}
	if err = replaceMigrationFile(partial, state.Archive); err != nil {
		return err
	}
	if err = syncMigrationDirectory(filepath.Dir(state.Archive)); err != nil {
		return err
	}
	return verifyMigrationRecovery(ctx, state, password)
}
