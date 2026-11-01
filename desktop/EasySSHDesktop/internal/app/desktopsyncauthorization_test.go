package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

func TestDeviceScopeRefreshNarrowsSelectionWithoutEnablingNewData(t *testing.T) {
	s := newDesktopSyncTestService(t)
	instance, owner := uuid.New(), uuid.New()
	identity := protocol.SyncIdentity{InstanceID: instance, UserID: owner, SpaceID: uuid.NewSHA1(instance, []byte(owner.String())), AccountName: "owner", Protocol: protocol.SyncIdentityProtocol(syncdata.ConfigurationProtocol), Grants: protocol.SyncScopes{Credentials: true}}
	exchanges := 0
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/sync/device/exchange" {
			exchanges++
			_ = json.NewEncoder(w).Encode(protocol.SyncExchangeResult{AffectedGrants: []protocol.SyncAffectedGrant{}})
			return
		}
		_ = json.NewEncoder(w).Encode(identity)
	}))
	defer remote.Close()
	if err := s.connect(remote.URL, "ess_sync_"+strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	if err := s.SetScopes(syncdata.SyncScopes{Credentials: true}); err != nil {
		t.Fatal(err)
	}
	before, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RefreshAuthorization(); err != nil {
		t.Fatal(err)
	}
	stable, err := s.Load()
	if err != nil || stable.Revision != before.Revision {
		t.Fatal("unchanged grants invalidated prepared sync", err)
	}
	identity.Grants = protocol.SyncScopes{AIConfig: true}
	if _, err := s.Exchange("{}", before.Revision); err == nil || exchanges != 0 {
		t.Fatal("scope change did not invalidate prepared exchange", err)
	}
	changed, err := s.Load()
	if err != nil || changed.Grants.Credentials || !changed.Grants.AIConfig || changed.Scopes.Credentials || changed.Scopes.AIConfig || changed.Revision <= before.Revision {
		t.Fatalf("scope refresh widened selection or kept revoked choice: %+v %v", changed, err)
	}
	identity.Grants.Credentials = true
	if _, err := s.RefreshAuthorization(); err != nil {
		t.Fatal(err)
	}
	expanded, err := s.Load()
	if err != nil || !expanded.Grants.Credentials || expanded.Scopes.Credentials {
		t.Fatal("grant expansion silently enabled credential sync", err)
	}
	if err := s.saveDeviceAuthorization(identity, before.Revision); err == nil {
		t.Fatal("stale identity response changed current device state")
	}
	identity.InstanceID = uuid.New()
	if _, err := s.RefreshAuthorization(); err == nil {
		t.Fatal("source identity change accepted")
	}
	final, err := s.Load()
	if err != nil || final.Revision != expanded.Revision || final.Grants != expanded.Grants {
		t.Fatal("invalid identity changed local authorization", err)
	}
}
