package syncengine

import (
	"slices"
	"testing"

	"github.com/easyssh/shared/syncdata"
)

const (
	idA       = "10000000-0000-4000-8000-000000000001"
	idB       = "20000000-0000-4000-8000-000000000002"
	idRemoved = "30000000-0000-4000-8000-000000000003"
	scriptKey = "script/00000000-0000-4000-8000-000000000003"
	groupID   = "40000000-0000-4000-8000-000000000004"
	orderKey  = syncdata.ServerOrderKey
	valueKey  = syncdata.ValueKey
)

// side is one participant: its persisted document and its own data.
type side struct {
	doc  string
	data syncdata.Snapshot
}

func fresh() *side {
	return &side{data: syncdata.Snapshot{orderKey: {"ids": "[]"}}}
}

func members() syncdata.Snapshot {
	return syncdata.Snapshot{"server/" + idA: {"name": "a"}, "server/" + idB: {"name": "b"}}
}

func with(snapshot syncdata.Snapshot, key string, fields syncdata.Record) syncdata.Snapshot {
	snapshot[key] = fields
	return snapshot
}

// exchange runs rounds until the replica is in step with the hub: a replica on
// another timeline first drops its baseline, then merges.
func exchange(t *testing.T, hub, replica *side, configuration bool) []Conflict {
	t.Helper()
	for round := 0; round < 2; round++ {
		peer, err := Outgoing(replica.doc, replica.data)
		if err != nil {
			t.Fatal(err)
		}
		result, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: peer, Configuration: configuration})
		if err != nil {
			t.Fatal(err)
		}
		hub.doc, hub.data = result.Document, result.Snapshot
		received, err := Receive(replica.doc, replica.data, result.Response, configuration)
		if err != nil {
			t.Fatal(err)
		}
		replica.doc, replica.data = received.Document, received.Snapshot
		if !received.Realigned {
			return received.Conflicts
		}
	}
	t.Fatal("replica did not realign in one round")
	return nil
}

func sync(t *testing.T, hub, replica *side) []Conflict {
	t.Helper()
	return exchange(t, hub, replica, true)
}

func resolveOnHub(t *testing.T, hub *side, resolution Resolution, configuration bool) {
	t.Helper()
	result, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Resolution: &resolution, Configuration: configuration})
	if err != nil {
		t.Fatal(err)
	}
	hub.doc, hub.data = result.Document, result.Snapshot
}

func resolveOnReplica(t *testing.T, replica *side, choices ...Resolution) []Conflict {
	t.Helper()
	result, err := Resolve(replica.doc, replica.data, choices)
	if err != nil {
		t.Fatal(err)
	}
	replica.doc, replica.data = result.Document, result.Snapshot
	return result.Conflicts
}

func sameValues(left, right []string) bool {
	left, right = slices.Clone(left), slices.Clone(right)
	slices.Sort(left)
	slices.Sort(right)
	return slices.Equal(left, right)
}

// scriptFixture returns a hub and replicas that all hold the same script.
func scriptFixture(t *testing.T, replicas int) (*side, []*side) {
	t.Helper()
	hub := &side{data: syncdata.Snapshot{scriptKey: {"name": "script", "content": "echo base"}}}
	devices := make([]*side, replicas)
	for i := range devices {
		devices[i] = fresh()
		if conflicts := sync(t, hub, devices[i]); len(conflicts) != 0 || devices[i].data[scriptKey]["content"] != "echo base" {
			t.Fatalf("replica %d did not receive the script: %+v", i, devices[i].data)
		}
	}
	return hub, devices
}

func TestFirstSyncInheritsServerOrderWithoutPublishingAnEmptyOne(t *testing.T) {
	order := syncdata.JSON([]string{idB, idA})
	hub := &side{data: with(members(), orderKey, syncdata.Record{"ids": order})}
	desktop := fresh()
	peer, err := Outgoing(desktop.doc, desktop.data)
	if err != nil || len(peer.Changes) != 0 {
		t.Fatalf("empty replica published changes: %+v %v", peer.Changes, err)
	}
	if conflicts := sync(t, hub, desktop); len(conflicts) != 0 {
		t.Fatalf("unexpected conflicts: %+v", conflicts)
	}
	if desktop.data[orderKey]["ids"] != order || hub.data[orderKey]["ids"] != order {
		t.Fatalf("order not inherited: %s", desktop.data[orderKey]["ids"])
	}
}

