package app

import (
	"database/sql"
	"errors"
	"testing"

	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

func TestDesktopDeletionClearsCredentialVersionsAndKeepsSyncTombstoneMapping(t *testing.T) {
	for _, mode := range []string{"manual", "sync"} {
		t.Run(mode, func(t *testing.T) {
			service := newDesktopSyncTestService(t)
			db := service.servers.db
			space, id, other := uuid.NewString(), uuid.NewString(), uuid.NewString()
			activateSyncTestSpace(t, service, space)
			for _, target := range []string{id, other} {
				if _, err := db.Exec(`INSERT INTO desktop_servers(id,name,host,username,created_at,updated_at) VALUES(?,'server','host.test','owner','','')`, target); err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec(`INSERT INTO desktop_server_auth(server_id,auth_method) VALUES(?,'password')`, target); err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec(`INSERT INTO desktop_sync_records(space_id,kind,local_id,remote_id) VALUES(?,'server',?,?)`, space, target, target); err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec(`INSERT INTO desktop_sync_vault(space_id,kind,remote_id,local_id) VALUES(?,'credential',?,?)`, space, target, target); err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec(`INSERT INTO desktop_sync_objects(space_id,id,kind,resource_id,ciphertext) VALUES(?,?,'credential',?,'ciphertext')`, space, uuid.NewString(), target); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := db.Exec(`INSERT INTO desktop_sync_objects(space_id,id,kind,resource_id,ciphertext) VALUES(?,?,'ai_session',?,'history')`, space, uuid.NewString(), id); err != nil {
				t.Fatal(err)
			}
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			if err := deleteDesktopServer(tx, id); err != nil {
				_ = tx.Rollback()
				t.Fatal(err)
			}
			if err := tx.Rollback(); err != nil {
				t.Fatal(err)
			}
			var count int
			if err := db.QueryRow(`SELECT COUNT(*) FROM desktop_sync_objects WHERE kind='credential' AND resource_id=?`, id).Scan(&count); err != nil || count != 1 {
				t.Fatalf("rollback lost credentials: %d %v", count, err)
			}
			if mode == "manual" {
				err = service.servers.Delete(id)
			} else {
				tx, err = db.Begin()
				if err != nil {
					t.Fatal(err)
				}
				err = applyDesktopSync(tx, space, syncdata.Snapshot{"server/" + id: syncdata.Record{}}, syncdata.Snapshot{}, map[string]string{"server/" + id: id})
				if err != nil {
					_ = tx.Rollback()
					t.Fatal(err)
				}
				err = tx.Commit()
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, query := range []string{
				`SELECT COUNT(*) FROM desktop_sync_objects WHERE kind='credential' AND resource_id=?`,
				`SELECT COUNT(*) FROM desktop_sync_vault WHERE kind='credential' AND local_id=?`,
			} {
				if err := db.QueryRow(query, id).Scan(&count); err != nil || count != 0 {
					t.Fatalf("credential residue: %d %v", count, err)
				}
			}
			if err := db.QueryRow(`SELECT COUNT(*) FROM desktop_sync_records WHERE kind='server' AND local_id=?`, id).Scan(&count); err != nil || count != 1 {
				t.Fatalf("lost deletion mapping: %d %v", count, err)
			}
			if err := db.QueryRow(`SELECT COUNT(*) FROM desktop_sync_objects`).Scan(&count); err != nil || count != 2 {
				t.Fatalf("unrelated history removed: %d %v", count, err)
			}
			tx, err = db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			err = service.putLocalObject(tx, space, "credential", uuid.NewString(), id, "late-secret", true)
			_ = tx.Rollback()
			if !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("late download restored credential: %v", err)
			}
		})
	}
}
