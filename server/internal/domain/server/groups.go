package server

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/servergroup"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrInvalidGroup = servergroup.ErrInvalid
var ErrGroupNotFound = errors.New("server group not found")

type ServerGroup struct {
	ID        uuid.UUID `gorm:"type:char(36);primaryKey"`
	Name      string    `gorm:"size:100;not null"`
	SortOrder int       `gorm:"not null;default:0"`
}

func (ServerGroup) TableName() string { return "server_groups" }
func (g ServerGroup) Public() protocol.ServerGroup {
	return protocol.ServerGroup{ID: g.ID.String(), Name: g.Name, SortOrder: g.SortOrder}
}

func resolveServerGroup(tx *gorm.DB, row *Server) error {
	row.Group, row.GroupRecord = "", nil
	if row.GroupID == nil {
		return nil
	}
	if *row.GroupID == uuid.Nil {
		return ErrInvalidGroup
	}
	var group ServerGroup
	if err := tx.First(&group, "id = ?", *row.GroupID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrGroupNotFound
		}
		return err
	}
	row.Group, row.GroupRecord = group.Name, &group
	return nil
}

// SaveSyncGroup participates in the configuration import transaction.
func SaveSyncGroup(tx *gorm.DB, group protocol.ServerGroup) error {
	input, err := servergroup.Normalize(protocol.ServerGroupInput{Name: group.Name, SortOrder: group.SortOrder})
	if err != nil || !servergroup.ValidID(group.ID) {
		return ErrInvalidGroup
	}
	row := ServerGroup{ID: uuid.MustParse(group.ID), Name: input.Name, SortOrder: input.SortOrder}
	return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.AssignmentColumns([]string{"name", "sort_order"})}).Create(&row).Error
}

type GroupService struct{ db *gorm.DB }

func NewGroupService(db *gorm.DB) *GroupService { return &GroupService{db: db} }
func (s *GroupService) List(ctx context.Context, page, limit int) (*protocol.ServerGroupPage, error) {
	if err := access.Current(ctx).RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return nil, err
	}
	if page < 1 || page > 1000000 || limit < 1 || limit > 100 {
		return nil, ErrInvalidGroup
	}
	result := &protocol.ServerGroupPage{Items: []protocol.ServerGroup{}, Page: page, Limit: limit}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&ServerGroup{}).Count(&result.Total).Error; err != nil {
			return err
		}
		var rows []ServerGroup
		if err := tx.Order("sort_order ASC,id ASC").Limit(limit).Offset((page - 1) * limit).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			result.Items = append(result.Items, row.Public())
		}
		return nil
	})
	return result, err
}
func (s *GroupService) Create(ctx context.Context, input protocol.ServerGroupInput) (protocol.ServerGroup, error) {
	if err := access.Current(ctx).RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return protocol.ServerGroup{}, err
	}
	input, err := servergroup.Normalize(input)
	if err != nil {
		return protocol.ServerGroup{}, err
	}
	row := ServerGroup{ID: uuid.New(), Name: input.Name, SortOrder: input.SortOrder}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return recordGroupConfiguration(tx, "server_group_create", row, []string{"created"})
	})
	return row.Public(), err
}
func (s *GroupService) Update(ctx context.Context, id uuid.UUID, input protocol.ServerGroupInput) (protocol.ServerGroup, error) {
	if err := access.Current(ctx).RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return protocol.ServerGroup{}, err
	}
	input, err := servergroup.Normalize(input)
	if err != nil || id == uuid.Nil {
		return protocol.ServerGroup{}, ErrInvalidGroup
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row ServerGroup
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id=?", id).Error; err != nil {
			return err
		}
		if row.Name == input.Name && row.SortOrder == input.SortOrder {
			return nil
		}
		fields := []string{}
		if row.Name != input.Name {
			fields = append(fields, "name")
		}
		if row.SortOrder != input.SortOrder {
			fields = append(fields, "sort_order")
		}
		if err := tx.Model(&row).Updates(map[string]any{"name": input.Name, "sort_order": input.SortOrder}).Error; err != nil {
			return err
		}
		row.Name, row.SortOrder = input.Name, input.SortOrder
		return recordGroupConfiguration(tx, "server_group_update", row, fields)
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrGroupNotFound
	}
	return protocol.ServerGroup{ID: id.String(), Name: input.Name, SortOrder: input.SortOrder}, err
}
func (s *GroupService) Delete(ctx context.Context, id uuid.UUID) error {
	if err := access.Current(ctx).RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row ServerGroup
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id=?", id).Error; err != nil {
			return err
		}
		// Snapshot membership before ON DELETE SET NULL removes the links.
		if err := recordGroupConfiguration(tx, "server_group_delete", row, []string{"deleted"}); err != nil {
			return err
		}
		return tx.Delete(&row).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrGroupNotFound
	}
	return err
}

func recordGroupConfiguration(tx *gorm.DB, action string, row ServerGroup, fields []string) error {
	var resources []operationrecord.ResourceSnapshot
	if err := tx.Model(&Server{}).Select("id AS server_id", "name").Where("group_id=?", row.ID).Order("id").Scan(&resources).Error; err != nil {
		return err
	}
	return operationrecord.RecordConfiguration(tx, access.Current(tx.Statement.Context).Actor(), operationrecord.ConfigurationChange{
		Action: action, ResourceKind: "server_group", ResourceID: row.ID.String(), Name: row.Name,
		Source: "manual", Fields: fields, Resources: resources,
	})
}
