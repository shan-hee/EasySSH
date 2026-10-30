package app

import (
	"database/sql"
	"github.com/easyssh/shared/servertag"
)

func saveDesktopServerTags(tx *sql.Tx, serverID string, values []string) error {
	tags, err := servertag.Normalize(values)
	if err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM desktop_server_tags WHERE server_id=?", serverID); err != nil {
		return err
	}
	for _, name := range tags {
		if _, err := tx.Exec("INSERT INTO desktop_tags(name) VALUES(?) ON CONFLICT(name) DO NOTHING", name); err != nil {
			return err
		}
		if _, err := tx.Exec("INSERT INTO desktop_server_tags(server_id,tag_name) VALUES(?,?)", serverID, name); err != nil {
			return err
		}
	}
	return nil
}
