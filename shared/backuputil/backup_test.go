package backuputil

import "testing"

func TestApplicationDataRequiresKnownSource(t *testing.T) {
	for _, source := range []string{SourceDesktop, SourceServer, "", "unknown"} {
		t.Run(source, func(t *testing.T) {
			backup := &UnifiedBackup{Format: Format, Version: Version, Source: source,
				Contents: ContentSelection{Database: true}, Database: &DataSection{Driver: "sqlite"}}
			err := ValidateUnifiedBackup(backup)
			valid := source == SourceDesktop || source == SourceServer
			if (err == nil) != valid {
				t.Fatalf("unexpected source validation: %v", err)
			}
		})
	}
}

func TestDesktopSourceRejectsServerOnlyResources(t *testing.T) {
	for _, resource := range []string{"roles", "scheduled_tasks", "user_ai_config"} {
		backup := &UnifiedBackup{Format: Format, Version: Version, Source: SourceDesktop,
			Contents: ContentSelection{Database: true}, Database: &DataSection{Tables: []Table{{Name: resource}}}}
		if err := ValidateUnifiedBackup(backup); err == nil {
			t.Fatalf("desktop source accepted %s", resource)
		}
	}
	backup := &UnifiedBackup{Format: Format, Version: Version, Source: SourceDesktop,
		Contents: ContentSelection{Config: true, Database: true}, Config: &DataSection{}, Database: &DataSection{}}
	if err := ValidateUnifiedBackup(backup); err == nil {
		t.Fatal("desktop source accepted system configuration")
	}
}

func TestSensitiveDigestBindsImportSource(t *testing.T) {
	backup := &UnifiedBackup{Format: Format, Version: Version, Source: SourceDesktop,
		Contents: ContentSelection{Database: true, Sensitive: true}, Database: &DataSection{}}
	digest, err := BaseSHA256(backup)
	if err != nil {
		t.Fatal(err)
	}
	payload := &SensitivePayload{BaseSHA256: digest}
	if err := VerifySensitiveBaseSHA256(backup, payload); err != nil {
		t.Fatal(err)
	}
	backup.Source = SourceServer
	if err := VerifySensitiveBaseSHA256(backup, payload); err == nil {
		t.Fatal("modified source bypassed sensitive data binding")
	}
}

func TestApplicationDataRejectsRetiredVersion(t *testing.T) {
	backup := &UnifiedBackup{Format: Format, Version: "1.0", Source: SourceDesktop,
		Contents: ContentSelection{Database: true}, Database: &DataSection{}}
	if err := ValidateUnifiedBackup(backup); err == nil {
		t.Fatal("retired version accepted")
	}
}
