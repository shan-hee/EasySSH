package datasync

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"time"
)

func (s *Service) Authorize(ctx context.Context, actor protocol.Actor, req access.Requirement) error {
	if actor.Kind != protocol.Device || !actor.Valid() {
		return access.ErrForbidden
	}
	switch req.Action {
	case protocol.SyncRead, protocol.SyncWrite, protocol.WorkspaceRead:
	default:
		return access.ErrForbidden
	}
	var device Device
	if err := s.DB.WithContext(ctx).Where("id = ? AND owner_id = ? AND revoked = ? AND expires_at > ?", actor.SessionID, actor.ID, false, time.Now().UTC()).First(&device).Error; err != nil {
		return access.ErrUnauthenticated
	}
	return nil
}
