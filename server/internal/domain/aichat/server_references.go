package aichat

import (
	"context"

	"github.com/easyssh/shared/aichatui"
	"github.com/google/uuid"
)

func (s *ToolExecutorService) ResolveServerReferences(ctx context.Context, userID uuid.UUID, refs []aichatui.ServerReference) ([]aichatui.ServerReference, error) {
	return aichatui.ResolveServerReferences(refs, func(id string) (aichatui.ServerReference, error) {
		serverID, err := uuid.Parse(id)
		if err != nil {
			return aichatui.ServerReference{}, err
		}
		server, err := s.serverService.GetByID(ctx, userID, serverID)
		if err != nil {
			return aichatui.ServerReference{}, err
		}
		return aichatui.ServerReference{ServerID: server.ID.String(), Name: server.Name, Host: server.Host, Port: server.Port, Username: server.Username}, nil
	})
}
