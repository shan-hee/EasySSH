package syncengine

import (
	"reflect"
	"strings"
	"testing"

	"github.com/easyssh/shared/syncdata"
)

func TestLostResponseRetryDoesNotReplayAnOldEdit(t *testing.T) {
	for _, name := range []string{"name", "content"} {
		t.Run(name, func(t *testing.T) {
			hub, devices := scriptFixture(t, 2)
			left, right := devices[0], devices[1]
			left.data[scriptKey][name] = "one"
			prepared, err := Prepare(left.doc, left.data)
			if err != nil {
				t.Fatal(err)
			}
			left.doc = prepared.Document
			accepted, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: prepared.Response, Configuration: true})
			if err != nil {
				t.Fatal(err)
			}
			hub.doc, hub.data = accepted.Document, accepted.Snapshot
			// The response is lost. Another device sees the accepted edit and
			// deliberately supersedes it before the original device retries.
			sync(t, hub, right)
			right.data[scriptKey][name] = "two"
			sync(t, hub, right)
			retry, err := Prepare(left.doc, left.data)
			if err != nil || !reflect.DeepEqual(retry.Response, prepared.Response) {
				t.Fatal("durable request changed", err)
			}
			replayed, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: retry.Response, Configuration: true})
			if err != nil || replayed.Snapshot[scriptKey][name] != "two" || len(replayed.Conflicts) != 0 {
				t.Fatalf("retry overwrote later edit: %+v %v", replayed, err)
			}
			if replayed.Response.Sequence != prepared.Response.Sequence || replayed.Response.Cursor <= accepted.Response.Cursor {
				t.Fatalf("retry was not acknowledged from the current state: %+v", replayed.Response)
			}
			complete, err := Complete(left.doc, left.data, replayed.Response, true)
			if err != nil || complete.Snapshot[scriptKey][name] != "two" {
				t.Fatalf("later edit was not delivered with the acknowledgement: %+v %v", complete.Snapshot, err)
			}
			left.doc, left.data = complete.Document, complete.Snapshot
			hub.doc, hub.data = replayed.Document, replayed.Snapshot
			if conflicts := sync(t, hub, left); len(conflicts) != 0 || left.data[scriptKey][name] != "two" || hub.data[scriptKey][name] != "two" {
				t.Fatalf("retry disturbed the later edit: %+v", conflicts)
			}
		})
	}
}

func TestEditsDuringRequestSurviveCompletionAndRestart(t *testing.T) {
	for _, next := range []string{"echo base", "echo newer"} {
		t.Run(next, func(t *testing.T) {
			hub, devices := scriptFixture(t, 1)
			desktop := devices[0]
			desktop.data[scriptKey]["content"] = "echo sent"
			prepared, err := Prepare(desktop.doc, desktop.data)
			if err != nil {
				t.Fatal(err)
			}
			desktop.doc = prepared.Document
			accepted, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: prepared.Response, Configuration: true})
			if err != nil {
				t.Fatal(err)
			}
			hub.doc, hub.data = accepted.Document, accepted.Snapshot
			desktop.data[scriptKey]["content"] = next
			// A restarted client must retry the sent request, not recompute it
			// from the new business value (especially a revert to the old base).
			retry, err := Prepare(desktop.doc, desktop.data)
			if err != nil || !reflect.DeepEqual(retry.Response, prepared.Response) {
				t.Fatal("restart lost pending operation", err)
			}
			completed, err := Complete(retry.Document, desktop.data, accepted.Response, true)
			if err != nil || !completed.NeedsSync || completed.Snapshot[scriptKey]["content"] != next {
				t.Fatalf("local edit lost: %+v %v", completed, err)
			}
			desktop.doc, desktop.data = completed.Document, completed.Snapshot
			if conflicts := sync(t, hub, desktop); len(conflicts) != 0 || hub.data[scriptKey]["content"] != next {
				t.Fatalf("sequential edit conflicted: %+v", conflicts)
			}
		})
	}
}

func TestRetryCannotReuseSequenceWithDifferentPayload(t *testing.T) {
	hub, devices := scriptFixture(t, 1)
	desktop := devices[0]
	desktop.data[scriptKey]["name"] = "one"
	peer, err := Outgoing(desktop.doc, desktop.data)
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: peer, Configuration: true})
	if err != nil {
		t.Fatal(err)
	}
	peer.Changes[0].Value = "different"
	if _, err = Exchange(HubInput{Document: accepted.Document, Current: accepted.Snapshot, Peer: peer, Configuration: true}); err == nil {
		t.Fatal("accepted reused sequence")
	}
}

