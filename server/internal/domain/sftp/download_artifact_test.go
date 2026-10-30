package sftp

import (
	"bytes"
	"context"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	pkgsftp "github.com/pkg/sftp"
)

// No ByteAllocator: artifact preparation must still authorize the source, but
// cannot spend the recipient's delivery budget at this stage.
type artifactTestAuthority struct {
	testutil.AccessPolicy
	denied bool
}

func (a *artifactTestAuthority) Authorize(ctx context.Context, _ protocol.Actor, _ access.Requirement) error {
	if a.denied {
		return access.ErrForbidden
	}
	return ctx.Err()
}

func TestArtifactPreparationAuthorizesWithoutChargingDelivery(t *testing.T) {
	remote := filepath.Join(t.TempDir(), "source")
	if err := os.WriteFile(remote, []byte("artifact source"), 0600); err != nil {
		t.Fatal(err)
	}
	clientConn, serverConn := net.Pipe()
	server, err := pkgsftp.NewServer(serverConn)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve() }()
	t.Cleanup(func() { _ = clientConn.Close(); _ = serverConn.Close(); <-done })
	raw, err := pkgsftp.NewClientPipe(clientConn, clientConn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	authority := &artifactTestAuthority{}
	id := uuid.NewString()
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Visitor, ID: id, SessionID: id, GrantID: uuid.NewString()}, time.Now().Add(time.Hour), authority)
	if err != nil {
		t.Fatal(err)
	}
	ctx := access.WithScope(context.Background(), scope)
	client := &Client{ctx: ctx, serverID: uuid.NewString(), sftpClient: raw}
	var body bytes.Buffer
	var copied int64
	if err := client.DownloadFileToArtifactWithContext(ctx, remote, &body, func(n int64) { copied = n }); err != nil {
		t.Fatal(err)
	}
	if body.String() != "artifact source" || copied != int64(body.Len()) {
		t.Fatal("artifact content or progress changed")
	}
	authority.denied = true
	body.Reset()
	if err := client.DownloadFileToArtifactWithContext(ctx, remote, &body, nil); !errors.Is(err, access.ErrForbidden) || body.Len() != 0 {
		t.Fatal("artifact staging bypassed resource authorization", err)
	}
}
