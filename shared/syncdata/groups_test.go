package syncdata

import (
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"testing"
)

func TestSnapshotRequiresIndependentGroupDependency(t *testing.T) {
	group := protocol.ServerGroup{ID: uuid.NewString(), Name: "production", SortOrder: 1}
	key := "server/" + uuid.NewString()
	snapshot := Snapshot{key: {"name": "server", "connection": JSON(Connection{Host: "example.test", Port: 22, Username: "owner", AuthMethod: "password"}), "group_id": group.ID, "tags": "[]"}}
	if err := Validate(snapshot); err == nil {
		t.Fatal("missing group dependency accepted")
	}
	snapshot["group/"+group.ID] = GroupRecord(group)
	if err := Validate(snapshot); err != nil {
		t.Fatal(err)
	}
	snapshot[key]["group_id"] = ""
	if err := Validate(snapshot); err != nil {
		t.Fatal("empty group rejected", err)
	}
	if len(snapshot) != 2 {
		t.Fatal("empty group not counted")
	}
	snapshot[key]["group"] = JSON(group)
	if err := Validate(snapshot); err == nil {
		t.Fatal("embedded group metadata accepted")
	}
}

func TestGroupRecordRejectsNonCanonicalOrUnknownFields(t *testing.T) {
	id := uuid.NewString()
	for _, record := range []Record{{"name": "group", "sort_order": "01"}, {"name": " group ", "sort_order": "1"}, {"name": "group", "sort_order": "-1"}, {"name": "group", "sort_order": "1", "password": "secret"}} {
		if _, err := ParseGroup(id, record); err == nil {
			t.Fatal("invalid metadata accepted", record)
		}
	}
	if _, err := ParseGroup(uuid.Nil.String(), Record{"name": "group", "sort_order": "1"}); err == nil {
		t.Fatal("zero ID accepted")
	}
}
