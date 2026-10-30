package datasync

import (
	"time"

	servermodel "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Capture before applying changes so resource deletion cannot erase the names
// needed by the sync response. These values live only in the current transaction.
type syncGrantResource struct {
	GrantID    uuid.UUID
	GrantName  string
	ServerID   uuid.UUID
	ServerName string
	Revision   int64
}

func captureSyncGrantResources(tx *gorm.DB, ids []uuid.UUID) ([]syncGrantResource, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var rows []syncGrantResource
	err := tx.Table("grant_resources AS r").
		Select("r.grant_id, g.name AS grant_name, r.server_id, s.name AS server_name, s.connection_revision AS revision").
		Joins("JOIN grants AS g ON g.id=r.grant_id").Joins("JOIN servers AS s ON s.id=r.server_id").
		Where("r.server_id IN ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)", ids, time.Now().UTC()).
		Order("r.grant_id, r.server_id").Scan(&rows).Error
	return rows, err
}

func resolveSyncGrantChanges(tx *gorm.DB, before []syncGrantResource) ([]protocol.SyncAffectedGrant, error) {
	result := make([]protocol.SyncAffectedGrant, 0)
	if len(before) == 0 {
		return result, nil
	}
	ids := make([]uuid.UUID, 0, len(before))
	seen := map[uuid.UUID]bool{}
	for _, row := range before {
		if !seen[row.ServerID] {
			ids = append(ids, row.ServerID)
			seen[row.ServerID] = true
		}
	}
	var servers []servermodel.Server
	if err := tx.Select("id", "connection_revision").Where("id IN ?", ids).Find(&servers).Error; err != nil {
		return nil, err
	}
	current := make(map[uuid.UUID]int64, len(servers))
	for _, server := range servers {
		current[server.ID] = server.ConnectionRevision
	}
	for _, row := range before {
		revision, exists := current[row.ServerID]
		if exists && revision == row.Revision {
			continue
		}
		reason := protocol.SyncAffectedGrantReason("connection_changed")
		if !exists {
			reason = "resource_deleted"
		}
		result = append(result, protocol.SyncAffectedGrant{GrantID: row.GrantID, GrantName: row.GrantName, ServerID: row.ServerID, ServerName: row.ServerName, Reason: reason})
	}
	return result, nil
}
