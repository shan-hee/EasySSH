package sftputil

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

type deleteFixture struct {
	mutations []string
	readErr   error
	removeErr error
	loseReply bool
	listing   []os.FileInfo
}

func (f *deleteFixture) Lstat(p string) (os.FileInfo, error) { return os.Lstat(p) }
func (f *deleteFixture) ReadDir(p string) ([]os.FileInfo, error) {
	if f.readErr != nil {
		return nil, f.readErr
	}
	if f.listing != nil {
		return f.listing, nil
	}
	entries, err := os.ReadDir(p)
	if err != nil {
		return nil, err
	}
	var result []os.FileInfo
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		result = append(result, info)
	}
	return result, nil
}
func (f *deleteFixture) Remove(p string) error {
	f.mutations = append(f.mutations, p)
	if f.removeErr != nil {
		return f.removeErr
	}
	if err := os.Remove(p); err != nil {
		return err
	}
	if f.loseReply {
		return io.EOF
	}
	return nil
}
func (f *deleteFixture) RemoveDirectory(p string) error { return f.Remove(p) }

func deleteFileFixture(t *testing.T, root, name string) string {
	t.Helper()
	p := filepath.Join(root, name)
	if err := os.WriteFile(p, []byte("payload"), 0600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDeleteTreeDoesNotFollowListedSymlink(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	kept := deleteFileFixture(t, outside, "kept")
	link := filepath.Join(root, "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	// The directory listing lies; Lstat must be used before traversal.
	info, err := os.Stat(link)
	if err != nil {
		t.Fatal(err)
	}
	fs := &deleteFixture{listing: []os.FileInfo{info}}
	var report DeleteReport
	if err := DeleteTree(context.Background(), fs, root, &report, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(kept); err != nil {
		t.Fatalf("followed link: %v", err)
	}
	if report.FilesRemoved != 1 || report.DirectoriesRemoved != 1 || report.BytesRemoved != 0 || report.Receipts[0].Kind != "symlink" {
		t.Fatalf("bad receipts: %+v", report)
	}
}

func TestDeleteLostResponseStopsBatchWithoutReplay(t *testing.T) {
	root := t.TempDir()
	first, second := deleteFileFixture(t, root, "a"), deleteFileFixture(t, root, "b")
	fs := &deleteFixture{loseReply: true}
	var report DeleteReport
	for _, p := range []string{first, second} {
		if err := DeleteTree(context.Background(), fs, p, &report, nil); !errors.Is(err, ErrMutationOutcomeUnknown) {
			t.Fatalf("unknown erased: %v", err)
		}
	}
	if len(fs.mutations) != 1 || report.UncertainPath != first || report.FilesRemoved != 0 || len(report.Receipts) != 1 {
		t.Fatalf("replayed or invented effect: %+v %+v", fs, report)
	}
	if _, err := os.Stat(second); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteReceiptFailurePreservesSuccessAndStopsBeforeNextEntry(t *testing.T) {
	root := t.TempDir()
	deleteFileFixture(t, root, "a")
	kept := deleteFileFixture(t, root, "b")
	fs := &deleteFixture{}
	var report DeleteReport
	err := DeleteTree(context.Background(), fs, root, &report, func(DeleteReceipt) error { return errors.New("database offline") })
	if !errors.Is(err, ErrDeleteReceipt) || report.FilesRemoved != 1 || report.BytesRemoved != 7 || report.UncertainPath != "" || report.Receipts[0].Outcome != "removed" {
		t.Fatalf("confirmed result lost: %+v %v", report, err)
	}
	if _, err := os.Stat(kept); err != nil {
		t.Fatal(err)
	}
	if err := DeleteTree(context.Background(), fs, kept, &report, nil); !errors.Is(err, ErrDeleteReceipt) || len(fs.mutations) != 1 {
		t.Fatalf("continued after failed persistence: %v", err)
	}
}

func TestDeleteReadFailureNeverGuessesMutation(t *testing.T) {
	fs := &deleteFixture{readErr: os.ErrPermission}
	var report DeleteReport
	err := DeleteTree(context.Background(), fs, t.TempDir(), &report, nil)
	if !errors.Is(err, os.ErrPermission) || len(fs.mutations) != 0 || len(report.Receipts) != 1 || report.Receipts[0].Outcome != "failed" {
		t.Fatalf("read failure attempted removal: %+v %v", report, err)
	}
}

func TestDeleteCancellationPreservesAlreadyAcknowledgedChildren(t *testing.T) {
	root := t.TempDir()
	deleteFileFixture(t, root, "a")
	kept := deleteFileFixture(t, root, "b")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	fs := &deleteFixture{}
	var report DeleteReport
	err := DeleteTree(ctx, fs, root, &report, func(r DeleteReceipt) error {
		if r.Outcome == "removed" {
			cancel()
		}
		return nil
	})
	if !errors.Is(err, context.Canceled) || len(fs.mutations) != 1 || report.FilesRemoved != 1 || report.BytesRemoved != 7 || report.UncertainPath != "" {
		t.Fatalf("cancellation erased success: %+v %v", report, err)
	}
	if _, err := os.Stat(kept); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteBudgetAppliesAcrossRoots(t *testing.T) {
	root := t.TempDir()
	first, kept := deleteFileFixture(t, root, "a"), deleteFileFixture(t, root, "b")
	fs := &deleteFixture{}
	report := DeleteReport{Visited: MaxDeleteEntries - 1, discovered: MaxDeleteEntries - 1}
	if err := DeleteTree(context.Background(), fs, first, &report, nil); err != nil {
		t.Fatal(err)
	}
	if err := DeleteTree(context.Background(), fs, kept, &report, nil); !errors.Is(err, ErrDeleteLimit) {
		t.Fatalf("reset budget: %v", err)
	}
	if len(fs.mutations) != 1 {
		t.Fatalf("over-budget mutation: %+v", fs)
	}
}

type deletionNamedInfo struct {
	os.FileInfo
	name string
}

func (f deletionNamedInfo) Name() string { return f.name }
func TestDeleteRejectsMalformedListingBeforeMutatingChildren(t *testing.T) {
	for _, name := range []string{"../escape", "a/b", ".", "..", "", "a\x00b"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			file := deleteFileFixture(t, root, "good")
			info, err := os.Lstat(file)
			if err != nil {
				t.Fatal(err)
			}
			fs := &deleteFixture{listing: []os.FileInfo{info, deletionNamedInfo{info, name}}}
			var report DeleteReport
			if err := DeleteTree(context.Background(), fs, root, &report, nil); err == nil || len(fs.mutations) != 0 {
				t.Fatalf("accepted bad listing %q: %v", name, err)
			}
		})
	}
}

func TestDeleteReceiptTimeoutDoesNotInventExecutionCancellation(t *testing.T) {
	root := t.TempDir()
	p := deleteFileFixture(t, root, "removed")
	var report DeleteReport
	err := DeleteTree(context.Background(), &deleteFixture{}, p, &report, func(DeleteReceipt) error { return context.DeadlineExceeded })
	if !errors.Is(err, ErrDeleteReceipt) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || report.FilesRemoved != 1 {
		t.Fatalf("storage timeout became remote cancellation: %+v %v", report, err)
	}
}
