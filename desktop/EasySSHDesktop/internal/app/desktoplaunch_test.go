package app

import (
	"context"
	"testing"
	"time"

	"github.com/easyssh/easyssh-desktop/internal/accesslink"
	"github.com/google/uuid"
)

func TestIncomingLaunchDeduplicatesWithoutContactingSource(t *testing.T) {
	s := newDesktopRemoteWorkspaceService(nil, newDesktopNativeBoundary())
	defer s.cancel()
	raw, err := accesslink.DesktopLaunchURL("https://offline.example", uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := s.receiveLaunch(raw, time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	if len(s.incoming) != 1 || len(s.handoffs) != 0 || len(s.sessions) != 0 {
		t.Fatal("OS launch duplicated or established authority before the owner bound the receiver")
	}
	for id, value := range s.incoming {
		value.dismissed = true
		s.incoming[id] = value
	}
	if err := s.receiveLaunch(raw, time.Time{}); err != nil {
		t.Fatal(err)
	}
	if len(s.incoming) != 1 {
		t.Fatal("dismissed launch replayed")
	}
	for _, value := range s.incoming {
		if !value.dismissed {
			t.Fatal("dismissal was lost")
		}
	}
}

func TestIncomingLaunchCapacityExpiryAndNativeAuthority(t *testing.T) {
	s := newDesktopRemoteWorkspaceService(nil, newDesktopNativeBoundary())
	defer s.cancel()
	for i := 0; i < 16; i++ {
		raw, _ := accesslink.DesktopLaunchURL("https://offline.example", uuid.NewString())
		if err := s.receiveLaunch(raw, time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	raw, _ := accesslink.DesktopLaunchURL("https://offline.example", uuid.NewString())
	if err := s.receiveLaunch(raw, time.Time{}); err == nil {
		t.Fatal("incoming queue is unbounded")
	}
	for id, value := range s.incoming {
		value.ExpiresAt = time.Now().Add(-time.Second)
		s.incoming[id] = value
		break
	}
	if err := s.receiveLaunch(raw, time.Time{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PendingLaunches(context.Background()); err == nil {
		t.Fatal("untrusted caller read incoming launches")
	}
	if _, err := s.PendingHandoffs(context.Background()); err == nil {
		t.Fatal("untrusted caller read confirmations")
	}
	if err := s.DismissLaunch(context.Background(), uuid.NewString()); err == nil {
		t.Fatal("untrusted caller dismissed launch")
	}
}
