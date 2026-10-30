package rest

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"testing"
	"time"
)

type aiTestAuthority struct {
	testutil.AccessPolicy
	runtime *access.Runtime
}

func (aiTestAuthority) Authorize(ctx context.Context, actor protocol.Actor, req access.Requirement) error {
	return ctx.Err()
}
func (a aiTestAuthority) OpenWork(ctx context.Context, scope access.Scope, kind access.WorkKind, requirements ...access.Requirement) (*access.Lease, error) {
	return a.runtime.Reserve(ctx, scope, kind, 0, requirements...)
}
func testAIActor(id uuid.UUID) protocol.Actor {
	return protocol.Actor{Kind: protocol.Owner, ID: id.String(), SessionID: id.String()}
}
func testAIContext(t *testing.T, id uuid.UUID) context.Context {
	t.Helper()
	runtime := access.NewRuntime()
	t.Cleanup(runtime.Close)
	scope, err := access.NewScope(testAIActor(id), time.Now().Add(time.Hour), aiTestAuthority{runtime: runtime})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}
