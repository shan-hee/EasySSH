package server

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/google/uuid"
)

func TestServerConfigurationRetainsFactsAndDeletedResourceSnapshot(t *testing.T) {
	repo, db := newServerTestRepository(t)
	ctx := operationrecord.WithRequestMetadata(groupContext(t, false), operationrecord.RequestMetadata{Username: "owner", IP: "192.0.2.1", UserAgent: "test-client"})
	row := &Server{ID: uuid.New(), Name: "original", Host: "host.test", Username: "owner", Tags: []string{"prod"}, Auth: ServerAuth{AuthMethod: AuthMethodPassword, Password: "secret-never-in-activity"}}
	if err := repo.Create(ctx, row); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.FindByID(ctx, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.Update(ctx, stored); err != nil {
		t.Fatal(err)
	}
	stored.Name = "renamed"
	if err := repo.Update(ctx, stored); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(ctx, row.ID); err != nil {
		t.Fatal(err)
	}
	var facts []operationrecord.OperationRecord
	if err := db.Order("created_at,id").Find(&facts).Error; err != nil {
		t.Fatal(err)
	}
	if len(facts) != 3 {
		t.Fatalf("no-op created activity or mutation omitted: %d", len(facts))
	}
	names := map[string]string{"server_create": "original", "server_update": "renamed", "server_delete": "renamed"}
	for _, fact := range facts {
		if fact.Actor != access.Current(ctx).Actor() || fact.Username != "owner" || fact.IP != "192.0.2.1" || fact.UserAgent != "test-client" || fact.Status != operationrecord.StatusSuccess || fact.TotalCount != 1 || fact.SuccessCount != 1 || fact.ServerID == nil || *fact.ServerID != row.ID || fact.ServerName != names[fact.Action] {
			t.Fatalf("configuration identity or outcome lost: %+v", fact)
		}
		if strings.Contains(fact.DetailJSON, row.Auth.Password) || strings.Contains(fact.DetailJSON, row.Host) {
			t.Fatal("configuration values entered activity metadata")
		}
		var detail struct {
			ChangedFields []string `json:"changed_fields"`
		}
		if err := json.Unmarshal([]byte(fact.DetailJSON), &detail); err != nil {
			t.Fatal(err)
		}
		if fact.Action == "server_update" && !reflect.DeepEqual(detail.ChangedFields, []string{"name"}) {
			t.Fatalf("wrong changed fields: %v", detail.ChangedFields)
		}
		var snapshot operationrecord.Resource
		if err := db.First(&snapshot, "record_id=? AND server_id=?", fact.ID, row.ID).Error; err != nil || snapshot.Name != names[fact.Action] {
			t.Fatalf("deleted resource lost snapshot: %+v %v", snapshot, err)
		}
	}
	result, err := operationrecord.NewRepository(db, nil).Overview(ctx, operationrecord.OverviewRequest{Timezone: "UTC", ServerID: &row.ID})
	if err != nil || result.Total != 3 || result.Volume.ConfigurationChanges != 3 || len(result.Servers) != 1 {
		t.Fatalf("configuration not discoverable by deleted server: %+v %v", result, err)
	}
	for _, work := range result.Records {
		if len(work.Resources) != 1 || !work.Resources[0].Deleted || work.Resources[0].Name != names[work.Action] {
			t.Fatalf("overview lost deleted resource state or snapshot: %+v", work.Resources)
		}
	}
}

func TestServerMutationRollsBackWhenActivityCannotBeSaved(t *testing.T) {
	for _, action := range []string{"create", "update", "delete", "reorder"} {
		t.Run(action, func(t *testing.T) {
			repo, db := newServerTestRepository(t)
			ctx := groupContext(t, false)
			first := &Server{ID: uuid.New(), Name: "first", Host: "host.test", Username: "owner", Tags: []string{"prod"}, Auth: ServerAuth{AuthMethod: AuthMethodPassword, Password: "saved-secret"}}
			second := &Server{ID: uuid.New(), Name: "second", Host: "host.test", Username: "owner", Auth: ServerAuth{AuthMethod: AuthMethodPassword}}
			for _, row := range []*Server{first, second} {
				if err := repo.Create(ctx, row); err != nil {
					t.Fatal(err)
				}
			}
			var before []Server
			if err := db.Preload("Auth").Preload("TagRecords").Order("id").Find(&before).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec(`CREATE TRIGGER reject_configuration BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
				t.Fatal(err)
			}
			var err error
			switch action {
			case "create":
				err = repo.Create(ctx, &Server{ID: uuid.New(), Name: "third", Host: "host.test", Username: "owner", Auth: ServerAuth{AuthMethod: AuthMethodPassword}})
			case "update":
				first.Name, first.Auth.Password, first.Tags = "changed", "different-secret", []string{"replacement"}
				err = repo.Update(ctx, first)
			case "delete":
				err = repo.Delete(ctx, first.ID)
			case "reorder":
				err = repo.Reorder(ctx, []uuid.UUID{second.ID, first.ID})
			}
			if err == nil {
				t.Fatal("mutation succeeded without its activity")
			}
			var after []Server
			if err := db.Preload("Auth").Preload("TagRecords").Order("id").Find(&after).Error; err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("activity failure left a partial configuration mutation")
			}
			var count int64
			if err := db.Model(&operationrecord.OperationRecord{}).Count(&count).Error; err != nil || count != 2 {
				t.Fatalf("unexpected activity after rollback: %d %v", count, err)
			}
		})
	}
}
