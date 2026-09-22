package main

import (
	"context"
	"fmt"

	"github.com/easyssh/shared/aichatui"
)

func (s *DesktopAIService) resolveServerReferences(ctx context.Context, refs []aichatui.ServerReference) ([]aichatui.ServerReference, error) {
	return aichatui.ResolveServerReferences(refs, func(id string) (aichatui.ServerReference, error) {
		if err := ctx.Err(); err != nil {
			return aichatui.ServerReference{}, err
		}
		if s.serverService == nil {
			return aichatui.ServerReference{}, fmt.Errorf("服务器服务不可用")
		}
		server, err := s.serverService.GetById(id)
		if err != nil {
			return aichatui.ServerReference{}, err
		}
		return aichatui.ServerReference{ServerID: server.ID, Name: server.Name, Host: server.Host, Port: server.Port, Username: server.Username}, nil
	})
}

func (s *DesktopAIService) refreshRunServerReferences(ctx context.Context, record *desktopAISessionRecord) error {
	for i := len(record.Messages) - 1; i >= 0; i-- {
		message := &record.Messages[i]
		if message.Role != "user" {
			continue
		}
		if len(message.ServerReferences) == 0 {
			return nil
		}
		refs, err := s.resolveServerReferences(ctx, message.ServerReferences)
		if err != nil {
			return err
		}
		message.ServerReferences = refs
		if len(refs) == 1 {
			ref := refs[0]
			record.Scope = &DesktopAISessionScope{Kind: "terminal", ServerID: ref.ServerID, ServerName: ref.Name, Host: ref.Host, Port: ref.Port, Username: ref.Username}
		} else {
			record.Scope = nil
		}
		return nil
	}
	return nil
}
