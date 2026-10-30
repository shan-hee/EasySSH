package datasync

import (
	"context"
	"maps"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/aiconfig"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/script"
	servermodel "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func syncActivityContext(t *testing.T, owner uuid.UUID) context.Context {
	t.Helper()
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Device, ID: owner.String(), SessionID: uuid.NewString()}, time.Now().Add(time.Hour), credentialDeleteAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}

func syncActivityFixture(t *testing.T) (*Service, context.Context, syncdata.Snapshot) {
	t.Helper()
	s := newSyncTestService(t)
	if err := s.DB.AutoMigrate(&servermodel.Server{}, &script.Script{}); err != nil {
		t.Fatal(err)
	}
	if err := s.DB.Exec("PRAGMA foreign_keys=ON").Error; err != nil {
		t.Fatal(err)
	}
	group, first, second, scriptID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	connection := syncdata.JSON(syncdata.Connection{Host: "host.test", Port: 22, Username: "owner", AuthMethod: "password"})
	return s, syncActivityContext(t, uuid.New()), syncdata.Snapshot{
		"group/" + group:        {"name": "production", "sort_order": "0"},
		"server/" + first:       {"name": "first", "connection": connection, "group_id": group, "tags": "[]", "description": ""},
		"server/" + second:      {"name": "second", "connection": connection, "group_id": group, "tags": "[]", "description": ""},
		"script/" + scriptID:    {"name": "inspect", "content": "echo private-command", "language": "bash", "tags": "[]", "description": ""},
		syncdata.ServerOrderKey: {"ids": syncdata.JSON([]string{first, second})},
	}
}

func applyActivitySnapshot(t *testing.T, s *Service, ctx context.Context, after syncdata.Snapshot) error {
	t.Helper()
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		before, err := Snapshot(tx)
		if err != nil {
			return err
		}
		return apply(tx, s.Encryptor, before, after)
	})
}

func TestSyncConfigurationActivityRetainsDeviceAndDeletedResources(t *testing.T) {
	s, ctx, desired := syncActivityFixture(t)
	for range 2 {
		if err := applyActivitySnapshot(t, s, ctx, desired); err != nil {
			t.Fatal(err)
		}
	}
	// Equivalent serialization must not count as another configuration change.
	formatted := make(syncdata.Snapshot, len(desired))
	for key, value := range desired {
		formatted[key] = maps.Clone(value)
		if strings.HasPrefix(key, "server/") || strings.HasPrefix(key, "script/") {
			delete(formatted[key], "description")
			formatted[key]["tags"] = "[ ]"
		}
		if strings.HasPrefix(key, "server/") {
			formatted[key]["connection"] = "  " + value["connection"] + "  "
		}
	}
	if err := applyActivitySnapshot(t, s, ctx, formatted); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := s.DB.Model(&operationrecord.OperationRecord{}).Count(&count).Error; err != nil || count != 4 {
		t.Fatalf("creation or replay double counted: %d %v", count, err)
	}
	for key, record := range desired {
		switch {
		case strings.HasPrefix(key, "group/"):
			record["name"] = "renamed-group"
		case strings.HasPrefix(key, "server/"):
			record["name"] += "-renamed"
		case strings.HasPrefix(key, "script/"):
			record["content"] = "echo updated-private-command"
		}
	}
	order, err := syncdata.OrderedServers(desired)
	if err != nil {
		t.Fatal(err)
	}
	desired[syncdata.ServerOrderKey]["ids"] = syncdata.JSON([]string{order[1], order[0]})
	for range 2 {
		if err := applyActivitySnapshot(t, s, ctx, desired); err != nil {
			t.Fatal(err)
		}
	}
	empty := syncdata.Snapshot{syncdata.ServerOrderKey: {"ids": "[]"}}
	for range 2 {
		if err := applyActivitySnapshot(t, s, ctx, empty); err != nil {
			t.Fatal(err)
		}
	}
	var facts []operationrecord.OperationRecord
	if err := s.DB.Find(&facts).Error; err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"server_create": 2, "server_update": 2, "server_delete": 2, "server_reorder": 1, "server_group_create": 1, "server_group_update": 1, "server_group_delete": 1, "script_create": 1, "script_update": 1, "script_delete": 1}
	got := map[string]int{}
	for _, fact := range facts {
		got[fact.Action]++
		if fact.Actor != access.Current(ctx).Actor() || fact.Source != "automation" || fact.TotalCount != 1 || fact.Status != operationrecord.StatusSuccess {
			t.Fatalf("lost sync attribution: %+v", fact)
		}
		if strings.Contains(fact.DetailJSON, "private-command") || strings.Contains(fact.DetailJSON, "host.test") {
			t.Fatal("configuration values copied into activity")
		}
		if fact.Action == "server_group_delete" || fact.Action == "server_reorder" {
			var resources []operationrecord.Resource
			if err := s.DB.Where("record_id=?", fact.ID).Find(&resources).Error; err != nil || len(resources) != 2 {
				t.Fatalf("resource snapshots lost: %+v %v", resources, err)
			}
			for _, resource := range resources {
				if !strings.HasSuffix(resource.Name, "-renamed") {
					t.Fatalf("wrong resource name: %+v", resource)
				}
			}
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("activity counts: got %v want %v", got, want)
	}
}

