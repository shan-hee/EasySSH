package grant

import (
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func grantActivityResources(tx *gorm.DB, id uuid.UUID) ([]operationrecord.ResourceSnapshot, error) {
	var resources []operationrecord.ResourceSnapshot
	err := tx.Table("grant_resources AS r").Select("r.server_id, COALESCE(s.name, '') AS name").
		Joins("LEFT JOIN servers AS s ON s.id=r.server_id AND s.deleted_at IS NULL").
		Where("r.grant_id=?", id).Order("r.server_id").Scan(&resources).Error
	return resources, err
}

// Preserve removed resources as well as the current permission set. Metadata
// contains no link secret, permission parameter values or session credentials.
func recordGrantConfiguration(tx *gorm.DB, actor protocol.Actor, g Grant, action string, fields []string, previous []operationrecord.ResourceSnapshot) error {
	resources, err := grantActivityResources(tx, g.ID)
	if err != nil {
		return err
	}
	seen := make(map[uuid.UUID]bool, len(resources))
	for _, resource := range resources {
		seen[resource.ServerID] = true
	}
	for _, resource := range previous {
		if !seen[resource.ServerID] {
			resources = append(resources, resource)
			seen[resource.ServerID] = true
		}
	}
	return operationrecord.RecordConfiguration(tx, actor, operationrecord.ConfigurationChange{
		Action: action, ResourceKind: "grant", ResourceID: g.ID.String(), Name: g.Name,
		Source: "manual", Fields: fields, Resources: resources,
	})
}
