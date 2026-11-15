package sftputil

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/pkg/sftp"
)

func writeAtomicText(t *testing.T, client *sftp.Client, target string, options AtomicWrite, during func()) error {
	t.Helper()
	_, err := WriteAtomic(context.Background(), client, target, options, func(file *sftp.File) error {
		if _, err := file.Write([]byte("new")); err != nil {
			return err
		}
		if during != nil {
			during()
		}
		return nil
	})
	return err
}

func TestWriteAtomicReplacesAndKeepsMode(t *testing.T) {
	client := folderTestClient(t)
	directory := t.TempDir()
	target := filepath.Join(directory, "file")
	if err := os.WriteFile(target, []byte("old"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := writeAtomicText(t, client, target, AtomicWrite{Mode: 0600, Replace: true}, nil); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "new" {
		t.Fatalf("data=%q err=%v", data, err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0640 {
		t.Fatalf("mode=%v", info.Mode())
	}
	assertNoUploadLeftovers(t, directory)
}

func TestWriteAtomicRefusesTargetChangedDuringWrite(t *testing.T) {
	client := folderTestClient(t)
	directory := t.TempDir()
	target := filepath.Join(directory, "file")
	if err := os.WriteFile(target, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	err := writeAtomicText(t, client, target, AtomicWrite{Mode: 0600, Replace: true}, func() {
		if err := os.WriteFile(target, []byte("concurrent edit"), 0600); err != nil {
			t.Fatal(err)
		}
	})
	if err == nil {
		t.Fatal("replaced a target that changed after the write started")
	}
	if data, err := os.ReadFile(target); err != nil || string(data) != "concurrent edit" {
		t.Fatalf("data=%q err=%v", data, err)
	}
	assertNoUploadLeftovers(t, directory)
}

func TestWriteAtomicWithoutReplaceKeepsExistingTarget(t *testing.T) {
	client := folderTestClient(t)
	directory := t.TempDir()
	created := filepath.Join(directory, "created")
	if err := writeAtomicText(t, client, created, AtomicWrite{Mode: 0644}, nil); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(created)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0644 {
		t.Fatalf("mode=%v", info.Mode())
	}
	if err := writeAtomicText(t, client, created, AtomicWrite{Mode: 0644}, nil); err == nil {
		t.Fatal("existing target replaced")
	}
	raced := filepath.Join(directory, "raced")
	err = writeAtomicText(t, client, raced, AtomicWrite{Mode: 0644}, func() {
		if err := os.WriteFile(raced, []byte("concurrent"), 0600); err != nil {
			t.Fatal(err)
		}
	})
	if err == nil {
		t.Fatal("target created during the write was replaced")
	}
	if data, err := os.ReadFile(raced); err != nil || string(data) != "concurrent" {
		t.Fatalf("data=%q err=%v", data, err)
	}
	assertNoUploadLeftovers(t, directory)
}
