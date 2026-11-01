package runtime

import "github.com/easyssh/shared/protocol"

func Overview(view *SessionView) *protocol.AISessionOverview {
	if view == nil {
		return nil
	}
	return &protocol.AISessionOverview{Actor: view.Actor, Title: view.Title, ID: view.ID, Model: view.Model, PermissionMode: view.PermissionMode, Scope: view.Scope, Status: view.Status, CreatedAt: view.CreatedAt, UpdatedAt: view.UpdatedAt, MessageCount: len(view.Messages), TaskCount: len(view.Tasks), DefaultTransport: view.DefaultTransport}
}
