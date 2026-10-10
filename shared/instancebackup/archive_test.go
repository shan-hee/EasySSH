package instancebackup

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestEncryptedInstanceArchiveRoundTripAndTampering(t *testing.T) {
	source := t.TempDir()
	output := filepath.Join(t.TempDir(), "backup.age")
	for name, value := range map[string]string{"database.dump": "native database bytes", "root.key": "protected root key", "data/preferences.json": "{}"} {
		filename := filepath.Join(source, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := Pack(context.Background(), source, output, "test password", Manifest{Profile: "server", Driver: "sqlite", SchemaVersion: 1, AppVersion: "1.0.46"}); err != nil {
		t.Fatal(err)
	}
	restored := t.TempDir()
	manifest, err := Unpack(context.Background(), output, restored, "test password")
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Files) != 3 {
		t.Fatalf("unexpected manifest: %+v", manifest)
	}
	if _, err := Unpack(context.Background(), output, t.TempDir(), "incorrect password"); err == nil {
		t.Fatal("wrong password was accepted")
	}
	data, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 1
	tampered := filepath.Join(t.TempDir(), "tampered.age")
	if err := os.WriteFile(tampered, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Unpack(context.Background(), tampered, t.TempDir(), "test password"); err == nil {
		t.Fatal("tampered archive was accepted")
	}
	if err := Pack(context.Background(), source, output, "test password", Manifest{}); err == nil {
		t.Fatal("existing backup was overwritten")
	}
}
