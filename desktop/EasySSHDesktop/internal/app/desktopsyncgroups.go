package app

import (
	"database/sql"
	"errors"
	"github.com/easyssh/shared/protocol"
	"strings"

	"github.com/easyssh/shared/servergroup"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

// A group has one sync owner. Copy only the dependency requested by this
// enrollment; servers remaining in the source space keep the original group.
func ensureDesktopGroupEnrollment(tx *sql.Tx, spaceID, groupID string, copies map[string]string) (string, error) {
	if groupID == "" {
		return "", nil
	}
	if !servergroup.ValidID(groupID) {
		return "", servergroup.ErrInvalid
	}
	if target := copies[groupID]; target != "" {
		return target, nil
	}
	var group protocol.ServerGroup
	var owner string
	err := tx.QueryRow(`SELECT g.id,g.name,g.sort_order,COALESCE(m.space_id,'') FROM desktop_server_groups g LEFT JOIN desktop_sync_records m ON m.kind='group' AND m.local_id=g.id WHERE g.id=?`, groupID).Scan(&group.ID, &group.Name, &group.SortOrder, &owner)
	if err != nil {
		return "", err
	}
	if owner == spaceID {
		copies[groupID] = groupID
		return groupID, nil
	}
	if owner != "" {
		group.ID = uuid.NewString()
		if _, err := tx.Exec("INSERT INTO desktop_server_groups(id,name,sort_order) VALUES(?,?,?)", group.ID, group.Name, group.SortOrder); err != nil {
			return "", err
		}
		if err := recordDesktopConfiguration(tx, "server_group_created", "server_group", group.ID, group.Name, "manual", []string{"definition"}, nil); err != nil {
			return "", err
		}
	}
	if _, err := tx.Exec("INSERT INTO desktop_sync_records(kind,local_id,space_id,remote_id) VALUES('group',?,?,?)", group.ID, spaceID, group.ID); err != nil {
		return "", err
	}
	resources, err := desktopGroupResources(tx, group.ID)
	if err != nil {
		return "", err
	}
	if err := recordDesktopConfiguration(tx, "server_group_sync_enrolled", "server_group", group.ID, group.Name, "manual", []string{"sync_space_id"}, resources); err != nil {
		return "", err
	}
	copies[groupID] = group.ID
	return group.ID, nil
}

func enrollDesktopServerGroup(tx *sql.Tx, serverID string, row *DesktopServer) error {
	if row.GroupID == "" {
		return nil
	}
	var spaceID string
	err := tx.QueryRow("SELECT space_id FROM desktop_sync_records WHERE kind='server' AND local_id=?", serverID).Scan(&spaceID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	row.GroupID, err = ensureDesktopGroupEnrollment(tx, spaceID, row.GroupID, map[string]string{})
	return err
}

func applyDesktopSyncGroups(tx *sql.Tx, spaceID string, before, after syncdata.Snapshot, ids map[string]string) error {
	for key, record := range after {
		if !strings.HasPrefix(key, "group/") || syncdata.Equal(before[key], record) {
			continue
		}
		group, err := syncdata.ParseGroup(strings.TrimPrefix(key, "group/"), record)
		if err != nil {
			return err
		}
		localID := ids[key]
		action := "server_group_updated"
		if before[key] == nil {
			if localID == "" {
				localID = group.ID
			}
			// A remote group must not adopt local metadata the user has not enrolled.
			var exists bool
			if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM desktop_server_groups WHERE id=?)", localID).Scan(&exists); err != nil {
				return err
			}
			if exists {
				return errors.New("本地存在同 ID 的未加入分组，请先在同步设置中主动加入该分组或所属服务器")
			}
			if _, err = tx.Exec("INSERT INTO desktop_server_groups(id,name,sort_order) VALUES(?,?,?)", localID, group.Name, group.SortOrder); err != nil {
				return err
			}
			if _, err = tx.Exec(`INSERT INTO desktop_sync_records(kind,local_id,space_id,remote_id) VALUES('group',?,?,?) ON CONFLICT(space_id,kind,remote_id) DO UPDATE SET local_id=excluded.local_id`, localID, spaceID, group.ID); err != nil {
				return err
			}
			action = "server_group_created"
		} else {
			result, err := tx.Exec(`UPDATE desktop_server_groups SET name=?,sort_order=? WHERE id=? AND EXISTS(SELECT 1 FROM desktop_sync_records WHERE kind='group' AND local_id=? AND space_id=? AND remote_id=?)`, group.Name, group.SortOrder, localID, localID, spaceID, group.ID)
			if err != nil {
				return err
			}
			n, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if n != 1 {
				return errors.New("group sync ownership changed")
			}
		}
		ids[key] = localID
		fields := syncdata.ConfigurationChangedFields(before[key], record, "name", "sort_order")
		resources, err := desktopGroupResources(tx, localID)
		if err != nil {
			return err
		}
		if err := recordDesktopConfiguration(tx, action, "server_group", localID, group.Name, "automation", fields, resources); err != nil {
			return err
		}
	}
	for key, record := range before {
		if !strings.HasPrefix(key, "group/") || after[key] != nil {
			continue
		}
		resources, err := desktopGroupResources(tx, ids[key])
		if err != nil {
			return err
		}
		if _, err := tx.Exec("DELETE FROM desktop_server_groups WHERE id=?", ids[key]); err != nil {
			return err
		}
		if err := recordDesktopConfiguration(tx, "server_group_deleted", "server_group", ids[key], record["name"], "automation", []string{"deleted"}, resources); err != nil {
			return err
		}
	}
	return nil
}
