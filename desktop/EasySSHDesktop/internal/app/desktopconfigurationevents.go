package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"sort"

	"github.com/easyssh/shared/activitystats"
	"github.com/google/uuid"
)

// Configuration changes are committed facts, not executable tasks. Callers
// supply field names only: no before/after values or secret material enter the
// event or its activity projection. The transaction belongs to the mutation.
func recordDesktopConfiguration(tx *sql.Tx, action, kind, resourceID, name, source string, fields []string, resources []activitystats.Resource) error {
	if source != "manual" && source != "automation" {
		return errors.New("invalid configuration event source")
	}
	if action == "" || resourceID == "" || kind == "" {
		return errors.New("invalid configuration event")
	}
	if kind == "server" && name == "" {
		if err := tx.QueryRow("SELECT host FROM desktop_servers WHERE id=?", resourceID).Scan(&name); err != nil {
			return err
		}
	}
	fields = append([]string(nil), fields...)
	sort.Strings(fields)
	detail, err := json.Marshal(struct {
		ResourceKind  string   `json:"resource_kind"`
		ResourceID    string   `json:"resource_id"`
		ChangedFields []string `json:"changed_fields"`
	}{kind, resourceID, fields})
	if err != nil {
		return err
	}
	id, now := uuid.NewString(), desktopTaskNow()
	actor := desktopLocalActor()
	item := DesktopActivityLogItem{ID: id, Actor: actor, WorkID: id, WorkStartedAt: now, Attempt: 1, SourceTable: "desktop_configuration_events", SourceID: id, Kind: activitystats.TypeAudit, Source: source, Action: action, Resource: name, Status: DesktopActivityLogSuccess, StartedAt: now, FinishedAt: now, CreatedAt: now, TotalCount: 1, SuccessCount: 1, Detail: string(detail), Resources: resources}
	if kind == "server" {
		item.ServerID, item.ServerName = resourceID, name
	}
	if err = upsertDesktopActivity(tx, item); err != nil {
		return err
	}
	encodedFields, _ := json.Marshal(fields)
	_, err = tx.Exec(`INSERT INTO desktop_configuration_events(id,activity_id,actor_kind,actor_id,actor_session_id,actor_grant_id,action,resource_kind,resource_id,resource_name,source,changed_fields_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, id, actor.Kind, actor.ID, actor.SessionID, actor.GrantID, action, kind, resourceID, name, source, string(encodedFields), now)
	return err
}

func desktopServerChangedFields(before, after DesktopServer, passwordChanged bool) []string {
	fields := []string{}
	for _, f := range []struct {
		name    string
		changed bool
	}{
		{"name", before.Name != after.Name}, {"host", before.Host != after.Host}, {"port", before.Port != after.Port},
		{"username", before.Username != after.Username}, {"auth_method", before.AuthMethod != after.AuthMethod},
		{"jump_server_id", before.JumpServerID != after.JumpServerID}, {"group_id", before.GroupID != after.GroupID}, {"tags", !slices.Equal(before.Tags, after.Tags)}, {"description", before.Description != after.Description},
		{"password", passwordChanged}, {"ssh_key_id", !desktopSameSSHKey(before.SSHKeyID, after.SSHKeyID)},
	} {
		if f.changed {
			fields = append(fields, f.name)
		}
	}
	return fields
}

func desktopSameSSHKey(a, b *string) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

func desktopKeyResources(tx *sql.Tx, id string) ([]activitystats.Resource, error) {
	rows, err := tx.Query(`SELECT s.id,COALESCE(NULLIF(s.name,''),s.host) FROM desktop_servers s JOIN desktop_server_auth a ON a.server_id=s.id WHERE a.ssh_key_id=? ORDER BY s.id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	resources := []activitystats.Resource{}
	for rows.Next() {
		var r activitystats.Resource
		if err = rows.Scan(&r.ServerID, &r.Name); err != nil {
			return nil, err
		}
		resources = append(resources, r)
	}
	return resources, rows.Err()
}

// Capture members before deleting a group: its foreign key clears group_id.
func desktopGroupResources(tx *sql.Tx, id string) ([]activitystats.Resource, error) {
	rows, err := tx.Query(`SELECT id,COALESCE(NULLIF(name,''),host) FROM desktop_servers WHERE group_id=? ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	resources := []activitystats.Resource{}
	for rows.Next() {
		var resource activitystats.Resource
		if err := rows.Scan(&resource.ServerID, &resource.Name); err != nil {
			return nil, err
		}
		resources = append(resources, resource)
	}
	return resources, rows.Err()
}