func TestSameEffectiveOrderIsNotAConflict(t *testing.T) {
	hubOrder := syncdata.JSON([]string{idB, idRemoved, idA})
	hub := &side{data: with(members(), orderKey, syncdata.Record{"ids": hubOrder})}
	desktop := &side{data: with(members(), orderKey, syncdata.Record{"ids": syncdata.JSON([]string{idB, idA})})}
	if conflicts := sync(t, hub, desktop); len(conflicts) != 0 {
		t.Fatalf("membership difference reported as conflict: %+v", conflicts)
	}
	if hub.data[orderKey]["ids"] != hubOrder {
		t.Fatal("hub ordering changed")
	}
}

func TestConflictingFieldStaysUnchangedUntilResolved(t *testing.T) {
	hub, devices := scriptFixture(t, 2)
	left, right := devices[0], devices[1]
	right.data[scriptKey] = syncdata.Record{"name": "renamed", "content": "echo remote"}
	if conflicts := sync(t, hub, right); len(conflicts) != 0 {
		t.Fatalf("first edit conflicted: %+v", conflicts)
	}
	left.data[scriptKey]["content"] = "echo local"
	for round := 0; round < 4; round++ {
		conflicts := sync(t, hub, left)
		if len(conflicts) != 1 || conflicts[0].Key != scriptKey || conflicts[0].Field != "content" || !sameValues(conflicts[0].Values, []string{"echo local", "echo remote"}) {
			t.Fatalf("round %d: conflict lost: %+v", round, conflicts)
		}
		if left.data[scriptKey]["content"] != "echo local" || left.data[scriptKey]["name"] != "renamed" {
			t.Fatalf("round %d: local projection wrong: %+v", round, left.data[scriptKey])
		}
		if hub.data[scriptKey]["content"] != "echo remote" {
			t.Fatalf("round %d: hub value replaced without a resolution", round)
		}
	}
	// A replica without a local version does not apply a conflicting record,
	// and its absence is not a deletion.
	late := fresh()
	for round := 0; round < 2; round++ {
		if conflicts := sync(t, hub, late); len(conflicts) != 1 || late.data[scriptKey] != nil {
			t.Fatalf("round %d: new replica applied a conflicting record: %+v", round, late.data)
		}
	}
	if hub.data[scriptKey] == nil {
		t.Fatal("withheld record was deleted on the hub")
	}
	if conflicts := resolveOnReplica(t, left, Resolution{Key: scriptKey, Field: "content", Value: "echo remote"}); len(conflicts) != 0 || left.data[scriptKey]["content"] != "echo remote" {
		t.Fatalf("local resolution not applied: %+v %+v", conflicts, left.data[scriptKey])
	}
	if conflicts := sync(t, hub, left); len(conflicts) != 0 || left.data[scriptKey]["content"] != "echo remote" {
		t.Fatalf("resolution not accepted: %+v", conflicts)
	}
	if conflicts := sync(t, hub, late); len(conflicts) != 0 || late.data[scriptKey]["content"] != "echo remote" || late.data[scriptKey]["name"] != "renamed" {
		t.Fatalf("resolved record not delivered: %+v %+v", conflicts, late.data[scriptKey])
	}
}

