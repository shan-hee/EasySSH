package protocol

import "testing"

func TestActorAutomationDoesNotRelaxVisitorOrDeviceIdentity(t *testing.T) {
	if !(Actor{Kind: Owner, ID: "owner"}).Valid() {
		t.Fatal("owner execution requires a fake session")
	}
	for _, actor := range []Actor{
		{Kind: Owner, ID: "owner", GrantID: "foreign"},
		{Kind: Device, ID: "device"},
		{Kind: Visitor, ID: "visitor", GrantID: "grant"},
		{Kind: Visitor, ID: "visitor", SessionID: "another", GrantID: "grant"},
	} {
		if actor.Valid() {
			t.Fatalf("invalid actor accepted: %+v", actor)
		}
	}
}
