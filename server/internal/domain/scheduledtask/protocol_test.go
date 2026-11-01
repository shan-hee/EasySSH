package scheduledtask

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/protocol"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func scheduledProtocolContext(t *testing.T) context.Context {
	t.Helper()
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString()}, time.Now().Add(time.Hour), stageTestAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}

func TestScheduledInvalidQueryStopsBeforeRepository(t *testing.T) {
	s := &service{}
	ctx := scheduledProtocolContext(t)
	for _, input := range []protocol.ListScheduledTasksRequest{{Page: -1}, {Page: 1000001}, {Limit: -1}, {Limit: 101}, {TaskType: "other"}} {
		if _, err := s.ListScheduledTasks(ctx, &input); !errors.Is(err, ErrInvalidScheduledTaskData) {
			t.Fatalf("invalid query accepted: %+v %v", input, err)
		}
	}
}

func TestScheduledExplicitClearSurvivesGoClient(t *testing.T) {
	var input protocol.UpdateScheduledTaskRequest
	if err := json.Unmarshal([]byte(`{"description":"","server_ids":[],"enabled":false}`), &input); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var decoded protocol.UpdateScheduledTaskRequest
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Description == nil || *decoded.Description != "" || decoded.Enabled == nil || *decoded.Enabled || decoded.ServerIDs == nil || len(*decoded.ServerIDs) != 0 {
		t.Fatalf("explicit clear or disable lost: %s", encoded)
	}
}

func TestScheduledDisableAndTypeReplacement(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	if err := db.AutoMigrate(&ScheduledTask{}, &serverdomain.Server{}, &serverdomain.ServerAuth{}, &serverdomain.ServerTag{}, &serverdomain.ServerGroup{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
		t.Fatal(err)
	}
	s := NewService(NewRepository(db), nil)
	ctx := scheduledProtocolContext(t)
	disabled := false
	created, err := s.CreateScheduledTask(ctx, &protocol.CreateScheduledTaskRequest{
		TaskName: "check", TaskType: "command", Command: "uptime", ServerIDs: []string{uuid.NewString()},
		CronExpression: "0 * * * *", Enabled: &disabled, Description: "remove later",
	})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := s.GetScheduledTask(ctx, created.ID)
	if err != nil || stored.Enabled || stored.NextRunAt != nil {
		t.Fatalf("disabled task was enabled by ORM defaults: %+v %v", stored, err)
	}
	if err := s.ToggleTask(ctx, created.ID, true); err != nil {
		t.Fatal(err)
	}
	enabled, err := s.GetScheduledTask(ctx, created.ID)
	if err != nil || !enabled.Enabled || enabled.NextRunAt == nil {
		t.Fatalf("enabled task lacks next run: %+v %v", enabled, err)
	}
	if err := s.ToggleTask(ctx, created.ID, false); err != nil {
		t.Fatal(err)
	}
	empty := ""
	updated, err := s.UpdateScheduledTask(ctx, created.ID, &protocol.UpdateScheduledTaskRequest{
		TaskType: "sftp_download", PayloadJSON: `{"server_id":"` + created.ServerIDs[0] + `","remote_path":"/a"}`, Description: &empty,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Command != "" || updated.ScriptID != nil || len(updated.ServerIDs) != 0 || updated.Description != "" || updated.NextRunAt != nil {
		t.Fatalf("stale definition fields survived type replacement: %+v", updated)
	}
	servers := []string{uuid.NewString()}
	updated, err = s.UpdateScheduledTask(ctx, created.ID, &protocol.UpdateScheduledTaskRequest{
		TaskType: "command", Command: "hostname", ServerIDs: &servers, PayloadJSON: `{"ignored":true}`,
	})
	if err != nil || updated.PayloadJSON != "" {
		t.Fatalf("normalized command retained transfer payload: %+v %v", updated, err)
	}
	servers = []string{}
	if _, err := s.UpdateScheduledTask(ctx, created.ID, &protocol.UpdateScheduledTaskRequest{ServerIDs: &servers}); !errors.Is(err, ErrInvalidScheduledTaskData) {
		t.Fatalf("empty command target list accepted: %v", err)
	}
}

func TestScheduledRejectsNullPayloadAndDuplicateIdentity(t *testing.T) {
	if isValidPayloadJSON("null") {
		t.Fatal("null accepted as a payload object")
	}
	s := &service{}
	task := ScheduledTask{TaskType: "command", Command: "uptime", ServerIDs: []string{
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
	}}
	if err := s.prepareExecution(context.Background(), &task); !errors.Is(err, ErrInvalidScheduledTaskData) {
		t.Fatalf("one server accepted under two spellings: %v", err)
	}
	if _, err := s.calculateNextRunTime("0 0 31 2 *", "UTC"); !errors.Is(err, ErrInvalidCronExpression) {
		t.Fatalf("unreachable calendar date accepted: %v", err)
	}
}
