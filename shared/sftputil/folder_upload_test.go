package sftputil

import (
	"bytes"
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pkg/sftp"
)

func folderTestClient(t *testing.T) *sftp.Client {
	t.Helper()
	clientConn, serverConn := net.Pipe()
	server, err := sftp.NewServer(serverConn)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve() }()
	t.Cleanup(func() { _ = clientConn.Close(); _ = serverConn.Close(); <-done })
	client, err := sftp.NewClientPipe(clientConn, clientConn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}

var folderTestLimits = FolderLimits{MaxEntries: 100, MaxDepth: 10}

func folderBundle(t *testing.T, manifest FolderManifest, content string) *bytes.Reader {
	t.Helper()
	header, err := EncodeFolderBundleHeader(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return bytes.NewReader(append(header, content...))
}

func TestFolderBundleHeaderRoundTrip(t *testing.T) {
	manifest := FolderManifest{Directories: []string{"src", "src/empty"}, Files: []FolderManifestFile{{Path: "a.txt", Size: 2}, {Path: "src/b.txt", Size: 3}}}
	bundle := folderBundle(t, manifest, "aabbb")
	decoded, headerSize, contentSize, err := ReadFolderBundleHeader(bundle, folderTestLimits)
	if err != nil || contentSize != 5 || headerSize+contentSize != bundle.Size() || len(decoded.Files) != 2 || len(decoded.Directories) != 2 {
		t.Fatalf("manifest=%+v header=%d content=%d err=%v", decoded, headerSize, contentSize, err)
	}
}

func TestFolderManifestRejectsUnsafeEntries(t *testing.T) {
	for _, manifest := range []FolderManifest{
		{Files: []FolderManifestFile{{Path: "../escape", Size: 1}}},
		{Files: []FolderManifestFile{{Path: "/etc/passwd", Size: 1}}},
		{Files: []FolderManifestFile{{Path: "a/./b", Size: 1}}},
		{Files: []FolderManifestFile{{Path: "a\\b", Size: 1}}},
		{Files: []FolderManifestFile{{Path: "missing/parent", Size: 1}}},
		{Directories: []string{"a"}, Files: []FolderManifestFile{{Path: "a", Size: 1}}},
		{Files: []FolderManifestFile{{Path: "a", Size: 1}, {Path: "a", Size: 1}}},
		{Files: []FolderManifestFile{{Path: "a", Size: -1}}},
	} {
		if _, err := manifest.Validate(folderTestLimits); err == nil {
			t.Fatalf("accepted %+v", manifest)
		}
	}
	deep := FolderManifest{Directories: []string{"a", "a/b"}}
	if _, err := deep.Validate(FolderLimits{MaxEntries: 100, MaxDepth: 1}); err == nil {
		t.Fatal("depth limit bypassed")
	}
	if _, err := deep.Validate(FolderLimits{MaxEntries: 1, MaxDepth: 10}); err == nil {
		t.Fatal("entry limit bypassed")
	}
}

func TestWriteFolderCreatesCompleteFolder(t *testing.T) {
	client := folderTestClient(t)
	parent := t.TempDir()
	target := filepath.Join(parent, "site")
	manifest := FolderManifest{Directories: []string{"assets", "empty"}, Files: []FolderManifestFile{{Path: "index.html", Size: 2}, {Path: "assets/app.js", Size: 3}}}
	content := folderBundle(t, manifest, "hiabc")
	if _, _, _, err := ReadFolderBundleHeader(content, folderTestLimits); err != nil {
		t.Fatal(err)
	}
	var last FolderProgress
	err := WriteFolder(context.Background(), client, manifest, content, FolderWrite{Target: target, Progress: func(progress FolderProgress) error {
		if progress.Files != 0 {
			t.Fatalf("new folder reported visible files before commit: %+v", progress)
		}
		last = progress
		return nil
	}})
	if err != nil || last.Written != 5 {
		t.Fatalf("progress=%+v err=%v", last, err)
	}
	data, err := os.ReadFile(filepath.Join(target, "assets", "app.js"))
	if err != nil || string(data) != "abc" {
		t.Fatalf("data=%q err=%v", data, err)
	}
	info, err := os.Stat(filepath.Join(target, "index.html"))
	if err != nil || info.Mode().Perm() != folderFileMode {
		t.Fatalf("file mode=%v err=%v", info.Mode(), err)
	}
	if info, err := os.Stat(filepath.Join(target, "empty")); err != nil || !info.IsDir() || info.Mode().Perm() != folderDirectoryMode {
		t.Fatalf("empty directory=%v err=%v", info, err)
	}
	assertNoUploadLeftovers(t, parent)
}

func TestWriteFolderFailureLeavesNoPartialFolder(t *testing.T) {
	client := folderTestClient(t)
	parent := t.TempDir()
	target := filepath.Join(parent, "site")
	manifest := FolderManifest{Files: []FolderManifestFile{{Path: "a", Size: 1}, {Path: "b", Size: 4}}}
	err := WriteFolder(context.Background(), client, manifest, strings.NewReader("ab"), FolderWrite{Target: target})
	if err == nil || !strings.Contains(err.Error(), "ended before b") {
		t.Fatalf("err=%v", err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("partial target exists: %v", err)
	}
	assertNoUploadLeftovers(t, parent)
}

func TestWriteFolderRefusesExistingWithoutMerge(t *testing.T) {
	client := folderTestClient(t)
	target := filepath.Join(t.TempDir(), "site")
	if err := os.Mkdir(target, 0755); err != nil {
		t.Fatal(err)
	}
	manifest := FolderManifest{Files: []FolderManifestFile{{Path: "a", Size: 1}}}
	if err := WriteFolder(context.Background(), client, manifest, strings.NewReader("a"), FolderWrite{Target: target}); !errors.Is(err, ErrFolderExists) {
		t.Fatalf("err=%v", err)
	}
}

func TestWriteFolderMergeReplacesFilesAndKeepsModes(t *testing.T) {
	client := folderTestClient(t)
	target := filepath.Join(t.TempDir(), "site")
	if err := os.MkdirAll(filepath.Join(target, "bin"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "bin", "run"), []byte("old"), 0750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "keep"), []byte("kept"), 0600); err != nil {
		t.Fatal(err)
	}
	manifest := FolderManifest{Directories: []string{"bin", "new"}, Files: []FolderManifestFile{{Path: "bin/run", Size: 3}, {Path: "new/a", Size: 1}}}
	var last FolderProgress
	err := WriteFolder(context.Background(), client, manifest, strings.NewReader("newa"), FolderWrite{Target: target, Merge: true, Progress: func(progress FolderProgress) error {
		last = progress
		return nil
	}})
	if err != nil || last.Files != 2 || last.Bytes != 4 {
		t.Fatalf("progress=%+v err=%v", last, err)
	}
	info, err := os.Stat(filepath.Join(target, "bin", "run"))
	if err != nil || info.Mode().Perm() != 0750 {
		t.Fatalf("replaced mode=%v err=%v", info.Mode(), err)
	}
	if data, _ := os.ReadFile(filepath.Join(target, "bin", "run")); string(data) != "new" {
		t.Fatalf("replaced data=%q", data)
	}
	if data, _ := os.ReadFile(filepath.Join(target, "keep")); string(data) != "kept" {
		t.Fatalf("unrelated file changed: %q", data)
	}
	assertNoUploadLeftovers(t, filepath.Join(target, "bin"))
}

func TestWriteFolderMergeRejectsTruncatedFileBeforeCommit(t *testing.T) {
	client := folderTestClient(t)
	target := filepath.Join(t.TempDir(), "site")
	if err := os.Mkdir(target, 0755); err != nil {
		t.Fatal(err)
	}
	existing := filepath.Join(target, "existing")
	if err := os.WriteFile(existing, []byte("original"), 0750); err != nil {
		t.Fatal(err)
	}
	manifest := FolderManifest{Files: []FolderManifestFile{{Path: "complete", Size: 1}, {Path: "existing", Size: 4}}}
	var last FolderProgress
	err := WriteFolder(context.Background(), client, manifest, strings.NewReader("ab"), FolderWrite{Target: target, Merge: true, Progress: func(progress FolderProgress) error {
		last = progress
		return nil
	}})
	if err == nil || !strings.Contains(err.Error(), "ended before existing") {
		t.Fatalf("err=%v", err)
	}
	if data, err := os.ReadFile(existing); err != nil || string(data) != "original" {
		t.Fatalf("original file changed: data=%q err=%v", data, err)
	}
	info, err := os.Stat(existing)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0750 {
		t.Fatalf("original mode changed: %v", info.Mode())
	}
	if data, err := os.ReadFile(filepath.Join(target, "complete")); err != nil || string(data) != "a" {
		t.Fatalf("completed file lost: data=%q err=%v", data, err)
	}
	if last.Files != 1 || last.Bytes != 1 {
		t.Fatalf("incomplete file counted as committed: %+v", last)
	}
	assertNoUploadLeftovers(t, target)
}

func TestWriteFolderMergeDoesNotFollowSymlinks(t *testing.T) {
	client := folderTestClient(t)
	target := filepath.Join(t.TempDir(), "site")
	outside := t.TempDir()
	if err := os.Mkdir(target, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(target, "link")); err != nil {
		t.Fatal(err)
	}
	manifest := FolderManifest{Directories: []string{"link"}, Files: []FolderManifestFile{{Path: "link/a", Size: 1}}}
	if err := WriteFolder(context.Background(), client, manifest, strings.NewReader("a"), FolderWrite{Target: target, Merge: true}); err == nil {
		t.Fatal("merge followed a symlinked directory")
	}
	if _, err := os.Lstat(filepath.Join(outside, "a")); !os.IsNotExist(err) {
		t.Fatalf("wrote outside target: %v", err)
	}
}

func assertNoUploadLeftovers(t *testing.T, directory string) {
	t.Helper()
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".easyssh-upload-") {
			t.Fatalf("temporary entry left behind: %s", entry.Name())
		}
	}
}
