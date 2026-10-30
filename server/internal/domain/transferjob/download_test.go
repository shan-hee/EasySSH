package transferjob

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/sftp"
	"github.com/easyssh/server/internal/domain/systemconfig"
)

type downloadFixture struct {
	files    map[string]string
	dirs     map[string][]string
	readFail string
	after    func(string)
}

func (f *downloadFixture) GetFileInfo(remote string) (*sftp.FileInfo, error) {
	info := &sftp.FileInfo{Name: path.Base(remote), Path: remote, Mode: 0600, ModTime: time.Unix(1700000000, 0)}
	if _, ok := f.dirs[remote]; ok {
		info.IsDir, info.Mode = true, os.ModeDir|0700
		return info, nil
	}
	if data, ok := f.files[remote]; ok {
		info.Size = int64(len(data))
		return info, nil
	}
	return nil, os.ErrNotExist
}

func (f *downloadFixture) ListDirectory(remote string) (*sftp.DirectoryListing, error) {
	listing := &sftp.DirectoryListing{}
	for _, name := range f.dirs[remote] {
		listing.Files = append(listing.Files, &sftp.FileInfo{Name: name})
	}
	return listing, nil
}

func (f *downloadFixture) DownloadFileToArtifactWithContext(ctx context.Context, remote string, writer io.Writer, progress func(int64)) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	data := f.files[remote]
	if remote == f.readFail {
		data = data[:len(data)/2]
	}
	n, err := io.WriteString(writer, data)
	progress(int64(n))
	if f.after != nil {
		f.after(remote)
	}
	if err != nil {
		return err
	}
	if remote == f.readFail {
		return io.ErrUnexpectedEOF
	}
	return nil
}

func downloadConfig() *systemconfig.SystemConfig {
	return &systemconfig.SystemConfig{TransferMaxEntries: 100, TransferMaxDepth: 8, TransferMaxStorageGB: 1}
}

func TestDownloadArchiveDistinctNamesAndExcludedSubtree(t *testing.T) {
	f := &downloadFixture{
		files: map[string]string{"/one/app/a.txt": "first", "/two/app/a.txt": "second", "/one/app/debug.log": "excluded"},
		dirs:  map[string][]string{"/one/app": {"a.txt", "debug.log", "node_modules"}, "/two/app": {"a.txt"}},
	}
	selection, err := normalizeDownloadSelection(&CreateDownloadRequest{SourcePaths: []string{"/one/app", "/two/app"}, ExcludePatterns: []string{"*.log", "node_modules"}}, downloadConfig())
	if err != nil {
		t.Fatal(err)
	}
	plan, err := planDownload(context.Background(), f, selection, downloadConfig())
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	var copied int64
	if err := writeDownload(context.Background(), f, plan, &output, func(n int64) { copied = n }); err != nil {
		t.Fatal(err)
	}
	if copied != 11 || plan.bytes != 11 || int64(output.Len()) > plan.storageBytes {
		t.Fatalf("invalid source/storage accounting: copied=%d plan=%+v archive=%d", copied, plan, output.Len())
	}
	archive, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"app/": "", "app/a.txt": "first", "app (2)/": "", "app (2)/a.txt": "second"}
	if len(archive.File) != len(want) {
		t.Fatalf("unexpected entries: %d", len(archive.File))
	}
	for _, file := range archive.File {
		expected, exists := want[file.Name]
		if !exists {
			t.Fatalf("unexpected entry: %s", file.Name)
		}
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(reader)
		reader.Close()
		if err != nil || string(body) != expected {
			t.Fatalf("entry %s: body=%q err=%v", file.Name, body, err)
		}
	}
}

func TestDownloadDirectoryUsesArchiveAndSingleFileStaysRaw(t *testing.T) {
	f := &downloadFixture{files: map[string]string{"/folder/data": "payload"}, dirs: map[string][]string{"/folder": {"data"}}}
	for _, remote := range []string{"/folder", "/folder/data"} {
		selection, err := normalizeDownloadSelection(&CreateDownloadRequest{SourcePath: remote}, downloadConfig())
		if err != nil {
			t.Fatal(err)
		}
		plan, err := planDownload(context.Background(), f, selection, downloadConfig())
		if err != nil || plan.archive != (remote == "/folder") {
			t.Fatalf("path=%s plan=%+v err=%v", remote, plan, err)
		}
		var output bytes.Buffer
		if err := writeDownload(context.Background(), f, plan, &output, func(int64) {}); err != nil {
			t.Fatal(err)
		}
		if !plan.archive && output.String() != "payload" {
			t.Fatal("single file was wrapped in an archive")
		}
	}
}

