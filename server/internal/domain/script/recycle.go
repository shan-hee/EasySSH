package script

import (
	"time"

	"github.com/easyssh/server/internal/domain/recyclebin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type archivedScript struct {
	Version     string    `json:"version"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Content     string    `json:"content"`
	Language    string    `json:"language"`
	Tags        []string  `json:"tags"`
	Executions  int       `json:"executions"`
	Author      string    `json:"author"`
	CreatedAt   time.Time `json:"created_at"`
}

// DeleteArchived removes a script after copying it to the recycle bin. Owner
// edits and configuration sync both delete through it. A missing script is not
// an error for sync, which only needs it gone.
func DeleteArchived(tx *gorm.DB, id uuid.UUID) (Script, error) {
	var row Script
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", id).Error; err != nil {
		return row, err
	}
	archived := archivedScript{Version: row.Version, Name: row.Name, Description: row.Description, Content: row.Content,
		Language: row.Language, Tags: row.Tags, Executions: row.Executions, Author: row.Author, CreatedAt: row.CreatedAt}
	if err := recyclebin.Put(tx, recyclebin.KindScript, id.String(), row.Name, archived); err != nil {
		return row, err
	}
	// The scheduler reads Enabled before each dispatch. Persist the disabled
	// state with the deletion so restoring the same ID/version cannot resume it.
	if err := tx.Table("scheduled_tasks").Where("task_type = ? AND script_id = ?", "script", id).
		Updates(map[string]any{"enabled": false, "next_run_at": nil, "updated_at": time.Now().UTC()}).Error; err != nil {
		return row, err
	}
	return row, tx.Delete(&row).Error
}

// RestoreArchived writes a deleted script back under its original ID.
// Schedules that referenced it stopped when it was deleted and stay stopped.
func RestoreArchived(tx *gorm.DB, entry recyclebin.Entry) error {
	id, err := uuid.Parse(entry.ResourceID)
	if err != nil {
		return err
	}
	var archived archivedScript
	if err = recyclebin.Decode(entry, &archived); err != nil {
		return err
	}
	var count int64
	if err = tx.Model(&Script{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return recyclebin.ErrExists
	}
	row := Script{ID: id, Version: archived.Version, Name: archived.Name, Description: archived.Description, Content: archived.Content,
		Language: archived.Language, Tags: archived.Tags, Executions: archived.Executions, Author: archived.Author, CreatedAt: archived.CreatedAt}
	if err = tx.Create(&row).Error; err != nil {
		return err
	}
	return recordConfiguration(tx, "script_create", row, []string{"restored"})
}
