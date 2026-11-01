package app

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"

	"github.com/easyssh/shared/protocol"
)

type countedDesktopTree struct {
	desktopTransferTree
	reads map[string]int
}

func (c countedDesktopTree) ReadDir(remote string) ([]os.FileInfo, error) {
	c.reads[remote]++
	return c.desktopTransferTree.ReadDir(remote)
}

func TestDesktopDownloadSelectionSingleWalkSuffixAndExclusions(t *testing.T) {
	root := t.TempDir()
	for _, relative := range []string{"one/app", "two/app", "one/app/node_modules"} {
		if err := os.MkdirAll(filepath.Join(root, relative), 0700); err != nil {
			t.Fatal(err)
		}
	}
	for relative, body := range map[string]string{"one/app/a.txt": "first", "two/app/a.txt": "second", "one/app/trace.log": "excluded", "one/app/node_modules/code": "excluded"} {
		if err := os.WriteFile(filepath.Join(root, relative), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	client := desktopAtomicSFTPFixture(t)
	tree := countedDesktopTree{client, make(map[string]int)}
	selection, err := normalizeDesktopTransferSelection([]string{desktopSFTPTestPath(filepath.Join(root, "one/app")), desktopSFTPTestPath(filepath.Join(root, "two/app"))}, []string{"*.log", "node_modules"}, true)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := planDesktopTransfer(context.Background(), tree, selection, protocol.TransferLimits{MaxEntries: 100, MaxDepth: 8})
	if err != nil {
		t.Fatal(err)
	}
	if plan.bytes != 11 || plan.files != 2 || plan.excluded != 2 {
		t.Fatalf("plan=%+v", plan)
	}
	for _, count := range tree.reads {
		if count != 1 {
			t.Fatal("directory enumerated repeatedly")
		}
	}
	if _, ok := tree.reads[desktopSFTPTestPath(filepath.Join(root, "one/app/node_modules"))]; ok {
		t.Fatal("excluded subtree enumerated")
	}
	var output bytes.Buffer
	var copied int64
	if err := writeDesktopTransferArchive(context.Background(), client, plan, &output, func(n int64) error { copied = n; return nil }); err != nil {
		t.Fatal(err)
	}
	if copied != 11 {
		t.Fatalf("archive overhead counted as source bytes: %d", copied)
	}
	reader, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"app/": "", "app/a.txt": "first", "app (2)/": "", "app (2)/a.txt": "second"}
	if len(reader.File) != len(want) {
		t.Fatalf("entries=%d", len(reader.File))
	}
	for _, entry := range reader.File {
		expected, ok := want[entry.Name]
		if !ok {
			t.Fatal("unexpected archive entry", entry.Name)
		}
		r, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(r)
		r.Close()
		if err != nil || string(body) != expected {
			t.Fatalf("entry=%s data=%q err=%v", entry.Name, body, err)
		}
	}
}

func TestDesktopDownloadSingleFileRawAndDirectoryZIP(t *testing.T) {
	root := filepath.Join(t.TempDir(), "folder")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "payload")
	if err := os.WriteFile(file, []byte("raw content"), 0600); err != nil {
		t.Fatal(err)
	}
	client := desktopAtomicSFTPFixture(t)
	for _, remote := range []string{file, root} {
		selection, err := normalizeDesktopTransferSelection([]string{desktopSFTPTestPath(remote)}, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		plan, err := planDesktopTransfer(context.Background(), client, selection, protocol.TransferLimits{MaxEntries: 100, MaxDepth: 8})
		if err != nil {
			t.Fatal(err)
		}
		if plan.archive != (remote == root) {
			t.Fatal("wrong format", remote)
		}
		var output bytes.Buffer
		if err := writeDesktopTransferArchive(context.Background(), client, plan, &output, nil); err != nil {
			t.Fatal(err)
		}
		if remote == file && output.String() != "raw content" {
			t.Fatal("single file wrapped in archive")
		}
		if remote == root {
			if _, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len())); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestDesktopTransferLimitsAndSourceKinds(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "nested")
	if err := os.Mkdir(nested, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(nested, "file")
	if err := os.WriteFile(file, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	client := desktopAtomicSFTPFixture(t)
	selection, err := normalizeDesktopTransferSelection([]string{desktopSFTPTestPath(root)}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, limits := range []protocol.TransferLimits{{MaxEntries: 2, MaxDepth: 8}, {MaxEntries: 100, MaxDepth: 1}} {
		if _, err := planDesktopTransfer(context.Background(), client, selection, limits); err == nil {
			t.Fatal("enumeration limit bypassed")
		}
	}
	t.Run("reject_symlink", func(t *testing.T) {
		if err := os.Symlink(file, filepath.Join(root, "link")); err != nil {
			if runtime.GOOS == "windows" && errors.Is(err, syscall.Errno(1314)) { // ERROR_PRIVILEGE_NOT_HELD
				t.Skipf("Windows symlink privilege unavailable: %v", err)
			}
			t.Fatal(err)
		}
		if _, err := planDesktopTransfer(context.Background(), client, selection, protocol.TransferLimits{MaxEntries: 100, MaxDepth: 8}); err == nil {
			t.Fatal("symlink followed")
		}
	})
	for _, paths := range [][]string{{"/"}, {"relative"}, {"/same", "/same"}} {
		if _, err := normalizeDesktopTransferSelection(paths, nil, true); err == nil {
			t.Fatal("invalid selection accepted")
		}
	}
}

func TestDesktopArchiveChangeAndCancellationKeepLocalDestination(t *testing.T) {
	for _, cancelDuringCopy := range []bool{false, true} {
		client := desktopAtomicSFTPFixture(t)
		source := filepath.Join(t.TempDir(), "source")
		if err := os.WriteFile(source, []byte("payload"), 0600); err != nil {
			t.Fatal(err)
		}
		selection, err := normalizeDesktopTransferSelection([]string{desktopSFTPTestPath(source)}, nil, true)
		if err != nil {
			t.Fatal(err)
		}
		plan, err := planDesktopTransfer(context.Background(), client, selection, protocol.TransferLimits{MaxEntries: 100, MaxDepth: 8})
		if err != nil {
			t.Fatal(err)
		}
		destination := filepath.Join(t.TempDir(), "archive.zip")
		if err := os.WriteFile(destination, []byte("original"), 0600); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		if !cancelDuringCopy {
			if err := os.WriteFile(source, []byte("changed size"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		err = writeDesktopLocalAtomic(ctx, destination, func(output *os.File) error {
			return writeDesktopTransferArchive(ctx, client, plan, output, func(int64) error {
				if cancelDuringCopy {
					cancel()
					return ctx.Err()
				}
				return nil
			})
		})
		cancel()
		if err == nil {
			t.Fatal("partial archive committed")
		}
		if cancelDuringCopy && !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
		body, err := os.ReadFile(destination)
		if err != nil || string(body) != "original" {
			t.Fatal("destination replaced by incomplete archive", err)
		}
	}
}

func TestDesktopTransferSettingsPersistAndValidate(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	db, err := tasks.database()
	if err != nil {
		t.Fatal(err)
	}
	files := NewDesktopSFTPService(nil, tasks, nil)
	defaults, err := files.GetTransferLimits()
	if err != nil || defaults.MaxEntries != 100000 || defaults.MaxDepth != 128 {
		t.Fatalf("defaults=%+v err=%v", defaults, err)
	}
	want := protocol.TransferLimits{MaxEntries: 250, MaxDepth: 12}
	if err := files.SaveTransferLimits(want); err != nil {
		t.Fatal(err)
	}
	if err := files.SaveTransferLimits(want); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM desktop_configuration_events WHERE action='transfer_settings_updated'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("unchanged settings counted twice: %d %v", count, err)
	}
	if _, err := db.Exec(`CREATE TRIGGER reject_transfer_settings_activity BEFORE INSERT ON activity_logs WHEN NEW.action='transfer_settings_updated' BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err := files.SaveTransferLimits(protocol.TransferLimits{MaxEntries: 300, MaxDepth: 12}); err == nil {
		t.Fatal("settings committed without activity")
	}
	if err := files.SaveTransferLimits(protocol.TransferLimits{MaxEntries: 0, MaxDepth: 12}); err == nil {
		t.Fatal("invalid limits accepted")
	}
	reopened := NewDesktopSFTPService(nil, tasks, nil)
	got, err := reopened.GetTransferLimits()
	if err != nil || got != want {
		t.Fatalf("stored=%+v err=%v", got, err)
	}
}
