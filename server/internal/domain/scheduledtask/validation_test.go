package scheduledtask

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/script"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/protocol"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type stageTestAuthority struct {
	testutil.AccessPolicy
}

func (stageTestAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}

func TestScheduledStageRejectsChangedDefinitionAndScript(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	if err := db.AutoMigrate(&ScheduledTask{}, &serverdomain.Server{}, &serverdomain.ServerAuth{}, &serverdomain.ServerTag{}, &serverdomain.ServerGroup{}, &script.Script{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
		t.Fatal(err)
	}
	owner := uuid.New()
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: owner.String()}, time.Now().Add(time.Hour), stageTestAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := access.WithScope(context.Background(), scope)
	target := serverdomain.Server{ID: uuid.New(), Host: "test.invalid", Port: 22, Username: "fixture"}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	definition := ScheduledTask{ID: uuid.New(), OwnerID: owner, TaskName: "check", TaskType: "command", Command: "uptime", ServerIDs: []string{target.ID.String()}, Enabled: true, CronExpression: "0 * * * *", Timezone: "UTC"}
	repo := NewRepository(db)
	if err := repo.Create(ctx, &definition); err != nil {
		t.Fatal(err)
	}
	version := definition.Version()
	if err := repo.CheckStage(ctx, definition.ID, version, owner, true, target.ID.String()); err != nil {
		t.Fatal(err)
	}
	if err := repo.CheckStage(ctx, definition.ID, version, owner, true, uuid.NewString()); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("unlisted target accepted: %v", err)
	}
	if err := repo.UpdateRuntime(ctx, definition.ID, map[string]any{"run_count": 17, "next_run_at": time.Now()}); err != nil {
		t.Fatal(err)
	}
	if err := repo.CheckStage(ctx, definition.ID, version, owner, true, target.ID.String()); err != nil {
		t.Fatalf("runtime metadata invalidated execution: %v", err)
	}
	if err := repo.Update(ctx, definition.ID, map[string]any{"command": "changed"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.CheckStage(ctx, definition.ID, version, owner, true, target.ID.String()); !errors.Is(err, access.ErrResourceChanged) {
		t.Fatalf("old command version accepted: %v", err)
	}
	row := script.Script{ID: uuid.New(), Name: "check", Content: "echo first", Language: "bash"}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(script.ExecutionInput{Version: row.Version})
	if err := repo.Update(ctx, definition.ID, map[string]any{"task_type": "script", "script_id": row.ID, "payload_json": string(payload)}); err != nil {
		t.Fatal(err)
	}
	current, err := repo.GetByID(definition.ID)
	if err != nil {
		t.Fatal(err)
	}
	version = current.Version()
	if err := repo.CheckStage(ctx, current.ID, version, owner, true, target.ID.String()); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&script.Script{}).Where("id=?", row.ID).Update("content", "echo changed").Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.CheckStage(ctx, current.ID, version, owner, true, target.ID.String()); !errors.Is(err, access.ErrResourceChanged) {
		t.Fatalf("changed script executed: %v", err)
	}
	if err := repo.Update(ctx, definition.ID, map[string]any{"enabled": false}); err != nil {
		t.Fatal(err)
	}
	if err := repo.CheckStage(ctx, current.ID, version, owner, true, target.ID.String()); !errors.Is(err, access.ErrRevoked) {
		t.Fatalf("disabled schedule accepted: %v", err)
	}
	if err := repo.Delete(ctx, definition.ID); err != nil {
		t.Fatal(err)
	}
	if err := repo.CheckStage(ctx, current.ID, version, owner, false, target.ID.String()); err == nil {
		t.Fatal("deleted definition accepted")
	}
}
