package operationrecord

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRetentionKeepsWholeFamiliesAndUnknownObservationWindow(t *testing.T) {
	db := newOperationRecordTestDB(t)
	repo := NewRepository(db, nil)
	_, actor := activityTestContext(t)
	now := time.Now().UTC()
	old, recent := now.AddDate(0, 0, -300), now.AddDate(0, 0, -10)
	activeFamily, retryFamily, expiredFamily, uncertainFamily := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	rows := []OperationRecord{
		{WorkID: activeFamily, Status: StatusFailure, CreatedAt: old, FinishedAt: &old},
		{WorkID: uuid.New(), ParentWorkID: &activeFamily, Status: StatusRunning, CreatedAt: old},
		{WorkID: retryFamily, Attempt: 1, Status: StatusFailure, CreatedAt: old, FinishedAt: &old},
		{WorkID: retryFamily, Attempt: 2, Status: StatusSuccess, CreatedAt: recent, FinishedAt: &recent},
		{WorkID: expiredFamily, Attempt: 1, Status: StatusFailure, CreatedAt: old, FinishedAt: &old},
		{WorkID: expiredFamily, Attempt: 2, Status: StatusSuccess, CreatedAt: old, FinishedAt: &old},
		{WorkID: uuid.New(), ParentWorkID: &expiredFamily, Status: StatusSuccess, CreatedAt: old, FinishedAt: &old},
		{WorkID: uncertainFamily, Status: StatusUnknown, CreatedAt: old, FinishedAt: &old, ConnectionUncertainUntil: &recent},
	}
	for i := range rows {
		rows[i].Actor, rows[i].Type, rows[i].Action = actor, TypeExecution, "fixture"
		rows[i].SourceTable, rows[i].SourceID = "fixture", uuid.NewString()
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.EnsureCoverage(context.Background()); err != nil {
		t.Fatal(err)
	}
	count, err := repo.DeleteOld(context.Background(), now.AddDate(0, 0, -90), CategoryActivity)
	if err != nil || count != 3 {
		t.Fatalf("retention split or kept wrong family: %d %v", count, err)
	}
	var remaining int64
	if err = db.Unscoped().Model(&OperationRecord{}).Count(&remaining).Error; err != nil || remaining != 5 {
		t.Fatalf("retention was partial or only soft-deleted: %d %v", remaining, err)
	}
	var coverage Coverage
	if err = db.First(&coverage, "id=?", "activity").Error; err != nil || coverage.PrunedBefore == nil {
		t.Fatalf("coverage did not follow deletion: %+v %v", coverage, err)
	}
}

func TestRetentionCategoryCannotSplitMixedFamily(t *testing.T) {
	db := newOperationRecordTestDB(t)
	repo := NewRepository(db, nil)
	_, actor := activityTestContext(t)
	old := time.Now().UTC().AddDate(0, 0, -300)
	work := uuid.New()
	for _, category := range []Category{CategoryAudit, CategoryActivity} {
		row := OperationRecord{Actor: actor, WorkID: work, Type: TypeAudit, Category: category, Action: "fixture", Status: StatusSuccess, SourceTable: "fixture", SourceID: uuid.NewString(), CreatedAt: old, FinishedAt: &old}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if count, err := repo.DeleteOld(context.Background(), time.Now().AddDate(0, 0, -90), CategoryAudit); err != nil || count != 0 {
		t.Fatalf("category filter split family: %d %v", count, err)
	}
	if count, err := repo.DeleteOld(context.Background(), time.Now().AddDate(0, 0, -90), ""); err != nil || count != 2 {
		t.Fatalf("whole family did not expire: %d %v", count, err)
	}
}