func TestOrderConflictSurvivesMembershipProjectionUntilResolved(t *testing.T) {
	orderA := syncdata.JSON([]string{idA, idRemoved, idB})
	orderB := syncdata.JSON([]string{idB, idA, idRemoved})
	hub := &side{data: with(members(), orderKey, syncdata.Record{"ids": orderA})}
	desktop := &side{data: with(members(), orderKey, syncdata.Record{"ids": orderB})}
	conflicts := sync(t, hub, desktop)
	if len(conflicts) != 1 || !sameValues(conflicts[0].Values, []string{orderA, orderB}) {
		t.Fatalf("order conflict lost: %+v", conflicts)
	}
	// The local database no longer contains the deleted server. Its filtered
	// order must not erase the two unresolved decisions on the next sync.
	local := syncdata.JSON([]string{idB, idA})
	desktop.data[orderKey] = syncdata.Record{"ids": local}
	if conflicts = sync(t, hub, desktop); len(conflicts) != 1 || desktop.data[orderKey]["ids"] != local || hub.data[orderKey]["ids"] != orderA {
		t.Fatalf("filtered order replaced a decision: %+v", conflicts)
	}
	resolveOnHub(t, hub, Resolution{Key: orderKey, Field: "ids", Value: orderB}, true)
	if conflicts = sync(t, hub, desktop); len(conflicts) != 0 || desktop.data[orderKey]["ids"] != orderB {
		t.Fatalf("hub resolution not delivered: %+v %s", conflicts, desktop.data[orderKey]["ids"])
	}
	// The same decision applied to the live members is not a new edit.
	desktop.data[orderKey] = syncdata.Record{"ids": local}
	if peer, err := Outgoing(desktop.doc, desktop.data); err != nil || len(peer.Changes) != 0 {
		t.Fatalf("membership projection published an order: %+v %v", peer.Changes, err)
	}
}

func TestConcurrentFirstWritesConflictUntilResolved(t *testing.T) {
	hub := &side{data: syncdata.Snapshot{}}
	left := &side{data: syncdata.Snapshot{valueKey: {"ref": idA}}}
	right := &side{data: syncdata.Snapshot{valueKey: {"ref": idB}}}
	if conflicts := exchange(t, hub, left, false); len(conflicts) != 0 {
		t.Fatalf("first write conflicted: %+v", conflicts)
	}
	for round := 0; round < 2; round++ {
		conflicts := exchange(t, hub, right, false)
		if len(conflicts) != 1 || !sameValues(conflicts[0].Values, []string{idA, idB}) {
			t.Fatalf("round %d: concurrent first write lost: %+v", round, conflicts)
		}
	}
	if conflicts := resolveOnReplica(t, right, Resolution{Key: valueKey, Field: "ref", Value: idB}); len(conflicts) != 0 || right.data[valueKey]["ref"] != idB {
		t.Fatalf("local resolution not applied: %+v", right.data)
	}
	if conflicts := exchange(t, hub, right, false); len(conflicts) != 0 || hub.data[valueKey]["ref"] != idB {
		t.Fatalf("resolution not accepted: %+v %+v", conflicts, hub.data)
	}
	if conflicts := exchange(t, hub, left, false); len(conflicts) != 0 || left.data[valueKey]["ref"] != idB {
		t.Fatalf("resolution not delivered: %+v %+v", conflicts, left.data)
	}
}

func TestNewReferenceSupersedesAReferenceConflict(t *testing.T) {
	hub := &side{data: syncdata.Snapshot{}}
	left := &side{data: syncdata.Snapshot{valueKey: {"ref": idA}}}
	right := &side{data: syncdata.Snapshot{valueKey: {"ref": idB}}}
	exchange(t, hub, left, false)
	if conflicts := exchange(t, hub, right, false); len(conflicts) != 1 {
		t.Fatalf("expected a conflict: %+v", conflicts)
	}
	right.data[valueKey] = syncdata.Record{"ref": idRemoved}
	if conflicts := exchange(t, hub, right, false); len(conflicts) != 0 || hub.data[valueKey]["ref"] != idRemoved {
		t.Fatalf("new version did not supersede the conflict: %+v %+v", conflicts, hub.data)
	}
}

