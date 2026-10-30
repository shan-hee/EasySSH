package rest

import (
	"context"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/docker"
	"github.com/gin-gonic/gin"
)

type dockerDeniedAuthority struct {
	testutil.AccessPolicy

	requirement access.Requirement
	bounded     bool
}

func (a *dockerDeniedAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return access.ErrForbidden
}
func (a *dockerDeniedAuthority) OpenWork(ctx context.Context, scope access.Scope, kind access.WorkKind, requirements ...access.Requirement) (*access.Lease, error) {
	if len(requirements) == 1 {
		a.requirement = requirements[0]
	}
	deadline, ok := ctx.Deadline()
	a.bounded = ok && time.Until(deadline) <= 45*time.Second
	return nil, access.ErrForbidden
}

func TestDockerHandlersChooseExplicitAuthorityAndBoundLease(t *testing.T) {
	for _, tc := range []struct {
		name, method string
		action       protocol.Action
		invoke       func(*DockerHandler, *gin.Context)
	}{
		{"read-on-post", http.MethodPost, protocol.DockerRead, (*DockerHandler).ListContainers},
		{"manage-on-get", http.MethodGet, protocol.DockerManage, (*DockerHandler).StartContainer},
		{"remove-on-get", http.MethodGet, protocol.DockerManage, (*DockerHandler).RemoveContainer},
	} {
		t.Run(tc.name, func(t *testing.T) {
			authority := &dockerDeniedAuthority{}
			scope, err := access.NewScope(protocol.Actor{Kind: protocol.Visitor, ID: "session", SessionID: "session", GrantID: "grant"}, time.Now().Add(time.Hour), authority)
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Params = gin.Params{{Key: "serverId", Value: "server"}, {Key: "id", Value: "container"}}
			c.Request = httptest.NewRequest(tc.method, "/docker", nil).WithContext(access.WithScope(context.Background(), scope))
			// A denied request must return before touching the absent connection pool.
			tc.invoke(NewDockerHandler(docker.NewService(nil, nil, nil)), c)
			if response.Code != http.StatusForbidden || authority.requirement.Action != tc.action || authority.requirement.ServerID != "server" || !authority.bounded {
				t.Fatalf("incorrect authority or lifetime: %d %+v", response.Code, authority)
			}
		})
	}
}
