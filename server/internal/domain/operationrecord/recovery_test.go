package operationrecord

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRecoveryPreservesUnknownOutcomeAndObservedCounts(t *testing.T) {
	db := newOperationRecordTestDB(t)
	repo := NewRepository(db, nil)
	ctx, actor := activityTestContext(t)
	day := time.Now().UTC().Truncate(24 * time.Hour)
	started, observed := day.Add(-2*time.Hour), day.Add(-time.Hour)
	connection := &OperationRecord{Actor: actor, Type: TypeConnection, Action: "ssh_connect", Status: StatusRunning, SourceTable: "terminal_sessions", SourceID: uuid.NewString(), CreatedAt: started, UpdatedAt: observed, StartedAt: &started, EstablishedAt: &started, TotalCount: 1}
	transfer := &OperationRecord{Actor: actor, Type: TypeTransfer, Action: "upload", Status: StatusRunning, SourceTable: "transfer_jobs", SourceID: uuid.NewString(), CreatedAt: started, UpdatedAt: observed, StartedAt: &started, TotalCount: 4, SuccessCount: 1, FailureCount: 1, BytesProcessed: 123}
	for _, record := range []*OperationRecord{connection, transfer} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.RecoverInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, record := range []*OperationRecord{connection, transfer} {
		var got OperationRecord
		if err := db.First(&got, "id = ?", record.ID).Error; err != nil {
			t.Fatal(err)
		}
		if record.Type == TypeTransfer {
			if got.Status != StatusRunning || got.FinishedAt != nil || !got.UpdatedAt.Equal(observed) || got.SuccessCount != 1 || got.FailureCount != 1 || got.BytesProcessed != 123 {
				t.Fatalf("activity recovery changed a transfer-owned result: %+v", got)
			}
			continue
		}
		if got.Status != StatusUnknown || got.FinishedAt == nil || !got.FinishedAt.Equal(observed) || got.SuccessCount != record.SuccessCount || got.FailureCount != record.FailureCount || got.BytesProcessed != record.BytesProcessed {
			t.Fatalf("recovery invented failure or lost observations: %+v", got)
		}
		if record.Type == TypeConnection && (got.ConnectionUncertainUntil == nil || got.ConnectionUncertainUntil.Before(day)) {
			t.Fatal("connection recovery lost its uncertainty bound")
		}
	}
	result, err := repo.Overview(ctx, OverviewRequest{Timezone: "UTC", Type: TypeConnection})
	if err != nil || result.ConnectionDurationMs != 0 || !result.ConnectionDurationIsLowerBound || result.Total != 1 || result.Volume.ConnectionFailures != 0 {
		t.Fatalf("SQL omitted the prior day's interrupted connection: %+v %v", result, err)
	}
	var first OperationRecord
	if err = db.First(&first, "id = ?", connection.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err = repo.RecoverInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	var again OperationRecord
	if err = db.First(&again, "id = ?", connection.ID).Error; err != nil || !again.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatalf("repeated recovery moved the interruption bound: %+v %v", again, err)
	}
}
