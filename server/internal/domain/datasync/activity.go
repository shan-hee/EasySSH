package datasync

import (
	"errors"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/script"
	servermodel "github.com/easyssh/server/internal/domain/server"
	"gorm.io/gorm"
)

func recordSyncConfiguration(tx *gorm.DB, kind, id, name, operation string, fields []string, resources []operationrecord.ResourceSnapshot) error {
	if len(fields) == 0 {
		return nil
	}
	return operationrecord.RecordConfiguration(tx, access.Current(tx.Statement.Context).Actor(), operationrecord.ConfigurationChange{
		Action: kind + "_" + operation, ResourceKind: kind, ResourceID: id, Name: name,
		Source: "automation", Fields: fields, Resources: resources,
	})
}

func syncGroupResources(tx *gorm.DB, id string) ([]operationrecord.ResourceSnapshot, error) {
	var resources []operationrecord.ResourceSnapshot
	err := tx.Model(&servermodel.Server{}).Select("id AS server_id", "name").Where("group_id=?", id).Order("id").Scan(&resources).Error
	return resources, err
}

// Read names before deletion; tombstones need not contain display metadata.
// The caller deletes the resource in this same transaction.
func recordSyncDeletion(tx *gorm.DB, kind, id string) error {
	var name string
	var resources []operationrecord.ResourceSnapshot
	var err error
	switch kind {
	case "server":
		var row servermodel.Server
		err = tx.First(&row, "id=?", id).Error
		name = row.Name
		resources = []operationrecord.ResourceSnapshot{{ServerID: row.ID, Name: row.Name}}
	case "group":
		kind = "server_group"
		var row servermodel.ServerGroup
		err = tx.First(&row, "id=?", id).Error
		name = row.Name
		if err == nil {
			resources, err = syncGroupResources(tx, id)
		}
	case "script":
		var row script.Script
		err = tx.First(&row, "id=?", id).Error
		name = row.Name
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	return recordSyncConfiguration(tx, kind, id, name, "delete", []string{"deleted"}, resources)
}
