package datasync

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/script"
	servermodel "github.com/easyssh/server/internal/domain/server"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/schema"
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
	Document  Document
	Revision  uint64
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

type Service struct {
	DB                   *gorm.DB
	Encryptor            *crypto.Encryptor
	WithSessionSync      func(uuid.UUID, string, func() error) error
	Engine               *Engine
	InvalidateConnection func(uuid.UUID, uuid.UUID)
}

func Snapshot(tx *gorm.DB, owner uuid.UUID) (syncdata.Snapshot, error) {
	result := syncdata.Snapshot{}
	var servers []servermodel.Server
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", owner).Find(&servers).Error; err != nil {
		return nil, err
	}
	for _, s := range servers {
		result["server/"+s.ID.String()] = syncdata.Record{"name": s.Name, "connection": syncdata.JSON(syncdata.Connection{Host: s.Host, Port: s.Port, Username: s.Username, AuthMethod: string(s.AuthMethod)}), "group": s.Group, "tags": syncdata.JSON(nonNil(s.Tags)), "description": s.Description}
	}
	var scripts []script.Script
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", owner).Find(&scripts).Error; err != nil {
		return nil, err
	}
	for _, s := range scripts {
		result["script/"+s.ID.String()] = syncdata.Record{"name": s.Name, "content": s.Content, "language": s.Language, "tags": syncdata.JSON(nonNil(s.Tags)), "description": s.Description}
	}
	return result, nil
}
func nonNil(tags []string) []string {
	if tags == nil {
		return []string{}
	}
	return tags
}

func (s *Service) Exchange(ctx context.Context, owner uuid.UUID, peer Peer, resolution *Resolution) (EngineResult, error) {
	var result EngineResult
	var changedConnections []uuid.UUID
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&State{UserID: owner}).Error; err != nil {
			return err
		}
		// A write first serializes per-owner exchanges and obtains SQLite's writer lock.
		if err := tx.Model(&State{}).Where("user_id = ?", owner).UpdateColumn("revision", gorm.Expr("revision + 1")).Error; err != nil {
			return err
		}
		var state State
		if err := tx.First(&state, "user_id = ?", owner).Error; err != nil {
			return err
		}
		current, err := Snapshot(tx, owner)
		if err != nil {
			return err
		}
		result, err = s.Engine.Run(ctx, EngineInput{Document: string(state.Document), Current: current, Peer: peer, Resolution: resolution})
		if err != nil {
			return err
		}
		for key, previous := range current {
			if strings.HasPrefix(key, "server/") && previous["connection"] != result.Snapshot[key]["connection"] {
				id, _ := uuid.Parse(strings.TrimPrefix(key, "server/"))
				changedConnections = append(changedConnections, id)
			}
		}
		if err = requireConfigSnapshot(result.Snapshot); err != nil {
			return err
		}
		if err = apply(tx, owner, current, result.Snapshot); err != nil {
			return err
		}
		return tx.Model(&State{}).Where("user_id = ?", owner).Updates(map[string]any{"document": result.Document, "updated_at": time.Now()}).Error
	})
	if err == nil && s.InvalidateConnection != nil {
		for _, id := range changedConnections {
			s.InvalidateConnection(owner, id)
		}
	}
	return result, err
}
func apply(tx *gorm.DB, owner uuid.UUID, before, after syncdata.Snapshot) error {
	for key := range before {
		if _, ok := after[key]; ok {
			continue
		}
		p := strings.SplitN(key, "/", 2)
		var err error
		if p[0] == "server" {
			err = tx.Where("id = ? AND user_id = ?", p[1], owner).Delete(&servermodel.Server{}).Error
		} else {
			err = tx.Where("id = ? AND user_id = ?", p[1], owner).Delete(&script.Script{}).Error
		}
		if err != nil {
			return err
		}
	}
	for key, r := range after {
		if syncdata.Equal(before[key], r) {
			continue
		}
		p := strings.SplitN(key, "/", 2)
		id, err := uuid.Parse(p[1])
		if err != nil {
			return err
		}
		if p[0] == "server" {
			conn, err := syncdata.ParseConnection(r["connection"])
			if err != nil {
				return err
			}
			var row servermodel.Server
			err = tx.Unscoped().First(&row, "id = ?", id).Error
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if err == nil && row.UserID != owner {
				return fmt.Errorf("sync record belongs to another owner")
			}
			if err == gorm.ErrRecordNotFound {
				row = servermodel.Server{ID: id, UserID: owner, Status: servermodel.StatusOffline}
			}
			if old := before[key]; old != nil && old["connection"] != r["connection"] {
				row.Password = ""
				row.SSHKeyID = nil
			}
			row.Name = r["name"]
			row.Host = conn.Host
			row.Port = conn.Port
			row.Username = conn.Username
			row.AuthMethod = servermodel.AuthMethod(conn.AuthMethod)
			row.Group = r["group"]
			row.Tags = syncdata.Tags(r["tags"])
			row.Description = r["description"]
			row.DeletedAt = gorm.DeletedAt{}
			if err = tx.Unscoped().Omit("SSHKey").Save(&row).Error; err != nil {
				return err
			}
		} else {
			var row script.Script
			err = tx.Unscoped().First(&row, "id = ?", id).Error
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if err == nil && row.UserID != owner {
				return fmt.Errorf("sync record belongs to another owner")
			}
			if err == gorm.ErrRecordNotFound {
				row = script.Script{ID: id, UserID: owner}
			}
			row.Name = r["name"]
			row.Content = r["content"]
			row.Language = r["language"]
			row.Tags = syncdata.Tags(r["tags"])
			row.Description = r["description"]
			row.DeletedAt = gorm.DeletedAt{}
			if err = tx.Unscoped().Save(&row).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

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
