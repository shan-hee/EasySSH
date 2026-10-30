package server

import (
	"github.com/easyssh/shared/servertag"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Labels use their canonical, case-sensitive name as a natural key. Replacing
// one server's labels never renames a label on another server or sync space.
type Tag struct {
	Name string `gorm:"size:100;primaryKey"`
}

func (Tag) TableName() string { return "tags" }

type ServerTag struct {
	ServerID uuid.UUID `gorm:"type:char(36);primaryKey"`
	TagName  string    `gorm:"size:100;primaryKey;index:idx_server_tags_name"`
	Tag      Tag       `gorm:"foreignKey:TagName;references:Name;constraint:OnDelete:RESTRICT"`
}

func (ServerTag) TableName() string { return "server_tags" }

// SaveTags must run inside the same transaction as the resource write.
func (s *Server) SaveTags(tx *gorm.DB) error {
	tags, err := servertag.Normalize(s.Tags)
	if err != nil {
		return err
	}
	s.Tags = tags
	if err := tx.Where("server_id=?", s.ID).Delete(&ServerTag{}).Error; err != nil {
		return err
	}
	if len(tags) == 0 {
		return nil
	}
	definitions := make([]Tag, 0, len(tags))
	links := make([]ServerTag, 0, len(tags))
	for _, name := range tags {
		definitions = append(definitions, Tag{Name: name})
		links = append(links, ServerTag{ServerID: s.ID, TagName: name})
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&definitions).Error; err != nil {
		return err
	}
	return tx.Omit("Tag").Create(&links).Error
}
