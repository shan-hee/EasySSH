package content

import (
	"errors"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/google/uuid"
)

func TestTaskActivitySharesBodyAndRetainsItAfterTaskCleanup(t *testing.T) {
	bodies, db, _, actor, authority := contentFixture(t)
	ctx := contentContext(t, actor, authority)
	repo := taskcenter.NewRepository(db, bodies)
	run := taskcenter.TaskRun{Actor: actor, TaskType: "command", SourceType: "docker", SourceID: uuid.NewString(), Title: "observed work", PayloadJSON: strings.Repeat("input", 10000)}
	if err := repo.CreateWithEvent(ctx, &run, &taskcenter.TaskEvent{Level: "info", Message: "queued"}); err != nil {
		t.Fatal(err)
	}
	first, err := repo.Details(ctx, run.ID)
	if err != nil || first.Content.Content == nil {
		t.Fatal("missing task body", err)
	}
	output := `{"output":"` + strings.Repeat("observed", 10000) + `"}`
	if _, err := repo.UpdateIfStatus(ctx, run.ID, []taskcenter.Status{taskcenter.StatusQueued}, map[string]interface{}{"status": taskcenter.StatusSucceeded, "result_json": output}); err != nil {
		t.Fatal(err)
	}
	detail, err := repo.Details(ctx, run.ID)
	if err != nil || detail.Content.Content == nil {
		t.Fatal(err)
	}
	ref := *detail.Content.Content
	var record operationrecord.OperationRecord
	if err := db.Where("source_table='task_runs' AND source_id=?", run.ID.String()).First(&record).Error; err != nil {
		t.Fatal(err)
	}
	if record.DetailJSON != "" || record.TaskContentID == nil || *record.TaskContentID != ref.ID {
		t.Fatal("activity duplicated result instead of retaining the task body")
	}
	got, err := operationrecord.NewRepository(db, nil).GetByID(ctx, record.ID)
	if err != nil || got.TaskContent == nil || *got.TaskContent != ref {
		t.Fatal("activity descriptor mismatch", err)
	}
	if _, err := bodies.Reference(ctx, first.Content.Content.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("old activity version stayed readable", err)
	}
	if err := db.Delete(&taskcenter.TaskRun{}, "id=?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := bodies.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	if kept, err := bodies.Reference(ctx, ref.ID); err != nil || kept != ref {
		t.Fatal("task cleanup removed activity history", err)
	}
	if decoded := readTaskBody(t, bodies, ctx, detail.Content); decoded.ResultJSON != output {
		t.Fatal("activity lost result")
	}
	foreign := actor
	foreign.ID = uuid.NewString()
	foreign.SessionID = foreign.ID
	if _, err := bodies.Reference(contentContext(t, foreign, &contentAuthority{}), ref.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("retained activity crossed session boundary", err)
	}
	if err := db.Unscoped().Delete(&record).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := bodies.Reference(ctx, ref.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("deleted activity stayed readable", err)
	}
	if err := bodies.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&Record{}).Where("source_type='task_body'").Count(&count).Error; err != nil || count != 0 {
		t.Fatal("unreferenced bodies retained", count, err)
	}
}
