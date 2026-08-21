package auditlog

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

type flakyAuditRepository struct {
	Repository
	attempts int
}

type capturingAuditRepository struct {
	Repository
	request *ListAuditLogsRequest
}

func (r *capturingAuditRepository) List(_ context.Context, req *ListAuditLogsRequest) ([]*AuditLogSummary, int64, error) {
	r.request = req
	return nil, 0, nil
}

func (r *flakyAuditRepository) Create(context.Context, *AuditLog) error {
	r.attempts++
	if r.attempts < 3 {
		return errors.New("temporary database failure")
	}
	return nil
}

func TestServiceRetriesAuditWrites(t *testing.T) {
	repo := &flakyAuditRepository{}
	service := NewService(repo)
	err := service.Log(context.Background(), &CreateAuditLogRequest{
		UserID: uuid.New(), Username: "admin", Action: ActionSystemSettingsUpdate, Status: StatusSuccess,
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", repo.attempts)
	}
}

func TestServiceNormalizesListPagination(t *testing.T) {
	repo := &capturingAuditRepository{}
	service := NewService(repo)
	req := &ListAuditLogsRequest{Page: -1, PageSize: 1_000}
	if _, _, err := service.List(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if repo.request.Page != 1 || repo.request.PageSize != 100 {
		t.Fatalf("unexpected normalized pagination: page=%d page_size=%d", repo.request.Page, repo.request.PageSize)
	}
}
