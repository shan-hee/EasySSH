package rest

import "testing"

func TestBackupServerKeyRemapping(t *testing.T) {
	for _, tc := range []struct {
		name, owner string
		keyID       any
		wantError   bool
	}{
		{"mapped owner", "source-user", float64(7), false},
		{"missing key", "source-user", float64(8), true},
		{"different owner", "foreign-user", float64(7), true},
		{"password connection", "source-user", nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			row := map[string]any{"user_id": tc.owner, "ssh_key_id": tc.keyID}
			err := remapBackupServerKeys(BackupTable{Name: "servers", Rows: []map[string]any{row}}, map[string]any{"source-user": "target-user"}, map[string]restoredSSHKey{"7": {ID: 42, Owner: "target-user"}})
			if (err != nil) != tc.wantError {
				t.Fatalf("unexpected remapping result: %v", err)
			}
			if err == nil && tc.keyID != nil && row["ssh_key_id"] != uint(42) {
				t.Fatal("retained source database key ID")
			}
		})
	}
}
