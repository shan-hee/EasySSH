package operationrecord

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

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
	if err := db.AutoMigrate(&OperationRecord{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestListUsesSummaryAndDetailIsUserScoped(t *testing.T) {
	db := newOperationRecordTestDB(t)
	repo := NewRepository(db)
	userID := uuid.New()
	otherUserID := uuid.New()
	record := &OperationRecord{
		UserID: userID, Type: TypeAudit, Category: CategoryAudit, Action: "settings_update", Status: StatusSuccess,
		Title: "settings", UserAgent: "sensitive-agent", DetailJSON: `{"secret":"value"}`,
		SourceTable: "audit_events", SourceID: uuid.NewString(),
	}
	if err := repo.Upsert(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	response, err := repo.List(context.Background(), &ListRequest{UserID: &userID, Page: 1, PageSize: 20})
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
	keywordResult, err := repo.List(context.Background(), &ListRequest{UserID: &userID, Keyword: "secret", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if keywordResult.Total != 0 {
		t.Fatal("detail_json must not participate in broad list keyword searches")
	}
	detail, err := repo.GetByUserID(context.Background(), userID, record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.DetailJSON == "" || detail.UserAgent == "" {
		t.Fatal("detail query must return full record")
	}
	if _, err := repo.GetByUserID(context.Background(), otherUserID, record.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
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
