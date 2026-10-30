package auditlog

import (
	"context"
	"encoding/json"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func newAuditLogTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&operationrecord.OperationRecord{}, &operationrecord.Resource{}, &operationrecord.Coverage{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE servers (id TEXT PRIMARY KEY, deleted_at DATETIME)").Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func TestListReturnsSummaryAndDetailRemainsAvailable(t *testing.T) {
	db := newAuditLogTestDB(t)
	repo := NewRepository(db, nil)
	ctx, actor := auditTestContext(t)
	log := &AuditLog{
		Actor: actor, Username: "admin", Type: string(operationrecord.TypeAudit),
		Action: ActionSystemSettingsUpdate, Category: CategoryAudit, Resource: "system/settings",
		Source: "api", Status: StatusSuccess, IP: "127.0.0.1", UserAgent: "sensitive-agent",
		Details: `{"secret":"value"}`,
	}
	if err := repo.Create(context.Background(), log); err != nil {
		t.Fatal(err)
	}

	logs, total, err := repo.List(ctx, &ListAuditLogsRequest{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(logs) != 1 {
		t.Fatalf("expected one log, got total=%d rows=%d", total, len(logs))
	}
	if logs[0].Actor.ID != actor.ID || logs[0].Actor.SessionID != actor.SessionID {
		t.Fatal("generated activity summary lost the embedded actor columns")
	}
	raw, err := json.Marshal(logs)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"details", "user_agent", "sensitive-agent", "secret"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("list response contains detail value %q: %s", forbidden, raw)
		}
	}

	detail, err := repo.GetByID(ctx, log.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Details != log.Details || detail.UserAgent != log.UserAgent {
		t.Fatalf("detail query did not return full log: %#v", detail)
	}
}

func TestStatisticsAggregatesActionAcrossStatuses(t *testing.T) {
	db := newAuditLogTestDB(t)
	repo := NewRepository(db, nil)
	ctx, actor := auditTestContext(t)
	for _, status := range []Status{StatusSuccess, StatusFailure} {
		if err := repo.Create(context.Background(), &AuditLog{
			Actor: actor, Action: ActionLogin, Category: CategoryAudit, Status: status,
		}); err != nil {
			t.Fatal(err)
		}
	}

	stats, err := repo.GetStatistics(ctx, &AuditLogStatisticsRequest{Days: 30})
	if err != nil {
		t.Fatal(err)
	}
	if stats.TotalLogs != 2 || stats.SuccessCount != 1 || stats.FailureCount != 1 {
		t.Fatalf("unexpected totals: %#v", stats)
	}
	if stats.ActionStats[string(ActionLogin)] != 2 {
		t.Fatalf("expected action count 2, got %d", stats.ActionStats[string(ActionLogin)])
	}
}

func TestOverviewIncludesConfigurationWithoutCountingAuditReceipts(t *testing.T) {
	db := newAuditLogTestDB(t)
	repo := NewRepository(db, nil)
	records := operationrecord.NewRepository(db, nil)
	ctx, actor := auditTestContext(t)
	for _, entry := range []struct {
		action ActionType
		status Status
	}{
		{ActionServerUpdate, StatusSuccess},
		{ActionAIConfigUpdate, StatusFailure},
		{ActionServerGroupCreate, StatusSuccess},
		{ActionSSHKeyImport, StatusSuccess},
		{ActionGrantCreate, StatusSuccess},
		{ActionLogin, StatusSuccess},
		{ActionServerTest, StatusSuccess},
		{ActionScriptExecute, StatusSuccess},
		{ActionScheduledTaskTrigger, StatusSuccess},
		{ActionAuditLogsCleanup, StatusSuccess},
	} {
		if err := repo.Create(ctx, &AuditLog{Actor: actor, Action: entry.action, Status: entry.status}); err != nil {
			t.Fatal(err)
		}
	}
	execution := &operationrecord.OperationRecord{Actor: actor, Type: operationrecord.TypeExecution, Action: "script_execute", Status: operationrecord.StatusSuccess, SourceTable: "task_runs", SourceID: uuid.NewString()}
	if err := records.Upsert(ctx, execution); err != nil {
		t.Fatal(err)
	}
	all, err := records.Overview(ctx, operationrecord.OverviewRequest{Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	if all.Volume.Works != 6 || all.Volume.ConfigurationChanges != 5 || all.Volume.Executions != 1 || all.Total != 6 {
		t.Fatalf("configuration omitted or execution counted twice: %+v", all)
	}
	filtered, err := records.Overview(ctx, operationrecord.OverviewRequest{Timezone: "UTC", Type: operationrecord.TypeAudit})
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Total != 5 || len(filtered.Records) != 5 || filtered.Volume.ConfigurationChanges != 5 || filtered.Volume.ByStatus[operationrecord.StatusFailure] != 1 {
		t.Fatalf("configuration detail and aggregate disagree: %+v", filtered)
	}
	for _, row := range filtered.Records {
		if row.Actor != actor || row.TotalCount != 1 || row.SuccessCount+row.FailureCount != 1 || row.Category != operationrecord.CategoryAudit {
			t.Fatalf("configuration lost audit classification or result count: %+v", row)
		}
	}
}

func TestConfigurationRetentionMarksOverviewCoverageIncomplete(t *testing.T) {
	db := newAuditLogTestDB(t)
	repo := NewRepository(db, nil)
	records := operationrecord.NewRepository(db, nil)
	ctx, actor := auditTestContext(t)
	old := time.Now().UTC().AddDate(0, 0, -300)
	if err := repo.Create(ctx, &AuditLog{Actor: actor, Action: ActionServerUpdate, Status: StatusSuccess, CreatedAt: old}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&operationrecord.Coverage{ID: "activity", StartedAt: old.AddDate(0, 0, -1)}).Error; err != nil {
		t.Fatal(err)
	}
	before := time.Now().UTC().AddDate(0, 0, -90)
	if count, err := repo.DeleteOldLogs(ctx, before, CategoryAudit); err != nil || count != 1 {
		t.Fatalf("configuration retention: count=%d err=%v", count, err)
	}
	var coverage operationrecord.Coverage
	if err := db.First(&coverage, "id = ?", "activity").Error; err != nil || coverage.PrunedBefore == nil || !coverage.PrunedBefore.Equal(before) {
		t.Fatalf("removed configuration presented as known zero: %+v %v", coverage, err)
	}
	day := old.Format("2006-01-02")
	result, err := records.Overview(ctx, operationrecord.OverviewRequest{Range: "custom", StartDate: day, EndDate: day, Timezone: "UTC"})
	if err != nil || !result.Coverage.Known || result.Coverage.CompleteWindow || result.Total != 0 {
		t.Fatalf("pruned overview coverage: %+v %v", result, err)
	}
}

type auditTestAuthority struct {
	testutil.AccessPolicy
}

func (auditTestAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func auditTestContext(t *testing.T) (context.Context, protocol.Actor) {
	t.Helper()
	actor := protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), auditTestAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope), actor
}