func TestSyncedAIConfigActivityIsAtomicAndDoesNotCountReencryption(t *testing.T) {
	s := newSyncTestService(t)
	owner := uuid.New()
	ctx := syncActivityContext(t, owner)
	payload := syncdata.VaultPayload{Kind: "ai_config", AIConfig: &protocol.AIConfigValue{
		Enabled: true, Provider: "openai", APIKey: "synced-secret", Models: []string{"model"},
	}}
	applyConfig := func() error {
		return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			return s.applyVault(tx, owner, "ai_config", syncdata.AIConfigID, payload)
		})
	}
	for range 2 {
		if err := applyConfig(); err != nil {
			t.Fatal(err)
		}
	}
	var facts []operationrecord.OperationRecord
	if err := s.DB.Find(&facts).Error; err != nil || len(facts) != 1 {
		t.Fatalf("AI sync replay counted: %d %v", len(facts), err)
	}
	if facts[0].Actor != access.Current(ctx).Actor() || facts[0].Source != "automation" || facts[0].Action != "ai_config_update" || strings.Contains(facts[0].DetailJSON, payload.AIConfig.APIKey) {
		t.Fatalf("invalid AI sync activity: %+v", facts[0])
	}
	var before aiconfig.Config
	if err := s.DB.First(&before, aiconfig.ConfigID).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.DB.Exec(`CREATE TRIGGER reject_ai_sync_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	payload.AIConfig.Models = []string{"changed-model"}
	if err := applyConfig(); err == nil {
		t.Fatal("AI sync committed without activity")
	}
	var after aiconfig.Config
	if err := s.DB.First(&after, aiconfig.ConfigID).Error; err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("AI sync not rolled back: %v", err)
	}
}

func TestSyncConfigurationActivityFailureRollsBackProjection(t *testing.T) {
	for _, operation := range []string{"create", "update", "delete", "reorder"} {
		t.Run(operation, func(t *testing.T) {
			s, ctx, desired := syncActivityFixture(t)
			if operation != "create" {
				if err := applyActivitySnapshot(t, s, ctx, desired); err != nil {
					t.Fatal(err)
				}
			}
			before, err := Snapshot(s.DB)
			if err != nil {
				t.Fatal(err)
			}
			switch operation {
			case "update":
				for key, row := range desired {
					if key != syncdata.ServerOrderKey {
						row["name"] += "-changed"
					}
				}
			case "delete":
				desired = syncdata.Snapshot{syncdata.ServerOrderKey: {"ids": "[]"}}
			case "reorder":
				order, err := syncdata.OrderedServers(desired)
				if err != nil {
					t.Fatal(err)
				}
				desired[syncdata.ServerOrderKey]["ids"] = syncdata.JSON([]string{order[1], order[0]})
			}
			if err := s.DB.Exec(`CREATE TRIGGER reject_sync_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
				t.Fatal(err)
			}
			if err := applyActivitySnapshot(t, s, ctx, desired); err == nil {
				t.Fatal("sync committed without activity")
			}
			after, err := Snapshot(s.DB)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatalf("projection not rolled back: %v", err)
			}
		})
	}
}

func TestSyncedPasswordActivityUsesPlainValueAndRollsBack(t *testing.T) {
	s, ctx, desired := syncActivityFixture(t)
	if err := applyActivitySnapshot(t, s, ctx, desired); err != nil {
		t.Fatal(err)
	}
	var row servermodel.Server
	if err := s.DB.Preload("Auth").First(&row).Error; err != nil {
		t.Fatal(err)
	}
	owner := uuid.MustParse(access.Current(ctx).Actor().ID)
	payload := syncdata.VaultPayload{Kind: "credential", Credential: &syncdata.Credential{Connection: syncdata.JSON(connectionSnapshot(row)), Password: "private-password"}}
	applyPassword := func() error {
		return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			return s.applyVault(tx, owner, "credential", row.ID.String(), payload)
		})
	}
	for range 2 {
		if err := applyPassword(); err != nil {
			t.Fatal(err)
		}
	}
	var facts []operationrecord.OperationRecord
	if err := s.DB.Where("action=?", "server_update").Find(&facts).Error; err != nil || len(facts) != 1 {
		t.Fatalf("password replay counted: %d %v", len(facts), err)
	}
	if facts[0].Actor != access.Current(ctx).Actor() || strings.Contains(facts[0].DetailJSON, payload.Credential.Password) || !strings.Contains(facts[0].DetailJSON, `"password"`) {
		t.Fatal("password change attribution or metadata incorrect")
	}
	var before servermodel.Server
	if err := s.DB.Preload("Auth").First(&before, "id=?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.DB.Exec(`CREATE TRIGGER reject_sync_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	payload.Credential.Password = "replacement-password"
	if err := applyPassword(); err == nil {
		t.Fatal("password changed without its activity")
	}
	var after servermodel.Server
	if err := s.DB.Preload("Auth").First(&after, "id=?", row.ID).Error; err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("password or revision not rolled back: %v", err)
	}
	// A transport retry with the same configuration is also a no-op.
	if err := applyActivitySnapshot(t, s, ctx, maps.Clone(desired)); err != nil {
		t.Fatal(err)
	}
}
