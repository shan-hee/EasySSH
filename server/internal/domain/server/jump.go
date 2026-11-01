package server

import (
	"context"
	"fmt"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func jumpID(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}

func parseJumpID(value string) (*uuid.UUID, error) {
	if value == "" {
		return nil, nil
	}
	id, err := uuid.Parse(value)
	if err != nil || id == uuid.Nil || id.String() != value {
		return nil, fmt.Errorf("%w: invalid jump server ID", ErrInvalidServer)
	}
	return &id, nil
}

// Lock in a stable order before validating so concurrent edits cannot introduce
// a cycle. The FK also protects references against concurrent deletion.
func validateJumpServer(tx *gorm.DB, row *Server) error {
	var servers []Server
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "jump_server_id").Order("id").Find(&servers).Error; err != nil {
		return err
	}
	links := make(map[string]string, len(servers)+1)
	for _, item := range servers {
		links[item.ID.String()] = jumpID(item.JumpServerID)
	}
	links[row.ID.String()] = jumpID(row.JumpServerID)
	if err := sshutil.ValidateJumpServers(links); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidServer, err)
	}
	return nil
}

// JumpServers resolves the route only when a connection is requested. List and
// edit responses never load or disclose jump credentials.
func (s *Server) JumpServers(ctx context.Context) ([]*Server, error) {
	if s.JumpServerID == nil {
		return nil, nil
	}
	if s.jumpServerLoader == nil {
		return nil, fmt.Errorf("jump server resolver is unavailable")
	}
	return s.jumpServerLoader(ctx)
}

func (s *serverService) bindJumpServers(row *Server, scope access.Scope) {
	row.executionScope = scope
	row.jumpServerLoader = func(ctx context.Context) ([]*Server, error) {
		seen := map[uuid.UUID]bool{row.ID: true}
		next := row.JumpServerID
		var route []*Server
		for next != nil {
			if seen[*next] || len(route) >= sshutil.MaxJumpHops {
				return nil, fmt.Errorf("invalid jump server chain")
			}
			seen[*next] = true
			if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead, ServerID: next.String()}); err != nil {
				return nil, err
			}
			jump, err := s.repo.FindByID(ctx, *next)
			if err != nil {
				return nil, fmt.Errorf("jump server unavailable: %w", err)
			}
			jump.executionScope = scope
			route = append(route, jump)
			next = jump.JumpServerID
		}
		for i, j := 0, len(route)-1; i < j; i, j = i+1, j-1 {
			route[i], route[j] = route[j], route[i]
		}
		return route, nil
	}
}

// InvalidateJumpDependents updates descendants when a jump endpoint changes.
// A changed jump endpoint changes the effective connection of its descendants.
func InvalidateJumpDependents(tx *gorm.DB, id uuid.UUID) ([]string, error) {
	ids := []uuid.UUID{id}
	visited := map[uuid.UUID]bool{id: true}
	var affected []string
	for len(ids) > 0 {
		var children []Server
		if err := tx.Select("id").Where("jump_server_id IN ?", ids).Find(&children).Error; err != nil {
			return nil, err
		}
		ids = nil
		for _, child := range children {
			if visited[child.ID] {
				continue
			}
			visited[child.ID] = true
			ids = append(ids, child.ID)
			affected = append(affected, child.ID.String())
		}
		if len(ids) > 0 {
			if err := tx.Model(&Server{}).Where("id IN ?", ids).Updates(map[string]any{"connection_revision": gorm.Expr("connection_revision + 1"), "os": "", "status": StatusOffline}).Error; err != nil {
				return nil, err
			}
		}
	}
	return affected, nil
}