func TestDownloadPartialFailureAndCancellationDoNotFinalizeArchive(t *testing.T) {
	for _, cancelTransfer := range []bool{false, true} {
		t.Run(map[bool]string{false: "read_failure", true: "cancel"}[cancelTransfer], func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			f := &downloadFixture{files: map[string]string{"/data": "content"}}
			if cancelTransfer {
				f.after = func(string) { cancel() }
			} else {
				f.readFail = "/data"
			}
			plan, err := planDownload(ctx, f, downloadSelection{Paths: []string{"/data"}, Archive: true}, downloadConfig())
			if err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			var copied int64
			err = writeDownload(ctx, f, plan, &output, func(n int64) { copied = n })
			if err == nil || copied == 0 || cancelTransfer && !errors.Is(err, context.Canceled) {
				t.Fatalf("err=%v copied=%d", err, copied)
			}
			if _, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len())); err == nil {
				t.Fatal("partial archive was finalized")
			}
		})
	}
}

func TestDownloadLimitsAndChangedSize(t *testing.T) {
	f := &downloadFixture{files: map[string]string{"/dir/sub/data": "x"}, dirs: map[string][]string{"/dir": {"sub"}, "/dir/sub": {"data"}}}
	selection := downloadSelection{Paths: []string{"/dir"}}
	for _, cfg := range []*systemconfig.SystemConfig{
		{TransferMaxEntries: 2, TransferMaxDepth: 8, TransferMaxStorageGB: 1},
		{TransferMaxEntries: 100, TransferMaxDepth: 1, TransferMaxStorageGB: 1},
	} {
		if _, err := planDownload(context.Background(), f, selection, cfg); err == nil {
			t.Fatal("configured enumeration limit ignored")
		}
	}
	plan, err := planDownload(context.Background(), f, selection, downloadConfig())
	if err != nil {
		t.Fatal(err)
	}
	f.files["/dir/sub/data"] = "changed"
	if err := writeDownload(context.Background(), f, plan, io.Discard, func(int64) {}); err == nil {
		t.Fatal("changed source size reported as a complete snapshot")
	}
}

func TestDownloadSelectionDefaultsAndExplicitEmptyExclusions(t *testing.T) {
	cfg := downloadConfig()
	cfg.DownloadExcludePatterns = "*.log\nnode_modules"
	selection, err := normalizeDownloadSelection(&CreateDownloadRequest{SourcePath: "/log/error.log"}, cfg)
	if err != nil || len(selection.ExcludePatterns) != 2 {
		t.Fatalf("selection=%+v err=%v", selection, err)
	}
	f := &downloadFixture{files: map[string]string{"/log/error.log": "log"}}
	plan, err := planDownload(context.Background(), f, selection, cfg)
	if err != nil || plan.archive || plan.bytes != 3 {
		t.Fatalf("explicit single file was excluded: plan=%+v err=%v", plan, err)
	}
	selection, err = normalizeDownloadSelection(&CreateDownloadRequest{SourcePaths: []string{"/log/error.log"}, ExcludePatterns: []string{}}, cfg)
	if err != nil || len(selection.ExcludePatterns) != 0 {
		t.Fatalf("explicit empty exclusions replaced by defaults: %+v %v", selection, err)
	}
}

func TestDownloadNamesRemainDistinctWhenSuffixAlreadyExists(t *testing.T) {
	used := map[string]bool{}
	for index, name := range []string{"app", "app (2)", "app", "app"} {
		got := uniqueDownloadName(name, used)
		want := []string{"app", "app (2)", "app (3)", "app (4)"}[index]
		if got != want {
			t.Fatalf("got %q want %q", got, want)
		}
	}
}
