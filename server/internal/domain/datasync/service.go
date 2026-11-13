package datasync

import (
	"context"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/script"
	servermodel "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sshkey"
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
	OwnerID   uuid.UUID `gorm:"type:char(36);primaryKey"`
	Document  Document
	Revision  uint64
	UpdatedAt time.Time
}

func (State) TableName() string { return "sync_states" }

type Device struct {
	Revoked    bool                `gorm:"not null;default:false" json:"revoked"`
	Scopes     syncdata.SyncScopes `gorm:"type:text;serializer:json" json:"scopes"`
	ID         uuid.UUID           `gorm:"type:char(36);primaryKey" json:"id"`
	OwnerID    uuid.UUID           `gorm:"type:char(36);index;not null" json:"-"`
	Name       string              `gorm:"size:100;not null" json:"name"`
	TokenHash  string              `gorm:"size:64;uniqueIndex;not null" json:"-"`
	CreatedAt  time.Time           `json:"created_at"`
	ExpiresAt  time.Time           `json:"expires_at"`
	LastUsedAt *time.Time          `json:"last_used_at"`
}

func (Device) TableName() string { return "owner_devices" }

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
	Content              *content.Service
	Encryptor            *crypto.Encryptor
	WithSessionSync      func(uuid.UUID, string, func() error) error
	InvalidateConnection func(uuid.UUID, uuid.UUID)
	InvalidateScript     func(string)
}

