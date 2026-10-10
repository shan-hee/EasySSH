package instancebackup

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gofrs/flock"
)

// Lock is shared by normal startup and offline maintenance; the OS releases it on exit.
func Lock(dataDir string) (*flock.Flock, error) {
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return nil, err
	}
	lock := flock.New(filepath.Join(dataDir, ".easyssh-instance.lock"))
	ok, err := lock.TryLock()
	if err != nil {
		return nil, err
	}
	if !ok {
		_ = lock.Close()
		return nil, errors.New("instance is running or maintenance is in progress; stop EasySSH before maintenance")
	}
	return lock, nil
}

// DatabaseLock also excludes processes on other hosts sharing the same server database.
func DatabaseLock(ctx context.Context, db *sql.DB, driver string) (func(), error) {
	if driver == "sqlite" {
		return func() {}, nil
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	var ok bool
	switch driver {
	case "postgres":
		err = conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock(1163085139)").Scan(&ok)
	case "mysql":
		err = conn.QueryRowContext(ctx, "SELECT GET_LOCK(CONCAT('easyssh:',MD5(DATABASE())),0)").Scan(&ok)
	default:
		err = errors.New("unsupported database driver")
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if driver == "postgres" {
				_, _ = conn.ExecContext(releaseCtx, "SELECT pg_advisory_unlock(1163085139)")
			}
			if driver == "mysql" {
				_, _ = conn.ExecContext(releaseCtx, "SELECT RELEASE_LOCK(CONCAT('easyssh:',MD5(DATABASE())))")
			}
			_ = conn.Close()
		})
	}

	if err != nil || !ok {
		release()
		if err != nil {
			return nil, err
		}
		return nil, errors.New("another EasySSH process owns this database; stop it before maintenance")
	}
	return release, nil
}
