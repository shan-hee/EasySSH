package server

import (
	"slices"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"gorm.io/gorm"
)

func serverActivityResource(row Server) operationrecord.ResourceSnapshot {
	return operationrecord.ResourceSnapshot{ServerID: row.ID, Name: row.Name}
}

func recordServerConfiguration(tx *gorm.DB, action string, row Server, fields []string) error {
	resource := serverActivityResource(row)
	name := row.Name
	if name == "" {
		name = row.Host
	}
	return operationrecord.RecordConfiguration(tx, access.Current(tx.Statement.Context).Actor(), operationrecord.ConfigurationChange{
		Action: action, ResourceKind: "server", ResourceID: row.ID.String(), Name: name,
		Source: "manual", Fields: fields, Resources: []operationrecord.ResourceSnapshot{resource},
	})
}

func serverChangedFields(before, after Server) []string {
	fields := []string{}
	sameGroup := before.GroupID == nil && after.GroupID == nil || before.GroupID != nil && after.GroupID != nil && *before.GroupID == *after.GroupID
	sameKey := before.Auth.SSHKeyID == nil && after.Auth.SSHKeyID == nil || before.Auth.SSHKeyID != nil && after.Auth.SSHKeyID != nil && *before.Auth.SSHKeyID == *after.Auth.SSHKeyID
	for _, field := range []struct {
		name    string
		changed bool
	}{
		{"name", before.Name != after.Name}, {"host", before.Host != after.Host}, {"port", before.Port != after.Port},
		{"username", before.Username != after.Username}, {"auth_method", before.Auth.AuthMethod != after.Auth.AuthMethod},
		{"jump_server_id", jumpID(before.JumpServerID) != jumpID(after.JumpServerID)}, {"group_id", !sameGroup}, {"tags", !slices.Equal(before.Tags, after.Tags)}, {"description", before.Description != after.Description},
		{"password", before.Auth.Password != after.Auth.Password}, {"ssh_key_id", !sameKey},
	} {
		if field.changed {
			fields = append(fields, field.name)
		}
	}
	return fields
}
