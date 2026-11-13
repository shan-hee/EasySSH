package app

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestDesktopRecycleBinRestoresADeletedServerAndScript(t *testing.T) {
	s := newDesktopSyncTestService(t)
	db := s.servers.db
	serverID, scriptID, groupID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO desktop_server_groups(id,name,sort_order) VALUES(?,'prod',0)`, []any{groupID}},
		{`INSERT INTO desktop_servers(id,name,host,port,username,group_id,created_at,updated_at) VALUES(?,'web','web.test',2222,'root',?,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`, []any{serverID, groupID}},
		{`INSERT INTO desktop_server_auth(server_id,auth_method,password) VALUES(?,'password','ciphertext')`, []any{serverID}},
		{`INSERT INTO desktop_tags(name) VALUES('edge')`, nil},
		{`INSERT INTO desktop_server_tags(server_id,tag_name) VALUES(?,'edge')`, []any{serverID}},
		{`INSERT INTO desktop_scripts(id,name,content,language,created_at,updated_at) VALUES(?,'deploy','echo deploy','bash','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`, []any{scriptID}},
	} {
		if _, err := db.Exec(statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err = deleteDesktopServer(tx, serverID); err != nil {
		t.Fatal(err)
	}
	if err = deleteDesktopScript(tx, scriptID); err != nil {
		t.Fatal(err)
	}
	// The group disappears while the server is in the bin.
	if _, err = tx.Exec(`DELETE FROM desktop_server_groups WHERE id=?`, groupID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var live int
	if err = db.QueryRow(`SELECT (SELECT COUNT(*) FROM desktop_servers)+(SELECT COUNT(*) FROM desktop_scripts)+(SELECT COUNT(*) FROM desktop_server_auth)`).Scan(&live); err != nil || live != 0 {
		t.Fatalf("records were not removed: %d %v", live, err)
	}
	retention := &DesktopRetentionService{tasks: &DesktopTaskService{db: db}}
	entries, err := retention.ListRecycleBin()
	if err != nil || len(entries) != 2 {
		t.Fatalf("recycle bin: %+v %v", entries, err)
	}
	for _, entry := range entries {
		if _, err = retention.RestoreRecycleBinEntry(entry.ID); err != nil {
			t.Fatalf("restore %s: %v", entry.Kind, err)
		}
	}
	var host, password, tag, content string
	var port int
	var group *string
	if err = db.QueryRow(`SELECT s.host,s.port,s.group_id,a.password,t.tag_name FROM desktop_servers s JOIN desktop_server_auth a ON a.server_id=s.id JOIN desktop_server_tags t ON t.server_id=s.id WHERE s.id=?`, serverID).Scan(&host, &port, &group, &password, &tag); err != nil {
		t.Fatal(err)
	}
	if host != "web.test" || port != 2222 || password != "ciphertext" || tag != "edge" || group != nil {
		t.Fatalf("server not restored as archived: %s %d %v %s %s", host, port, group, password, tag)
	}
	if err = db.QueryRow(`SELECT content FROM desktop_scripts WHERE id=?`, scriptID).Scan(&content); err != nil || content != "echo deploy" {
		t.Fatalf("script not restored: %q %v", content, err)
	}
	if entries, err = retention.ListRecycleBin(); err != nil || len(entries) != 0 {
		t.Fatalf("restored entries stayed in the bin: %+v %v", entries, err)
	}
	// Deleting again and restoring over a live record is refused.
	tx, err = db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err = deleteDesktopScript(tx, scriptID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(`INSERT INTO desktop_scripts(id,name,content,language,created_at,updated_at) VALUES(?,'other','echo other','bash','','')`, scriptID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	entries, _ = retention.ListRecycleBin()
	if len(entries) != 1 {
		t.Fatalf("expected one entry: %+v", entries)
	}
	if _, err = retention.RestoreRecycleBinEntry(entries[0].ID); !errors.Is(err, errDesktopRecycleExists) {
		t.Fatalf("restored over a live script: %v", err)
	}
}
