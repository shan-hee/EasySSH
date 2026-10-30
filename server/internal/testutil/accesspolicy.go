// Package testutil contains fixtures used only by test files.
package testutil

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
)

// AccessPolicy supplies explicit denials for capabilities outside a fixture's scope.
// Authorize must be implemented by each fixture. Owner listing preserves the
// unrestricted nil server filter used by production owner policies.
type AccessPolicy struct{}

func (AccessPolicy) ServerIDs(_ context.Context, actor protocol.Actor) ([]string, error) {
	if actor.Kind == protocol.Owner {
		return nil, nil
	}
	return nil, access.ErrForbidden
}
func (AccessPolicy) AuthorizeInteractive(context.Context, protocol.Actor, string) error {
	return access.ErrForbidden
}
func (AccessPolicy) OpenWork(context.Context, access.Scope, access.WorkKind, ...access.Requirement) (*access.Lease, error) {
	return nil, access.ErrForbidden
}
func (AccessPolicy) Charge(context.Context, access.Scope, access.Requirement, int64) error {
	return access.ErrForbidden
}
func (AccessPolicy) CheckBytes(context.Context, access.Scope, access.Requirement, int64) error {
	return access.ErrForbidden
}
func (AccessPolicy) ReserveBytes(context.Context, access.Scope, access.Requirement, int) (int, func(int) error, error) {
	return 0, nil, access.ErrForbidden
}
