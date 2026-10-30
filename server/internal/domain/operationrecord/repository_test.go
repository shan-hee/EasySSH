package operationrecord

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func newOperationRecordTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&OperationRecord{}, &Resource{}, &Coverage{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE servers (id TEXT PRIMARY KEY, deleted_at DATETIME)").Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func TestListUsesSummaryAndDetailIsActorScoped(t *testing.T) {
	db := newOperationRecordTestDB(t)
	repo := NewRepository(db, nil)
	ctx, actor := activityTestContext(t)
	otherCtx, _ := activityTestContext(t)
	record := &OperationRecord{
		Actor: actor, Type: TypeAudit, Category: CategoryAudit, Action: "settings_update", Status: StatusSuccess,
		Title: "settings", UserAgent: "sensitive-agent", DetailJSON: `{"secret":"value"}`,
		SourceTable: "audit_events", SourceID: uuid.NewString(),
	}
	if err := repo.Upsert(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	response, err := repo.List(ctx, &ListRequest{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"detail_json", "user_agent", "sensitive-agent", "secret"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("list response contains detail value %q: %s", forbidden, raw)
		}
	}
	keywordResult, err := repo.List(ctx, &ListRequest{Keyword: "secret", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if keywordResult.Total != 0 {
		t.Fatal("detail_json must not participate in broad list keyword searches")
	}
	detail, err := repo.GetByID(ctx, record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.DetailJSON == "" || detail.UserAgent == "" {
		t.Fatal("detail query must return full record")
	}
	if _, err := repo.GetByID(otherCtx, record.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected scoped record not found, got %v", err)
	}
}

type flakyOperationRecordRepository struct {
	Repository
	attempts int
}

func (r *flakyOperationRecordRepository) Upsert(context.Context, *OperationRecord) error {
	r.attempts++
	if r.attempts < 3 {
		return errors.New("temporary database failure")
	}
	return nil
}

func TestServiceRetriesOperationRecordWrites(t *testing.T) {
	repo := &flakyOperationRecordRepository{}
	service := NewService(repo)
	if err := service.Upsert(context.Background(), &OperationRecord{}); err != nil {
		t.Fatal(err)
	}
	if repo.attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", repo.attempts)
	}
}

type activityTestAuthority struct {
	testutil.AccessPolicy
}

func (activityTestAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func activityTestContext(t *testing.T) (context.Context, protocol.Actor) {
	t.Helper()
	id := uuid.NewString()
	actor := protocol.Actor{Kind: protocol.Visitor, ID: id, SessionID: id, GrantID: uuid.NewString()}
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), activityTestAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope), actor
}
