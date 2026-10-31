package vnc

import (
	"context"
	"errors"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Config intentionally contains no password. noVNC authenticates in the browser.
// The host is always taken from the server resource, never from a proxy request.
type Config struct {
	ServerID uuid.UUID `gorm:"type:char(36);primaryKey" json:"server_id"`
	Enabled  bool      `gorm:"not null" json:"enabled"`
	Port     int       `gorm:"not null" json:"port"`
	TLS      bool      `gorm:"column:tls;not null" json:"tls"`
}

func (Config) TableName() string { return "server_vnc_configs" }

type Service struct {
	db      *gorm.DB
	servers server.Service
	runtime *access.Runtime
}

func NewService(db *gorm.DB, servers server.Service, runtime *access.Runtime) *Service {
	return &Service{db: db, servers: servers, runtime: runtime}
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Config, error) {
	scope := access.Current(ctx)
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead, ServerID: id.String()}); err != nil {
		return Config{}, err
	}
	if _, err := s.servers.GetByID(ctx, scope, id); err != nil {
		return Config{}, err
	}
	if !scope.IsOwner() {
		if err := scope.Check(ctx, access.Requirement{Action: protocol.VNCConnect, ServerID: id.String()}); err != nil {
			return Config{}, err
		}
	}
	var cfg Config
	err := s.db.WithContext(ctx).First(&cfg, "server_id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Config{ServerID: id, Port: 5900}, nil
	}
	return cfg, err
}

func (s *Service) Save(ctx context.Context, id uuid.UUID, cfg Config) error {
	scope := access.Current(ctx)
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return errors.New("port must be between 1 and 65535")
	}
	srv, err := s.servers.GetByID(ctx, scope, id)
	if err != nil {
		return err
	}
	cfg.ServerID = id
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "server_id"}}, DoUpdates: clause.AssignmentColumns([]string{"enabled", "port", "tls"})}).Create(&cfg).Error; err != nil {
			return err
		}
		if err := tx.Model(&server.Server{}).Where("id = ?", id).Updates(map[string]any{"connection_revision": gorm.Expr("connection_revision + 1"), "updated_at": time.Now().UTC()}).Error; err != nil {
			return err
		}
		return operationrecord.RecordConfiguration(tx, scope.Actor(), operationrecord.ConfigurationChange{Action: "vnc_config_update", ResourceKind: "server", ResourceID: id.String(), Name: srv.Name, Source: "manual", Fields: []string{"vnc"}, Resources: []operationrecord.ResourceSnapshot{{ServerID: id, Name: srv.Name}}})
	})
	if err == nil {
		s.runtime.Invalidate("", "", id.String(), access.ErrResourceChanged)
	}
	return err
}

func (s *Service) Target(ctx context.Context, id uuid.UUID) (Config, string, error) {
	if err := access.Current(ctx).Check(ctx, access.Requirement{Action: protocol.VNCConnect, ServerID: id.String()}); err != nil {
		return Config{}, "", err
	}
	cfg, err := s.Get(ctx, id)
	if err != nil {
		return cfg, "", err
	}
	if !cfg.Enabled {
		return cfg, "", errors.New("VNC is disabled")
	}
	srv, err := s.servers.GetByID(ctx, access.Current(ctx), id)
	if err != nil {
		return cfg, "", err
	}
	return cfg, srv.Host, nil
}
