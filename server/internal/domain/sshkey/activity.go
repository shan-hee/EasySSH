package sshkey

import (
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"gorm.io/gorm"
)

func recordKeyConfiguration(tx *gorm.DB, action string, key SSHKey, source string, fields []string) error {
	var resources []operationrecord.ResourceSnapshot
	if err := tx.Table("server_auth a").Select("s.id AS server_id, s.name").Joins("JOIN servers s ON s.id=a.server_id").Where("a.ssh_key_id=?", key.ID).Order("s.id").Scan(&resources).Error; err != nil {
		return err
	}
	return operationrecord.RecordConfiguration(tx, access.Current(tx.Statement.Context).Actor(), operationrecord.ConfigurationChange{
		Action: action, ResourceKind: "ssh_key", ResourceID: key.ID.String(), Name: key.Name,
		Source: source, Fields: fields, Resources: resources,
	})
}