func TestIndependentEditsMergeWithoutNoOpChanges(t *testing.T) {
	hub, devices := scriptFixture(t, 2)
	left, right := devices[0], devices[1]
	left.data[scriptKey]["name"] = "renamed"
	right.data[scriptKey]["content"] = "echo two"
	sync(t, hub, left)
	if conflicts := sync(t, hub, right); len(conflicts) != 0 {
		t.Fatalf("independent fields conflicted: %+v", conflicts)
	}
	if conflicts := sync(t, hub, left); len(conflicts) != 0 {
		t.Fatalf("independent fields conflicted: %+v", conflicts)
	}
	for _, device := range devices {
		if device.data[scriptKey]["name"] != "renamed" || device.data[scriptKey]["content"] != "echo two" {
			t.Fatalf("edits not merged: %+v", device.data[scriptKey])
		}
	}
	peer, err := Outgoing(left.doc, left.data)
	if err != nil || len(peer.Changes) != 0 {
		t.Fatalf("merged state produced changes: %+v %v", peer.Changes, err)
	}
	before := hub.doc
	sync(t, hub, left)
	if hub.doc != before {
		t.Fatal("an exchange without edits changed the hub document")
	}
}

func TestConcurrentNameEditsTakeTheLaterOne(t *testing.T) {
	hub, devices := scriptFixture(t, 2)
	left, right := devices[0], devices[1]
	left.data[scriptKey]["name"] = "one"
	right.data[scriptKey]["name"] = "two"
	sync(t, hub, left)
	if conflicts := sync(t, hub, right); len(conflicts) != 0 || hub.data[scriptKey]["name"] != "two" {
		t.Fatalf("display field conflicted: %+v %+v", conflicts, hub.data[scriptKey])
	}
	if conflicts := sync(t, hub, left); len(conflicts) != 0 || left.data[scriptKey]["name"] != "two" {
		t.Fatalf("later edit not delivered: %+v", left.data[scriptKey])
	}
}

func TestDeletionIsNotResurrectedByAConcurrentEdit(t *testing.T) {
	hub := &side{data: syncdata.Snapshot{valueKey: {"ref": idA}}}
	left, right := &side{data: syncdata.Snapshot{}}, &side{data: syncdata.Snapshot{}}
	exchange(t, hub, left, false)
	exchange(t, hub, right, false)
	left.data = syncdata.Snapshot{}
	right.data[valueKey] = syncdata.Record{"ref": idB}
	exchange(t, hub, left, false)
	if len(hub.data) != 0 {
		t.Fatalf("deletion not applied: %+v", hub.data)
	}
	if conflicts := exchange(t, hub, right, false); len(conflicts) != 0 || len(hub.data) != 0 || len(right.data) != 0 {
		t.Fatalf("edit resurrected a deleted record: %+v %+v", hub.data, right.data)
	}
}

func TestGroupRenameConflictKeepsDependencyAndDeletionWins(t *testing.T) {
	groupKey, serverKey := "group/"+groupID, "server/"+idA
	hub := &side{data: syncdata.Snapshot{
		groupKey:  {"name": "base", "sort_order": "0"},
		serverKey: {"name": "host", "group_id": groupID},
		orderKey:  {"ids": "[]"},
	}}
	left, right := fresh(), fresh()
	sync(t, hub, left)
	sync(t, hub, right)
	left.data[groupKey]["name"] = "left"
	right.data[groupKey]["name"] = "right"
	sync(t, hub, left)
	conflicts := sync(t, hub, right)
	if len(conflicts) != 1 || conflicts[0].Key != groupKey || hub.data[groupKey]["name"] != "left" || right.data[groupKey]["name"] != "right" {
		t.Fatalf("rename conflict lost: %+v", conflicts)
	}
	late := fresh()
	for round := 0; round < 2; round++ {
		conflicts = sync(t, hub, late)
		if len(conflicts) != 1 || late.data[groupKey]["name"] != "left" || late.data[serverKey]["group_id"] != groupID {
			t.Fatalf("round %d: new replica lost the group dependency: %+v", round, late.data)
		}
	}
	if conflicts = sync(t, hub, left); len(conflicts) != 1 || left.data[groupKey]["name"] != "left" {
		t.Fatalf("conflict not delivered to its other author: %+v", conflicts)
	}
	delete(left.data, groupKey)
	left.data[serverKey]["group_id"] = ""
	sync(t, hub, left)
	if hub.data[groupKey] != nil || hub.data[serverKey]["group_id"] != "" {
		t.Fatalf("group deletion not applied: %+v", hub.data)
	}
	if conflicts = sync(t, hub, right); len(conflicts) != 0 || right.data[groupKey] != nil || right.data[serverKey]["group_id"] != "" {
		t.Fatalf("concurrent rename resurrected a deleted group: %+v %+v", conflicts, right.data)
	}
}

