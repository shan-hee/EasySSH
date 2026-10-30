package operationrecord

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// The name belongs to the historical fact; deletion is observed at read time.
// Do not mutate historical rows or infer deletion from a visitor's permissions.
func readResourceSnapshots(tx *gorm.DB, ids []uuid.UUID) (map[uuid.UUID][]ResourceSnapshot, error) {
	var rows []struct {
		RecordID uuid.UUID
		ServerID uuid.UUID
		Name     string
		Deleted  bool
	}
	err := tx.Table("operation_resources AS r").
		Select("r.record_id,r.server_id,r.name,CASE WHEN s.id IS NULL THEN TRUE ELSE FALSE END AS deleted").
		Joins("LEFT JOIN servers s ON s.id=r.server_id AND s.deleted_at IS NULL").
		Where("r.record_id IN ?", ids).Order("r.server_id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[uuid.UUID][]ResourceSnapshot)
	for _, row := range rows {
		result[row.RecordID] = append(result[row.RecordID], ResourceSnapshot{ServerID: row.ServerID, Name: row.Name, Deleted: row.Deleted})
	}
	return result, nil
}
