package datasync

import (
	"context"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/schema"
	"time"
)

type Document string

func (Document) GormDataType() string { return "text" }
func (Document) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
	if db.Dialector.Name() == "mysql" {
		return "LONGTEXT"
	}
	return "TEXT"
}

type State struct {
	Disabled  bool      `gorm:"not null;default:false"`
	UserID    uuid.UUID `gorm:"type:char(36);primaryKey"`
	UpdatedAt time.Time
}

func (State) TableName() string { return "sync_states" }

type Device struct {
	Scopes     syncdata.SyncScopes `gorm:"type:text;serializer:json" json:"scopes"`
	ID         uuid.UUID           `gorm:"type:char(36);primaryKey" json:"id"`
	UserID     uuid.UUID           `gorm:"type:char(36);index;not null" json:"-"`
	Name       string              `gorm:"size:100;not null" json:"name"`
	TokenHash  string              `gorm:"size:64;uniqueIndex;not null" json:"-"`
	CreatedAt  time.Time           `json:"created_at"`
	ExpiresAt  time.Time           `json:"expires_at"`
	LastUsedAt *time.Time          `json:"last_used_at"`
}

func (Device) TableName() string { return "sync_devices" }

// Instance identifies a database independently of its public URL.
type Instance struct {
	ID   int       `gorm:"primaryKey"`
	UUID uuid.UUID `gorm:"type:char(36);not null"`
}

func (Instance) TableName() string { return "sync_instance" }

// Authorization is a short-lived browser approval request. Only hashes of the
// polling secret, browser code and eventual device credential are persisted.
type Authorization struct {
	ID             uuid.UUID `gorm:"type:char(36);primaryKey"`
	DeviceCodeHash string    `gorm:"size:64;uniqueIndex;not null"`
	UserCodeHash   string    `gorm:"size:64;uniqueIndex;not null"`
	TokenHash      string    `gorm:"size:64;not null"`
	Name           string    `gorm:"size:100;not null"`
	Status         string    `gorm:"size:20;not null"`
	ExpiresAt      time.Time `gorm:"index"`
}

func (Authorization) TableName() string { return "sync_authorizations" }
func (s *Service) InstanceID(ctx context.Context) (uuid.UUID, error) {
	row := Instance{ID: 1, UUID: uuid.New()}
	if err := s.DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
		return uuid.Nil, err
	}
	err := s.DB.WithContext(ctx).First(&row, "id = ?", 1).Error
	return row.UUID, err
}

type Service struct{ DB *gorm.DB }

func (s *Service) Enabled(ctx context.Context, owner uuid.UUID) (bool, error) {
	var state State
	result := s.DB.WithContext(ctx).Select("disabled").Where("user_id=?", owner).Limit(1).Find(&state)
	return !state.Disabled, result.Error
}
func (s *Service) SetEnabled(ctx context.Context, owner uuid.UUID, enabled bool) error {
	return s.DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{"disabled": !enabled, "updated_at": time.Now()}),
	}).Create(&State{UserID: owner, Disabled: !enabled}).Error
}