func TestVaultEditDuringRequestKeepsNewReference(t *testing.T) {
	current := syncdata.Snapshot{valueKey: {"ref": idA}}
	prepared, err := Prepare("", current)
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := Exchange(HubInput{Current: syncdata.Snapshot{}, Peer: prepared.Response})
	if err != nil {
		t.Fatal(err)
	}
	current[valueKey]["ref"] = idB
	completed, err := Complete(prepared.Document, current, accepted.Response, false)
	if err != nil || completed.Snapshot[valueKey]["ref"] != idB || !completed.NeedsSync {
		t.Fatalf("new vault version lost: %+v %v", completed, err)
	}
	peer, err := Outgoing(completed.Document, completed.Snapshot)
	if err != nil {
		t.Fatal(err)
	}
	result, err := Exchange(HubInput{Document: accepted.Document, Current: accepted.Snapshot, Peer: peer})
	if err != nil || len(result.Conflicts) != 0 || result.Snapshot[valueKey]["ref"] != idB {
		t.Fatalf("new vault version conflicted: %+v %v", result, err)
	}
}

func TestLocalEditDuringPullStillConflictsWithUnseenRemoteEdit(t *testing.T) {
	hub, devices := scriptFixture(t, 2)
	left, right := devices[0], devices[1]
	prepared, err := Prepare(left.doc, left.data)
	if err != nil {
		t.Fatal(err)
	}
	right.data[scriptKey]["content"] = "remote edit"
	sync(t, hub, right)
	answer, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: prepared.Response, Configuration: true})
	if err != nil {
		t.Fatal(err)
	}
	hub.doc, hub.data = answer.Document, answer.Snapshot
	left.data[scriptKey]["content"] = "local edit during pull"
	completed, err := Complete(prepared.Document, left.data, answer.Response, true)
	if err != nil {
		t.Fatal(err)
	}
	left.doc, left.data = completed.Document, completed.Snapshot
	conflicts := sync(t, hub, left)
	if len(conflicts) != 1 || !sameValues(conflicts[0].Values, []string{"remote edit", "local edit during pull"}) {
		t.Fatalf("unseen edit was overwritten: %+v", conflicts)
	}
}

func TestNewEditDuringConflictingRequestRemainsACandidate(t *testing.T) {
	hub, devices := scriptFixture(t, 2)
	left, right := devices[0], devices[1]
	right.data[scriptKey]["content"] = "remote"
	sync(t, hub, right)
	left.data[scriptKey]["content"] = "sent"
	prepared, err := Prepare(left.doc, left.data)
	if err != nil {
		t.Fatal(err)
	}
	answer, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: prepared.Response, Configuration: true})
	if err != nil {
		t.Fatal(err)
	}
	hub.doc, hub.data = answer.Document, answer.Snapshot
	left.data[scriptKey]["content"] = "newer"
	completed, err := Complete(prepared.Document, left.data, answer.Response, true)
	if err != nil {
		t.Fatal(err)
	}
	left.doc, left.data = completed.Document, completed.Snapshot
	// Another edit before the next request must replace the queued value.
	left.data[scriptKey]["content"] = "newest"
	conflicts := sync(t, hub, left)
	if len(conflicts) != 1 || !sameValues(conflicts[0].Values, []string{"remote", "sent", "newest"}) {
		t.Fatalf("latest local candidate lost: %+v", conflicts)
	}
}

func TestRetriedDeletionCannotDeleteARecreatedRecord(t *testing.T) {
	hub, devices := scriptFixture(t, 2)
	left, right := devices[0], devices[1]
	delete(left.data, scriptKey)
	prepared, err := Prepare(left.doc, left.data)
	if err != nil {
		t.Fatal(err)
	}
	answer, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: prepared.Response, Configuration: true})
	if err != nil {
		t.Fatal(err)
	}
	hub.doc, hub.data = answer.Document, answer.Snapshot
	sync(t, hub, right)
	right.data[scriptKey] = syncdata.Record{"name": "recreated", "content": "new content"}
	sync(t, hub, right)
	retry, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: prepared.Response, Configuration: true})
	if err != nil || retry.Snapshot[scriptKey]["content"] != "new content" {
		t.Fatalf("old deletion replayed: %+v %v", retry, err)
	}
}

