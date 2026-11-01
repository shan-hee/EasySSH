package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func setTestSessionPolicy(t *testing.T, s *Service, minutes int, remember bool) {
	t.Helper()
	config, err := s.security.Get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.db.Model(&security.SecurityConfig{}).Where("id=?", config.ID).Updates(map[string]any{"session_timeout": minutes, "remember_login": remember}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestLoginUsesConfiguredTimeoutAndRememberPolicy(t *testing.T) {
	s, _, owner, _, _ := ownerActivityFixture(t)
	for _, allowed := range []bool{false, true} {
		setTestSessionPolicy(t, s, 9, allowed)
		login, err := s.Login(context.Background(), protocol.OwnerLoginInput{Email: owner.Email, Password: activityPassword, Remember: true}, SessionInfo{})
		if err != nil {
			t.Fatal(err)
		}
		if login.Session.RememberLogin != allowed || login.Session.ExpiresAt.Sub(login.Session.LastActivity) != 9*time.Minute {
			t.Fatalf("settings ignored: %+v", login.Session)
		}
	}
}

func TestOwnerHTTPRenewalUpdatesLeaseAndRejectsInvalidCSRF(t *testing.T) {
	s, _, owner, _, _ := ownerActivityFixture(t)
	setTestSessionPolicy(t, s, 5, true)
	ctx := context.Background()
	token, csrf := uuid.NewString(), uuid.NewString()
	row := Session{OwnerID: owner.ID, TokenHash: ownerDigest(token), CSRFHash: ownerDigest(csrf), RememberLogin: true, LastActivity: time.Now().Add(-time.Minute), ExpiresAt: time.Now().Add(time.Minute)}
	if err := s.db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	scope, err := s.Restore(ctx, protocol.Actor{Kind: protocol.Owner, ID: owner.ID.String(), SessionID: row.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	lease, err := scope.OpenWork(ctx, access.Task, access.Requirement{Action: protocol.WorkspaceRead})
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close(nil)
	oldDeadline := access.Current(lease.Context()).ExpiresAt()
	for _, invalid := range []string{"", "wrong"} {
		if _, _, err := s.Authenticate(ctx, token, invalid, true); !errors.Is(err, access.ErrForbidden) {
			t.Fatalf("missing or invalid CSRF accepted: %v", err)
		}
	}
	var unchanged Session
	if err := s.db.First(&unchanged, "id=?", row.ID).Error; err != nil || !unchanged.ExpiresAt.Equal(row.ExpiresAt) {
		t.Fatalf("failed authentication renewed session: %v", err)
	}
	_, renewed, err := s.Authenticate(ctx, token, csrf, true)
	if err != nil {
		t.Fatal(err)
	}
	if renewed.ExpiresAt.Sub(renewed.LastActivity) != 5*time.Minute || !access.Current(lease.Context()).ExpiresAt().After(oldDeadline) {
		t.Fatal("HTTP activity did not renew both session and lease")
	}
	setTestSessionPolicy(t, s, 5, false)
	_, renewed, err = s.Authenticate(ctx, token, "", false)
	if err != nil || renewed.RememberLogin {
		t.Fatalf("disabled persistence remained active: %v", err)
	}
}

func TestShortenedIdleTimeoutCannotBeUndoneByIncreasingSetting(t *testing.T) {
	s, _, owner, _, _ := ownerActivityFixture(t)
	setTestSessionPolicy(t, s, 30, true)
	ctx := context.Background()
	token := uuid.NewString()
	row := Session{OwnerID: owner.ID, TokenHash: ownerDigest(token), CSRFHash: ownerDigest("csrf"), LastActivity: time.Now().Add(-6 * time.Minute), ExpiresAt: time.Now().Add(time.Hour)}
	if err := s.db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	scope, err := s.Restore(ctx, protocol.Actor{Kind: protocol.Owner, ID: owner.ID.String(), SessionID: row.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	lease, err := scope.OpenWork(ctx, access.Task, access.Requirement{Action: protocol.WorkspaceRead})
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close(nil)
	setTestSessionPolicy(t, s, 5, true)
	if _, _, err := s.Authenticate(ctx, token, "", false); !errors.Is(err, access.ErrExpired) {
		t.Fatalf("idle session accepted: %v", err)
	}
	if !errors.Is(context.Cause(lease.Context()), access.ErrExpired) {
		t.Fatal("expired owner session retained active work")
	}
	setTestSessionPolicy(t, s, 30, true)
	if _, _, err := s.Authenticate(ctx, token, "", false); err == nil {
		t.Fatal("increasing timeout revived an expired session")
	}
}
