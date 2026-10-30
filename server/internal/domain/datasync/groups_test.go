package datasync

import (
	"context"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"testing"
)

func TestGroupConcurrentRenameRetainsDependencyAndDeletionWins(t *testing.T) {
	s := newSyncTestService(t)
	ctx := context.Background()
	groupKey, serverKey := "group/"+uuid.NewString(), "server/"+uuid.NewString()
	makeSnapshot := func(name string) syncdata.Snapshot {
		return syncdata.Snapshot{
			groupKey:                {"name": name, "sort_order": "0"},
			serverKey:               {"name": "host", "connection": syncdata.JSON(syncdata.Connection{Host: "host.test", Port: 22, Username: "owner", AuthMethod: "password"}), "group_id": groupKey[6:], "tags": "[]"},
			syncdata.ServerOrderKey: {"ids": "[]"},
		}
	}
	run := func(input EngineInput) EngineResult {
		t.Helper()
		result, err := s.Engine.Run(ctx, input)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	base := run(EngineInput{Configuration: true, Current: makeSnapshot("base")})
	left := run(EngineInput{Configuration: true, Document: base.Document, Current: makeSnapshot("left")})
	right := run(EngineInput{Configuration: true, Document: base.Document, Current: makeSnapshot("right")})
	merged := run(EngineInput{Configuration: true, Document: left.Document, Current: left.Snapshot, Peer: Peer{Document: right.Document}})
	if len(merged.Conflicts) != 1 || merged.Conflicts[0].Key != groupKey || merged.Snapshot[groupKey]["name"] != "left" {
		t.Fatalf("rename conflict lost: %+v", merged)
	}
	fresh := run(EngineInput{Configuration: true, Current: syncdata.Snapshot{}, Peer: Peer{Document: merged.Document}})
	if fresh.Snapshot[groupKey] == nil || fresh.Snapshot[serverKey]["group_id"] != groupKey[6:] || len(fresh.Conflicts) != 1 {
		t.Fatal("new replica lost group dependency")
	}
	// A subsequent ordinary sync must preserve the unresolved conflict.
	again := run(EngineInput{Configuration: true, Document: fresh.Document, Current: fresh.Snapshot})
	if len(again.Conflicts) != 1 {
		t.Fatal("projection silently resolved rename")
	}
	delete(merged.Snapshot, groupKey)
	merged.Snapshot[serverKey]["group_id"] = ""
	removed := run(EngineInput{Configuration: true, Document: merged.Document, Current: merged.Snapshot})
	received := run(EngineInput{Configuration: true, Document: right.Document, Current: right.Snapshot, Peer: Peer{Document: removed.Document}})
	if received.Snapshot[groupKey] != nil || received.Snapshot[serverKey]["group_id"] != "" {
		t.Fatal("concurrent rename resurrected deleted group")
	}
}
