package auth

import (
	"errors"
	"reflect"
	"testing"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
)

func monitorValue(value string) *string { return &value }

func TestMonitorPreferencesBindTokensAndSupportPartialUpdates(t *testing.T) {
	for _, source := range []string{"nezha", "komari"} {
		t.Run(source, func(t *testing.T) {
			s, ctx, owner, _, _ := ownerActivityFixture(t)
			input := protocol.OwnerMonitorInput{Source: source, Endpoint: monitorValue("https://monitor.example/base/"), Token: monitorValue("private-token"), SetActive: true}
			if err := s.UpdateMonitorDataSource(ctx, owner.ID, input); err != nil {
				t.Fatal(err)
			}
			read := func() Owner {
				t.Helper()
				var row Owner
				if err := s.db.First(&row, "id=?", owner.ID).Error; err != nil {
					t.Fatal(err)
				}
				return row
			}
			before := read()
			values := ownerPreferenceValues(before)
			if values[source+"_api_endpoint"] != "https://monitor.example/base" || values[source+"_api_token"] == "private-token" {
				t.Fatal("endpoint normalization or encryption missing")
			}
			for _, repeat := range []protocol.OwnerMonitorInput{input, {Source: source, SetActive: true}} {
				if err := s.UpdateMonitorDataSource(ctx, owner.ID, repeat); err != nil {
					t.Fatal(err)
				}
			}
			if !reflect.DeepEqual(before, read()) {
				t.Fatal("omission or reencryption changed saved configuration")
			}
			var count int64
			if err := s.db.Model(&operationrecord.OperationRecord{}).Count(&count).Error; err != nil || count != 1 {
				t.Fatalf("equivalent update counted: %d %v", count, err)
			}
			changed := protocol.OwnerMonitorInput{Source: source, Endpoint: monitorValue("https://different.example")}
			if err := s.UpdateMonitorDataSource(ctx, owner.ID, changed); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("old token moved to new destination: %v", err)
			}
			if !reflect.DeepEqual(before, read()) {
				t.Fatal("rejected destination partially changed config")
			}
			changed.Token = monitorValue("")
			if err := s.UpdateMonitorDataSource(ctx, owner.ID, changed); err != nil {
				t.Fatal(err)
			}
			values = ownerPreferenceValues(read())
			if values[source+"_api_token"] != "" || values[source+"_api_endpoint"] != *changed.Endpoint {
				t.Fatal("explicit clear failed")
			}
			if err := s.UpdateMonitorDataSource(ctx, owner.ID, protocol.OwnerMonitorInput{Source: source, Endpoint: monitorValue("")}); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("cleared active endpoint: %v", err)
			}
			if err := s.UpdateMonitorDataSource(ctx, owner.ID, protocol.OwnerMonitorInput{Source: "easyssh", SetActive: true}); err != nil {
				t.Fatal(err)
			}
			if err := s.UpdateMonitorDataSource(ctx, owner.ID, protocol.OwnerMonitorInput{Source: source, Endpoint: monitorValue(""), Token: monitorValue("")}); err != nil {
				t.Fatal(err)
			}
			if err := s.UpdateMonitorDataSource(ctx, owner.ID, protocol.OwnerMonitorInput{Source: source, SetActive: true}); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("selected unconfigured source: %v", err)
			}
		})
	}
}

func TestMonitorPreferencesRejectInvalidDestinationsAndRollbackClear(t *testing.T) {
	s, ctx, owner, _, _ := ownerActivityFixture(t)
	for _, endpoint := range []string{"ftp://example.test", "https://user:password@example.test", "https://example.test/?token=secret", "https://example.test/#part", "example.test", "https://"} {
		if err := s.UpdateMonitorDataSource(ctx, owner.ID, protocol.OwnerMonitorInput{Source: "nezha", Endpoint: &endpoint}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("accepted invalid endpoint %q: %v", endpoint, err)
		}
	}
	if err := s.UpdateMonitorDataSource(ctx, owner.ID, protocol.OwnerMonitorInput{Source: "easyssh", Token: monitorValue("ignored-secret")}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("built-in source accepted token: %v", err)
	}
	input := protocol.OwnerMonitorInput{Source: "nezha", Endpoint: monitorValue("https://first.example"), Token: monitorValue("stored-token")}
	if err := s.UpdateMonitorDataSource(ctx, owner.ID, input); err != nil {
		t.Fatal(err)
	}
	if err := s.db.Exec(`CREATE TRIGGER reject_monitor_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	input.Endpoint, input.Token = monitorValue("https://second.example"), monitorValue("")
	if err := s.UpdateMonitorDataSource(ctx, owner.ID, input); err == nil {
		t.Fatal("token clear committed without activity")
	}
	var row Owner
	if err := s.db.First(&row, "id=?", owner.ID).Error; err != nil {
		t.Fatal(err)
	}
	plain, err := s.decryptOwnerSecret(owner.ID, "nezha_api_token", row.NezhaAPIToken)
	if err != nil || plain != "stored-token" || row.NezhaAPIEndpoint != "https://first.example" {
		t.Fatalf("failed mutation did not preserve destination and token: %v", err)
	}
}
