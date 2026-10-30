package aichat

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"

	"github.com/easyssh/shared/aichatui"
	"github.com/google/uuid"
)

func (s *ToolExecutorService) ResolveServerReferences(ctx context.Context, refs []aichatui.ServerReference) ([]aichatui.ServerReference, error) {
	return aichatui.ResolveServerReferences(refs, func(id string) (aichatui.ServerReference, error) {
		if err := access.Current(ctx).Check(ctx, access.Requirement{Action: protocol.AIUse, ServerID: id}); err != nil {
			return aichatui.ServerReference{}, err
		}
		serverID, err := uuid.Parse(id)
		if err != nil {
			return aichatui.ServerReference{}, err
		}
		server, err := s.serverService.GetByID(ctx, access.Current(ctx), serverID)
		if err != nil {
			return aichatui.ServerReference{}, err
		}
		return aichatui.ServerReference{ServerID: server.ID.String(), Name: server.Name, Host: server.Host, Port: server.Port, Username: server.Username}, nil
	})
}