func TestDeletedGroupDetachesServersThatStillReferenceIt(t *testing.T) {
	groupKey, serverKey := "group/"+groupID, "server/"+idA
	hub := &side{data: syncdata.Snapshot{
		groupKey:  {"name": "base", "sort_order": "0"},
		serverKey: {"name": "host", "group_id": groupID},
		orderKey:  {"ids": "[]"},
	}}
	desktop := fresh()
	sync(t, hub, desktop)
	// Only the group is removed; the reference is cleared by the projection.
	delete(hub.data, groupKey)
	if conflicts := sync(t, hub, desktop); len(conflicts) != 0 || desktop.data[groupKey] != nil || desktop.data[serverKey]["group_id"] != "" || hub.data[serverKey]["group_id"] != "" {
		t.Fatalf("server kept a deleted group: %+v %+v", hub.data, desktop.data)
	}
}

func TestResolutionCannotDiscardACandidateItsAuthorNeverSaw(t *testing.T) {
	hub, devices := scriptFixture(t, 3)
	first, second, third := devices[0], devices[1], devices[2]
	second.data[scriptKey]["content"] = "echo second"
	sync(t, hub, second)
	first.data[scriptKey]["content"] = "echo first"
	if conflicts := sync(t, hub, first); len(conflicts) != 1 {
		t.Fatalf("expected a conflict: %+v", conflicts)
	}
	third.data[scriptKey]["content"] = "echo third"
	if conflicts := sync(t, hub, third); len(conflicts) != 1 || len(conflicts[0].Values) != 3 {
		t.Fatalf("third candidate lost: %+v", conflicts)
	}
	resolveOnReplica(t, first, Resolution{Key: scriptKey, Field: "content", Value: "echo first"})
	conflicts := sync(t, hub, first)
	if len(conflicts) != 1 || len(conflicts[0].Values) != 3 || hub.data[scriptKey]["content"] != "echo second" {
		t.Fatalf("stale resolution discarded a candidate: %+v %+v", conflicts, hub.data[scriptKey])
	}
	if first.data[scriptKey]["content"] != "echo first" {
		t.Fatal("replica lost its own value while the conflict is open")
	}
}

func TestRepeatedRequestIsIdempotent(t *testing.T) {
	hub, devices := scriptFixture(t, 1)
	desktop := devices[0]
	desktop.data[scriptKey]["content"] = "echo edited"
	peer, err := Outgoing(desktop.doc, desktop.data)
	if err != nil {
		t.Fatal(err)
	}
	var result Result
	for attempt := 0; attempt < 2; attempt++ {
		result, err = Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: peer, Configuration: true})
		if err != nil || len(result.Conflicts) != 0 || result.Snapshot[scriptKey]["content"] != "echo edited" {
			t.Fatalf("attempt %d: %+v %v", attempt, result.Conflicts, err)
		}
		hub.doc, hub.data = result.Document, result.Snapshot
	}
	received, err := Receive(desktop.doc, desktop.data, result.Response, true)
	if err != nil || len(received.Conflicts) != 0 || received.Snapshot[scriptKey]["content"] != "echo edited" {
		t.Fatalf("retry result not applied: %+v %v", received.Conflicts, err)
	}
}

func TestHubEditsReachReplicasAndHubResolutionIsChecked(t *testing.T) {
	hub, devices := scriptFixture(t, 1)
	desktop := devices[0]
	hub.data[scriptKey]["content"] = "echo hub"
	desktop.data[scriptKey]["content"] = "echo desktop"
	if conflicts := sync(t, hub, desktop); len(conflicts) != 1 || hub.data[scriptKey]["content"] != "echo hub" || desktop.data[scriptKey]["content"] != "echo desktop" {
		t.Fatalf("hub edit and replica edit did not conflict: %+v", conflicts)
	}
	if _, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Resolution: &Resolution{Key: scriptKey, Field: "content", Value: "echo other"}, Configuration: true}); err == nil {
		t.Fatal("accepted a value that is not a candidate")
	}
	resolveOnHub(t, hub, Resolution{Key: scriptKey, Field: "content", Value: "echo desktop"}, true)
	if conflicts := sync(t, hub, desktop); len(conflicts) != 0 || hub.data[scriptKey]["content"] != "echo desktop" {
		t.Fatalf("hub resolution lost: %+v %+v", conflicts, hub.data[scriptKey])
	}
}