func Snapshot(tx *gorm.DB) (syncdata.Snapshot, error) {
	result := syncdata.Snapshot{}
	var servers []servermodel.Server
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Order("sort_order ASC, created_at ASC, id ASC").Preload("Auth.SSHKey").Preload("GroupRecord").Preload("TagRecords").Find(&servers).Error; err != nil {
		return nil, err
	}
	order := make([]string, 0, len(servers))
	for _, s := range servers {
		order = append(order, s.ID.String())
		groupID := ""
		if s.GroupID != nil {
			groupID = s.GroupID.String()
		}
		result["server/"+s.ID.String()] = syncdata.Record{"name": s.Name, "connection": syncdata.JSON(connectionSnapshot(s)), "group_id": groupID, "tags": syncdata.JSON(nonNil(s.Tags)), "description": s.Description}
	}
	var groups []servermodel.ServerGroup
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Find(&groups).Error; err != nil {
		return nil, err
	}
	for _, group := range groups {
		result["group/"+group.ID.String()] = syncdata.GroupRecord(group.Public())
	}
	result[syncdata.ServerOrderKey] = syncdata.Record{"ids": syncdata.JSON(order)}
	var scripts []script.Script
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Find(&scripts).Error; err != nil {
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

// InspectConfiguration reads persisted conflicts without reconciling or applying
// business data. Merely viewing settings must not create a sync state or revision.
func (s *Service) InspectConfiguration(ctx context.Context, owner uuid.UUID) (EngineResult, int64, error) {
	var state State
	if err := s.DB.WithContext(ctx).Where("owner_id = ?", owner).Limit(1).Find(&state).Error; err != nil {
		return EngineResult{}, 0, err
	}
	var servers, scripts, groups int64
	if err := s.DB.WithContext(ctx).Model(&servermodel.Server{}).Count(&servers).Error; err != nil {
		return EngineResult{}, 0, err
	}
	if err := s.DB.WithContext(ctx).Model(&script.Script{}).Count(&scripts).Error; err != nil {
		return EngineResult{}, 0, err
	}
	if err := s.DB.WithContext(ctx).Model(&servermodel.ServerGroup{}).Count(&groups).Error; err != nil {
		return EngineResult{}, 0, err
	}
	if state.Document == "" {
		return EngineResult{}, servers + scripts + groups, nil
	}
	result, err := runEngine(EngineInput{Document: string(state.Document), Inspect: true})
	return result, servers + scripts + groups, err
}

func (s *Service) Exchange(ctx context.Context, owner uuid.UUID, peer Peer, resolution *Resolution) (EngineResult, error) {
	var result EngineResult
	var changedConnections []uuid.UUID
	var changedScripts []string
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&State{OwnerID: owner}).Error; err != nil {
			return err
		}
		// A write first serializes per-owner exchanges and obtains SQLite's writer lock.
		if err := tx.Model(&State{}).Where("owner_id = ?", owner).UpdateColumn("revision", gorm.Expr("revision + 1")).Error; err != nil {
			return err
		}
		var state State
		if err := tx.First(&state, "owner_id = ?", owner).Error; err != nil {
			return err
		}
		current, err := Snapshot(tx)
		if err != nil {
			return err
		}
		result, err = runEngine(EngineInput{Document: string(state.Document), Current: current, Peer: peer, Resolution: resolution, Configuration: true})
		if err != nil {
			return err
		}
		for key, previous := range current {
			if strings.HasPrefix(key, "script/") {
				next, exists := result.Snapshot[key]
				if !exists || previous["content"] != next["content"] || previous["language"] != next["language"] {
					changedScripts = append(changedScripts, strings.TrimPrefix(key, "script/"))
				}
			}
			if strings.HasPrefix(key, "server/") && !syncdata.SameConnection(previous["connection"], result.Snapshot[key]["connection"]) {
				id, _ := uuid.Parse(strings.TrimPrefix(key, "server/"))
				changedConnections = append(changedConnections, id)
			}
		}
		if err = requireConfigSnapshot(result.Snapshot); err != nil {
			return err
		}
		grants, err := captureSyncGrantResources(tx, changedConnections)
		if err != nil {
			return err
		}
		if err = apply(tx, s.Encryptor, current, result.Snapshot); err != nil {
			return err
		}
		result.AffectedGrants, err = resolveSyncGrantChanges(tx, grants)
		if err != nil {
			return err
		}
		return tx.Model(&State{}).Where("owner_id = ?", owner).Updates(map[string]any{"document": result.Document, "updated_at": time.Now()}).Error
	})
	if err == nil && s.InvalidateConnection != nil {
		for _, id := range changedConnections {
			s.InvalidateConnection(owner, id)
		}
	}
	if err == nil && s.InvalidateScript != nil {
		for _, id := range changedScripts {
			s.InvalidateScript(id)
		}
	}
	return result, err
}
func apply(tx *gorm.DB, encryptor *crypto.Encryptor, before, after syncdata.Snapshot) error {
	if err := syncdata.Validate(after); err != nil {
		return err
	}
	// Dependencies precede resources; deleted groups clear references by FK.
	for key, record := range after {
		if !strings.HasPrefix(key, "group/") || syncdata.Equal(before[key], record) {
			continue
		}
		group, err := syncdata.ParseGroup(strings.TrimPrefix(key, "group/"), record)
		if err != nil {
			return err
		}
		if err := servermodel.SaveSyncGroup(tx, group); err != nil {
			return err
		}
		resources, err := syncGroupResources(tx, group.ID)
		if err != nil {
			return err
		}
		operation := "update"
		if before[key] == nil {
			operation = "create"
		}
		if err := recordSyncConfiguration(tx, "server_group", group.ID, group.Name, operation,
			syncdata.ConfigurationChangedFields(before[key], record, "name", "sort_order"), resources); err != nil {
			return err
		}
	}

	// The transaction temporarily disconnects only changed/deleted edges. This
	// permits deleting a whole route or replacing it without depending on map order.
	for key, old := range before {
		if !strings.HasPrefix(key, "server/") {
			continue
		}
		oldConn, err := syncdata.ParseConnection(old["connection"])
		if err != nil {
			return err
		}
		next := after[key]
		var nextJump string
		if next != nil {
			c, err := syncdata.ParseConnection(next["connection"])
			if err != nil {
				return err
			}
			nextJump = c.JumpServerID
		}
		if oldConn.JumpServerID != "" && (next == nil || oldConn.JumpServerID != nextJump) {
			if err := tx.Model(&servermodel.Server{}).Where("id=?", strings.TrimPrefix(key, "server/")).UpdateColumn("jump_server_id", nil).Error; err != nil {
				return err
			}
		}
	}
	// Groups precede servers so deleted groups retain their member snapshots.
	for _, key := range slices.Sorted(maps.Keys(before)) {
		if key == syncdata.ServerOrderKey {
			continue
		}
		if _, ok := after[key]; ok {
			continue
		}
		p := strings.SplitN(key, "/", 2)
		if err := recordSyncDeletion(tx, p[0], p[1]); err != nil {
			return err
		}
		var err error
		if p[0] == "server" {
			id, parseErr := uuid.Parse(p[1])
			if parseErr != nil {
				return parseErr
			}
			err = servermodel.DeleteConfiguration(tx, id)
		} else if p[0] == "group" {
			err = tx.Where("id = ?", p[1]).Delete(&servermodel.ServerGroup{}).Error
		} else {
			err = tx.Unscoped().Where("id = ?", p[1]).Delete(&script.Script{}).Error
		}
		if err != nil {
			return err
		}
	}
	for key, r := range after {
		if key == syncdata.ServerOrderKey || strings.HasPrefix(key, "group/") {
			continue
		}
		if syncdata.Equal(before[key], r) {
			continue
		}
		p := strings.SplitN(key, "/", 2)
		id, err := uuid.Parse(p[1])
		if err != nil {
			return err
		}
		operation := "update"
		if before[key] == nil {
			operation = "create"
		}
		if p[0] == "server" {
			conn, err := syncdata.ParseConnection(r["connection"])
			if err != nil {
				return err
			}
			var row servermodel.Server
			err = tx.Unscoped().Preload("Auth.SSHKey").Preload("GroupRecord").Preload("TagRecords").First(&row, "id = ?", id).Error
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if err == gorm.ErrRecordNotFound {
				row = servermodel.Server{ID: id, Status: servermodel.StatusOffline}
			}
			if old := before[key]; old != nil && !syncdata.SameConnection(old["connection"], r["connection"]) {
				row.ConnectionRevision++
				row.Auth.Password = ""
				row.Auth.SSHKeyID = nil
			}
			row.Name = r["name"]
			row.Host = conn.Host
			row.Port = conn.Port
			row.Username = conn.Username
			row.Auth.AuthMethod = servermodel.AuthMethod(conn.AuthMethod)
			row.Auth.SSHKeyID = nil
			row.Auth.SSHKey = nil
			if conn.Key != nil {
				key, err := sshkey.MergeSyncKey(tx, encryptor, conn.Key.Material())
				if err != nil {
					return err
				}
				row.Auth.SSHKeyID = &key.ID
				row.Auth.SSHKey = key
			}
			row.GroupID = nil
			if r["group_id"] != "" {
				groupID := uuid.MustParse(r["group_id"])
				row.GroupID = &groupID
			}
			row.GroupRecord = nil
			row.Tags = syncdata.Tags(r["tags"])
			row.Description = r["description"]
			row.DeletedAt = gorm.DeletedAt{}
			if err = tx.Unscoped().Omit("Auth", "GroupRecord", "TagRecords").Save(&row).Error; err != nil {
				return err
			}
			if err = row.SaveAuth(tx); err != nil {
				return err
			}
			if err = row.SaveTags(tx); err != nil {
				return err
			}
			if err = recordSyncConfiguration(tx, "server", id.String(), row.Name, operation,
				syncdata.ConfigurationChangedFields(before[key], r, "name", "connection", "group_id", "tags", "description"),
				[]operationrecord.ResourceSnapshot{{ServerID: row.ID, Name: row.Name}}); err != nil {
				return err
			}
		} else {
			var row script.Script
			err = tx.Unscoped().First(&row, "id = ?", id).Error
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if err == gorm.ErrRecordNotFound {
				row = script.Script{ID: id}
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
			if err = recordSyncConfiguration(tx, "script", id.String(), row.Name, operation,
				syncdata.ConfigurationChangedFields(before[key], r, "name", "content", "language", "tags", "description"), nil); err != nil {
				return err
			}
		}
	}
	// All referenced servers now exist, including newly synchronized jump hosts.
	for key, record := range after {
		if !strings.HasPrefix(key, "server/") {
			continue
		}
		conn, err := syncdata.ParseConnection(record["connection"])
		if err != nil {
			return err
		}
		var jumpID *uuid.UUID
		if conn.JumpServerID != "" {
			id := uuid.MustParse(conn.JumpServerID)
			jumpID = &id
		}
		if err := tx.Model(&servermodel.Server{}).Where("id=?", strings.TrimPrefix(key, "server/")).UpdateColumn("jump_server_id", jumpID).Error; err != nil {
			return err
		}
	}
	for key, old := range before {
		next := after[key]
		if !strings.HasPrefix(key, "server/") || next == nil || syncdata.SameConnection(old["connection"], next["connection"]) {
			continue
		}
		if _, err := servermodel.InvalidateJumpDependents(tx, uuid.MustParse(strings.TrimPrefix(key, "server/"))); err != nil {
			return err
		}
	}
	order, err := syncdata.OrderedServers(after)
	if err != nil {
		return err
	}
	var reordered []operationrecord.ResourceSnapshot
	for index, id := range order {
		result := tx.Model(&servermodel.Server{}).Where("id = ? AND (sort_order IS NULL OR sort_order <> ?)", id, index).UpdateColumn("sort_order", index)
		if result.Error != nil {
			return result.Error
		}
		// Initial placement is part of creation, not a second configuration task.
		if result.RowsAffected > 0 && before["server/"+id] != nil {
			reordered = append(reordered, operationrecord.ResourceSnapshot{ServerID: uuid.MustParse(id), Name: after["server/"+id]["name"]})
		}
	}
	if len(reordered) > 0 {
		return recordSyncConfiguration(tx, "server", syncdata.ServerOrderKey, "服务器排序", "reorder", []string{"sort_order"}, reordered)
	}
	return nil
}

func (s *Service) Enabled(ctx context.Context, owner uuid.UUID) (bool, error) {
	var state State
	result := s.DB.WithContext(ctx).Select("disabled").Where("owner_id=?", owner).Limit(1).Find(&state)
	return !state.Disabled, result.Error
}
func (s *Service) SetEnabled(ctx context.Context, owner uuid.UUID, enabled bool) error {
	return s.DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "owner_id"}},
		DoUpdates: clause.Assignments(map[string]any{"disabled": !enabled, "updated_at": time.Now()}),
	}).Create(&State{OwnerID: owner, Disabled: !enabled}).Error
}

func connectionSnapshot(row servermodel.Server) syncdata.Connection {
	c := syncdata.Connection{Host: row.Host, Port: row.Port, Username: row.Username, AuthMethod: string(row.Auth.AuthMethod)}
	if row.JumpServerID != nil {
		c.JumpServerID = row.JumpServerID.String()
	}
	if key := row.Auth.SSHKey; key != nil {
		c.Key = &syncdata.KeyReference{ID: key.ID.String(), Name: key.Name, PublicKey: key.PublicKey, Fingerprint: key.Fingerprint, Algorithm: key.Algorithm, KeySize: key.KeySize}
	}
	return c
}
