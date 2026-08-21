package auditlog

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

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
	if err := db.AutoMigrate(&operationrecord.OperationRecord{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestListReturnsSummaryAndDetailRemainsAvailable(t *testing.T) {
	db := newAuditLogTestDB(t)
	repo := NewRepository(db)
	log := &AuditLog{
		UserID: uuid.New(), Username: "admin", Type: string(operationrecord.TypeAudit),
		Action: ActionSystemSettingsUpdate, Category: CategoryAudit, Resource: "system/settings",
		Source: "api", Status: StatusSuccess, IP: "127.0.0.1", UserAgent: "sensitive-agent",
		Details: `{"secret":"value"}`,
	}
	if err := repo.Create(context.Background(), log); err != nil {
		t.Fatal(err)
	}

	logs, total, err := repo.List(context.Background(), &ListAuditLogsRequest{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(logs) != 1 {
		t.Fatalf("expected one log, got total=%d rows=%d", total, len(logs))
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

	detail, err := repo.GetByID(context.Background(), log.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Details != log.Details || detail.UserAgent != log.UserAgent {
		t.Fatalf("detail query did not return full log: %#v", detail)
	}
}

func TestStatisticsAggregatesActionAcrossStatuses(t *testing.T) {
	db := newAuditLogTestDB(t)
	repo := NewRepository(db)
	for _, status := range []Status{StatusSuccess, StatusFailure} {
		if err := repo.Create(context.Background(), &AuditLog{
			UserID: uuid.New(), Action: ActionLogin, Category: CategoryAudit, Status: status,
		}); err != nil {
			t.Fatal(err)
		}
	}

	stats, err := repo.GetStatistics(context.Background(), &AuditLogStatisticsRequest{Days: 30})
	if err != nil {
		t.Fatal(err)
	}
	if stats.TotalLogs != 2 || stats.SuccessCount != 1 || stats.FailureCount != 1 {
		t.Fatalf("unexpected totals: %#v", stats)
	}
	if stats.ActionStats[ActionLogin] != 2 {
		t.Fatalf("expected action count 2, got %d", stats.ActionStats[ActionLogin])
	}
}
