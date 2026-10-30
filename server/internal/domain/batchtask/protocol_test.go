package batchtask

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/easyssh/shared/protocol"
)

func TestBatchUpdatePreservesExplicitEmptyParameters(t *testing.T) {
	var omitted, cleared protocol.UpdateBatchTaskRequest
	if err := json.Unmarshal([]byte(`{}`), &omitted); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{"parameters":{},"script_version":""}`), &cleared); err != nil {
		t.Fatal(err)
	}
	if omitted.Parameters != nil || cleared.Parameters == nil || len(*cleared.Parameters) != 0 || cleared.ScriptVersion == nil {
		t.Fatal("omission and explicit clearing collapsed into one request")
	}
	data, err := json.Marshal(cleared)
	if err != nil {
		t.Fatal(err)
	}
	var roundTrip protocol.UpdateBatchTaskRequest
	if err := json.Unmarshal(data, &roundTrip); err != nil || roundTrip.Parameters == nil || roundTrip.ScriptVersion == nil {
		t.Fatalf("Go client dropped explicit clearing: %s %v", data, err)
	}
}

func TestBatchInvalidQueryStopsBeforeRepository(t *testing.T) {
	s := &service{}
	for _, input := range []protocol.ListBatchTasksRequest{{Page: -1}, {Page: 1000001}, {Limit: -1}, {Limit: 101}, {Status: "other"}, {TaskType: "upload"}} {
		if _, err := s.ListBatchTasks(context.Background(), &input); !errors.Is(err, ErrInvalidBatchTaskData) {
			t.Fatalf("invalid query accepted: %+v %v", input, err)
		}
	}
}

func TestBatchRejectsDuplicateServerIdentitySpellings(t *testing.T) {
	s := &service{}
	task := BatchTask{TaskName: "command", TaskType: "command", Content: "uptime", ExecutionMode: "parallel", ServerIDs: []string{
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
	}}
	if err := s.validate(context.Background(), &task); !errors.Is(err, ErrInvalidBatchTaskData) {
		t.Fatalf("one server accepted twice under different UUID spellings: %v", err)
	}
}