func TestOrderEditDuringRequestToAHubWithoutServers(t *testing.T) {
	hub := &side{data: syncdata.Snapshot{orderKey: {"ids": "[]"}}}
	desktop := fresh()
	prepared, err := Prepare(desktop.doc, desktop.data)
	if err != nil {
		t.Fatal(err)
	}
	answer, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: prepared.Response, Configuration: true})
	if err != nil {
		t.Fatal(err)
	}
	hub.doc, hub.data = answer.Document, answer.Snapshot
	// The first server joins while the request is pending. The hub has no order
	// record yet, only the projection's default.
	order := syncdata.JSON([]string{idA})
	current := syncdata.Snapshot{"server/" + idA: {"name": "a"}, orderKey: {"ids": order}}
	completed, err := Complete(prepared.Document, current, answer.Response, true)
	if err != nil || !completed.NeedsSync || completed.Snapshot[orderKey]["ids"] != order || completed.Snapshot["server/"+idA]["name"] != "a" {
		t.Fatalf("first enrollment lost: %+v %v", completed.Snapshot, err)
	}
	desktop.doc, desktop.data = completed.Document, completed.Snapshot
	if conflicts := sync(t, hub, desktop); len(conflicts) != 0 || hub.data[orderKey]["ids"] != order || hub.data["server/"+idA]["name"] != "a" {
		t.Fatalf("first enrollment not published: %+v %+v", conflicts, hub.data)
	}
}

func TestReceiptDoesNotKeepACopyOfTheAnswer(t *testing.T) {
	hub := &side{data: syncdata.Snapshot{scriptKey: {"name": "script", "content": "echo only once"}}}
	desktop := fresh()
	desktop.data["script/"+idB] = syncdata.Record{"name": "local", "content": "echo local"}
	// A first write is answered with everything the hub holds.
	if conflicts := sync(t, hub, desktop); len(conflicts) != 0 || desktop.data[scriptKey]["content"] != "echo only once" {
		t.Fatalf("first exchange failed: %+v %+v", conflicts, desktop.data)
	}
	if count := strings.Count(hub.doc, "echo only once"); count != 1 {
		t.Fatalf("hub document holds %d copies of a value", count)
	}
}

func TestDetachedReplicaContinuesAfterRestoreFromBackup(t *testing.T) {
	hub, devices := scriptFixture(t, 1)
	desktop := devices[0]
	backup := side{doc: desktop.doc, data: cloneSnapshot(desktop.data)}
	for _, name := range []string{"later", "latest"} {
		desktop.data[scriptKey]["name"] = name
		if conflicts := sync(t, hub, desktop); len(conflicts) != 0 {
			t.Fatalf("edit conflicted: %+v", conflicts)
		}
	}
	// The restored document continues from an older request sequence.
	restored := &side{doc: backup.doc, data: backup.data}
	restored.data[scriptKey]["content"] = "echo restored"
	peer, err := Outgoing(restored.doc, restored.data)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: peer, Configuration: true}); err == nil {
		t.Fatal("hub accepted a request sequence it had already passed")
	}
	if restored.doc, err = Detach(restored.doc); err != nil {
		t.Fatal(err)
	}
	conflicts := sync(t, hub, restored)
	if len(conflicts) != 0 || hub.data[scriptKey]["content"] != "echo restored" || restored.data[scriptKey]["name"] != "latest" {
		t.Fatalf("restored replica did not continue: %+v %+v %+v", conflicts, hub.data[scriptKey], restored.data[scriptKey])
	}
	if detached, err := Detach(""); err != nil || detached != "" {
		t.Fatalf("empty document: %q %v", detached, err)
	}
}

func TestReauthorizationKeepsAnUnacknowledgedCandidate(t *testing.T) {
	for _, pending := range []bool{false, true} {
		name := "queued"
		if pending {
			name = "in a pending request"
		}
		t.Run(name, func(t *testing.T) {
			hub, devices := scriptFixture(t, 2)
			left, right := devices[0], devices[1]
			right.data[scriptKey]["content"] = "remote"
			sync(t, hub, right)
			left.data[scriptKey]["content"] = "sent"
			prepared, err := Prepare(left.doc, left.data)
			if err != nil {
				t.Fatal(err)
			}
			answer, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: prepared.Response, Configuration: true})
			if err != nil {
				t.Fatal(err)
			}
			hub.doc, hub.data = answer.Document, answer.Snapshot
			// Edited while the request was out: the field is now in conflict, so
			// comparing data with the document would not report this value.
			left.data[scriptKey]["content"] = "newest"
			completed, err := Complete(prepared.Document, left.data, answer.Response, true)
			if err != nil {
				t.Fatal(err)
			}
			left.doc, left.data = completed.Document, completed.Snapshot
			if pending {
				next, err := Prepare(left.doc, left.data)
				if err != nil {
					t.Fatal(err)
				}
				left.doc = next.Document
			}
			if left.doc, err = Detach(left.doc); err != nil {
				t.Fatal(err)
			}
			conflicts := sync(t, hub, left)
			if len(conflicts) != 1 || !sameValues(conflicts[0].Values, []string{"remote", "sent", "newest"}) {
				t.Fatalf("reauthorization lost a candidate: %+v", conflicts)
			}
		})
	}
}
