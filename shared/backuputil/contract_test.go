package backuputil

import "testing"

func TestApplicationDataDropsRetiredFieldsFromColumnsAndRows(t *testing.T) {
	backup := &UnifiedBackup{Config: &DataSection{Tables: []Table{{Name: "system_config", PrimaryKey: []string{"id"}, Columns: []string{"id", "system_name", "geo_ip_database_path"}, Rows: []map[string]any{{"id": 1, "system_name": "Example", "geo_ip_database_path": "obsolete.mmdb"}}}}}}
	warnings, err := NormalizeApplicationData(backup)
	if err != nil {
		t.Fatal(err)
	}
	table := backup.Config.Tables[0]
	if len(warnings) != 1 || warnings[0] != "system_config.geo_ip_database_path" {
		t.Fatalf("missing field report: %v", warnings)
	}
	if len(table.Columns) != 2 {
		t.Fatalf("retired field still declared: %v", table.Columns)
	}
	if _, exists := table.Rows[0]["geo_ip_database_path"]; exists {
		t.Fatal("retired field still in row")
	}
	if table.Rows[0]["system_name"] != "Example" {
		t.Fatal("valid field was changed")
	}
}

func TestApplicationDataRejectsMissingKeyReference(t *testing.T) {
	backup := &UnifiedBackup{Database: &DataSection{Tables: []Table{{Name: "servers", PrimaryKey: []string{"id"}, Columns: []string{"id", "user_id", "host", "username", "auth_method", "ssh_key_id"}, Rows: []map[string]any{{"id": "server", "user_id": "owner", "host": "example.com", "username": "user", "auth_method": "key", "ssh_key_id": 42}}}}}}
	if _, err := NormalizeApplicationData(backup); err == nil {
		t.Fatal("missing SSH key reference was accepted")
	}
}

func TestApplicationDataRejectsRuntimeResources(t *testing.T) {
	for _, name := range []string{"user_sessions", "sync_devices", "job_queue", "operation_records"} {
		backup := &UnifiedBackup{Database: &DataSection{Tables: []Table{{Name: name, PrimaryKey: []string{"id"}, Columns: []string{"id"}}}}}
		if _, err := NormalizeApplicationData(backup); err == nil {
			t.Fatalf("runtime resource %s was accepted", name)
		}
	}
}