func TestInspectDoesNotChangeTheDocument(t *testing.T) {
	hub, _ := scriptFixture(t, 1)
	result, err := Inspect(hub.doc)
	if err != nil || result.Document != hub.doc || result.Snapshot[scriptKey]["content"] != "echo base" || len(result.Conflicts) != 0 {
		t.Fatalf("inspection: %+v %v", result, err)
	}
	if empty, err := Inspect(""); err != nil || len(empty.Snapshot) != 0 || len(empty.Conflicts) != 0 {
		t.Fatalf("empty inspection: %+v %v", empty, err)
	}
}

func TestInvalidInputIsRejected(t *testing.T) {
	hub, _ := scriptFixture(t, 1)
	timeline := mustLoad(t, hub.doc).Timeline
	if _, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: Peer{Timeline: timeline, Cursor: 1 << 40}}); err == nil {
		t.Fatal("accepted a replica ahead of the hub on the same timeline")
	}
	if _, err := Exchange(HubInput{Peer: Peer{Changes: []Change{{Key: "other/" + idA, Field: "name", Value: "x"}}}}); err == nil {
		t.Fatal("accepted an unknown record type")
	}
	if _, err := Inspect("not json"); err == nil {
		t.Fatal("accepted an invalid document")
	}
}

func mustLoad(t *testing.T, document string) *state {
	t.Helper()
	st, err := load(document)
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func TestBaselessReplicaKeepsARecordTheHubDeleted(t *testing.T) {
	hub, devices := scriptFixture(t, 1)
	first := devices[0]
	delete(first.data, scriptKey)
	sync(t, hub, first)
	if hub.data[scriptKey] != nil {
		t.Fatal("deletion not applied")
	}
	// Without a shared baseline the hub cannot tell an old copy from new data,
	// and guessing "deleted" would destroy it.
	late := fresh()
	late.data[scriptKey] = syncdata.Record{"name": "kept", "content": "echo kept"}
	if conflicts := sync(t, hub, late); len(conflicts) != 0 || late.data[scriptKey]["content"] != "echo kept" || hub.data[scriptKey]["content"] != "echo kept" {
		t.Fatalf("baseless copy was deleted: %+v %+v %+v", conflicts, late.data, hub.data)
	}
	if conflicts := sync(t, hub, first); len(conflicts) != 0 || first.data[scriptKey]["content"] != "echo kept" {
		t.Fatalf("restored record not delivered: %+v", first.data)
	}
}

func TestBaselessMergeTakesHubDisplayFieldsAndKeepsBothKeyValues(t *testing.T) {
	hub := &side{data: syncdata.Snapshot{scriptKey: {"name": "hub name", "content": "echo hub"}}}
	desktop := fresh()
	desktop.data[scriptKey] = syncdata.Record{"name": "desktop name", "content": "echo desktop"}
	conflicts := sync(t, hub, desktop)
	if len(conflicts) != 1 || conflicts[0].Field != "content" || !sameValues(conflicts[0].Values, []string{"echo hub", "echo desktop"}) {
		t.Fatalf("key field difference was not kept as a conflict: %+v", conflicts)
	}
	if hub.data[scriptKey]["name"] != "hub name" || desktop.data[scriptKey]["name"] != "hub name" {
		t.Fatalf("display field did not follow the hub: %+v %+v", hub.data[scriptKey], desktop.data[scriptKey])
	}
	if hub.data[scriptKey]["content"] != "echo hub" || desktop.data[scriptKey]["content"] != "echo desktop" {
		t.Fatal("a side lost its own key value before the conflict was resolved")
	}
}

func TestRestoredHubRealignsReplicasWithoutLosingTheirData(t *testing.T) {
	hub, devices := scriptFixture(t, 2)
	left, right := devices[0], devices[1]
	backup := side{doc: hub.doc, data: cloneSnapshot(hub.data)}
	added := "script/" + idB
	left.data[added] = syncdata.Record{"name": "added later", "content": "echo added"}
	left.data[scriptKey]["content"] = "echo after backup"
	sync(t, hub, left)
	delete(right.data, scriptKey)
	sync(t, hub, right)
	sync(t, hub, left)
	if left.data[scriptKey] != nil || left.data[added] == nil {
		t.Fatalf("setup: %+v", left.data)
	}
	// The hub returns to the backup: the script exists again with its old
	// content, the added one is gone, and the version numbers start over.
	restored, err := Rotate(backup.doc)
	if err != nil {
		t.Fatal(err)
	}
	hub = &side{doc: restored, data: backup.data}
	before := mustLoad(t, backup.doc)
	after := mustLoad(t, restored)
	if after.Timeline == before.Timeline || after.Timeline == "" || len(after.Receipts) != 0 || after.Seq != before.Seq {
		t.Fatal("restore did not start a new timeline")
	}
	peer, err := Outgoing(left.doc, left.data)
	if err != nil {
		t.Fatal(err)
	}
	rejected, err := Exchange(HubInput{Document: hub.doc, Current: hub.data, Peer: peer, Configuration: true})
	if err != nil || !rejected.Response.Realign || len(rejected.Response.Changes) != 0 || rejected.Snapshot[added] != nil {
		t.Fatalf("request from the old timeline was applied: %+v %v", rejected.Response, err)
	}
	if conflicts := sync(t, hub, left); len(conflicts) != 0 {
		t.Fatalf("realignment conflicted: %+v", conflicts)
	}
	// Left had deleted the script on the lost timeline; with no baseline that
	// is not a deletion, so the restored record comes back and nothing is removed.
	if left.data[added]["content"] != "echo added" || hub.data[added]["content"] != "echo added" {
		t.Fatalf("data created after the backup was lost: %+v %+v", left.data, hub.data)
	}
	if left.data[scriptKey]["content"] != "echo base" || hub.data[scriptKey]["content"] != "echo base" {
		t.Fatalf("restored record not delivered: %+v", left.data[scriptKey])
	}
	if mustLoad(t, left.doc).Timeline != after.Timeline {
		t.Fatal("replica did not adopt the new timeline")
	}
	if conflicts := sync(t, hub, right); len(conflicts) != 0 || right.data[added] == nil || right.data[scriptKey] == nil {
		t.Fatalf("second replica did not realign: %+v %+v", conflicts, right.data)
	}
	// Realigned replicas are ordinary replicas again.
	right.data[added]["content"] = "echo edited"
	sync(t, hub, right)
	if conflicts := sync(t, hub, left); len(conflicts) != 0 || left.data[added]["content"] != "echo edited" {
		t.Fatalf("edit after realignment not delivered: %+v", left.data[added])
	}
	if rotated, err := Rotate(""); err != nil || rotated != "" {
		t.Fatalf("empty document: %q %v", rotated, err)
	}
}

func TestDeletingAConflictingRecordIsPublished(t *testing.T) {
	hub, devices := scriptFixture(t, 2)
	left, right := devices[0], devices[1]
	left.data[scriptKey]["content"] = "left"
	right.data[scriptKey]["content"] = "right"
	sync(t, hub, left)
	sync(t, hub, right)
	if conflicts := sync(t, hub, left); len(conflicts) != 1 {
		t.Fatalf("expected a conflict: %+v", conflicts)
	}
	delete(left.data, scriptKey)
	if conflicts := sync(t, hub, left); len(conflicts) != 0 || hub.data[scriptKey] != nil || left.data[scriptKey] != nil {
		t.Fatalf("deletion of a conflicting record was not published: %+v %+v", conflicts, hub.data)
	}
	if conflicts := sync(t, hub, right); len(conflicts) != 0 || right.data[scriptKey] != nil {
		t.Fatalf("deletion not delivered to the other author: %+v %+v", conflicts, right.data)
	}
}
