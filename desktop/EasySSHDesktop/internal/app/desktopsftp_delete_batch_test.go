package app

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/easyssh/shared/sftputil"
)

type desktopDeleteFSFixture struct {
	sftputil.DeleteFS
	statPath    string
	statErr     error
	afterRemove func(string) error
	stats       []string
	removes     []string
}

func (f *desktopDeleteFSFixture) Lstat(p string) (os.FileInfo, error) {
	f.stats = append(f.stats, p)
	if p == f.statPath {
		return nil, f.statErr
	}
	return os.Lstat(p)
}
func (f *desktopDeleteFSFixture) Remove(p string) error {
	f.removes = append(f.removes, p)
	if err := os.Remove(p); err != nil {
		return err
	}
	if f.afterRemove != nil {
		return f.afterRemove(p)
	}
	return nil
}

func TestDesktopDeleteBatchStopsAtDeadlineAndRetainsCompletedRoots(t *testing.T) {
	for _, recursive := range []bool{false, true} {
		t.Run(map[bool]string{false: "flat", true: "recursive"}[recursive], func(t *testing.T) {
			tasks, _ := desktopTaskFixture(t)
			files := NewDesktopSFTPService(nil, tasks, nil)
			root := t.TempDir()
			paths := []string{filepath.Join(root, "removed"), filepath.Join(root, "timed-out"), filepath.Join(root, "unvisited")}
			for _, p := range paths {
				if err := os.WriteFile(p, []byte("payload"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			kind := desktopSFTPTaskDeleteEntry
			if recursive {
				kind = desktopSFTPTaskDelete
			}
			ctx, id, cancel, err := files.beginFileMutation(context.Background(), kind, "server", root, 3)
			if err != nil {
				t.Fatal(err)
			}
			defer cancel()
			fs := &desktopDeleteFSFixture{statPath: paths[1], statErr: context.DeadlineExceeded}
			result, operationErr := files.deletePathsOnClient(ctx, fs, paths, recursive, id)
			if !errors.Is(operationErr, context.DeadlineExceeded) || len(result.Success) != 1 || len(result.Failed) != 0 || len(fs.stats) != 2 || len(fs.removes) != 1 {
				t.Fatalf("timeout counted unvisited paths as failures: %+v %v stats=%v", result, operationErr, fs.stats)
			}
			detail := desktopSFTPDeleteDetails(paths, result, operationErr)
			if len(detail["unresolved_paths"].([]string)) != 2 || result.Effects.FilesRemoved != 1 {
				t.Fatalf("lost partial deletion facts: %+v", detail)
			}
			run, err := tasks.getRun(id)
			if err != nil || run.SuccessCount != 1 || run.FailureCount != 0 || run.Progress != 33 {
				t.Fatalf("root checkpoint missing: %+v %v", run, err)
			}
			// Recovery may not claim an unfinished root, but must retain the
			// committed first root instead of resetting its count to zero.
			if err := tasks.recoverInterrupted(context.Background()); err != nil {
				t.Fatal(err)
			}
			run, err = tasks.getRun(id)
			if err != nil || run.Status != "unknown" || run.SuccessCount != 1 || run.FailureCount != 0 {
				t.Fatalf("recovery lost confirmed deletion: %+v %v", run, err)
			}
		})
	}
}

func TestDesktopDeleteBatchCancellationAndLostReplyDoNotTouchNextPath(t *testing.T) {
	for _, lost := range []bool{false, true} {
		root := t.TempDir()
		paths := []string{filepath.Join(root, "first"), filepath.Join(root, "next")}
		for _, p := range paths {
			if err := os.WriteFile(p, []byte("data"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		ctx, cancel := context.WithCancel(context.Background())
		fs := &desktopDeleteFSFixture{afterRemove: func(string) error {
			cancel()
			if lost {
				return io.EOF
			}
			return nil
		}}
		files := NewDesktopSFTPService(nil, nil, nil)
		result, err := files.deletePathsOnClient(ctx, fs, paths, false, "")
		cancel()
		if len(result.Failed) != 0 || len(fs.removes) != 1 || len(fs.stats) != 1 {
			t.Fatalf("continued after cancellation/lost reply: %+v %v", result, err)
		}
		if lost && (!errors.Is(err, sftputil.ErrMutationOutcomeUnknown) || len(result.Success) != 0) {
			t.Fatalf("lost response claimed definite result: %+v %v", result, err)
		}
		if !lost && (!errors.Is(err, context.Canceled) || len(result.Success) != 1) {
			t.Fatalf("late cancellation erased confirmed success: %+v %v", result, err)
		}
		if _, err := os.Stat(paths[1]); err != nil {
			t.Fatal("later path was touched", err)
		}
	}
}
