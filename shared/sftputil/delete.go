package sftputil

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"strings"
	"unicode/utf8"
)

const (
	MaxDeleteRequestBytes = 100*4096*6 + 8192 // worst-case JSON escaping of bounded paths
	MaxDeleteEntries      = 10000
	MaxDeleteDepth        = 256
	MaxDeletePath         = 4096
)

var (
	ErrDeleteLimit   = errors.New("recursive deletion limit exceeded")
	ErrDeleteReceipt = errors.New("deletion receipt was not saved")
)

// DeleteFS deliberately exposes no shell or retry operation. A lost mutation
// response must never cause the same operation to be executed again.
type DeleteFS interface {
	Lstat(string) (os.FileInfo, error)
	ReadDir(string) ([]os.FileInfo, error)
	Remove(string) error
	RemoveDirectory(string) error
}

type DeleteReceipt struct {
	Path    string `json:"path"`
	Kind    string `json:"kind"`
	Outcome string `json:"outcome"` // removed, missing, failed, unknown, canceled
	Bytes   int64  `json:"bytes,omitempty"`
	Error   string `json:"error,omitempty"`
}

// One report is shared by all roots in a batch. Receipts include confirmed
// children even when their parent cannot be removed. Bytes describe observed
// regular-file sizes, not transferred bytes or reclaimed filesystem space.
type DeleteReport struct {
	FilesRemoved       int64           `json:"files_removed"`
	DirectoriesRemoved int64           `json:"directories_removed"`
	BytesRemoved       int64           `json:"bytes_removed"`
	UncertainPath      string          `json:"uncertain_path,omitempty"`
	StoppedPath        string          `json:"stopped_path,omitempty"`
	Visited            int             `json:"visited"`
	Receipts           []DeleteReceipt `json:"receipts,omitempty"`
	stopped            error
	discovered         int
}

// DeleteObserver must persist observations, never re-execute operations. On
// success the observation is not duplicated in Report. A failed write retains
// that final receipt and stops traversal before any next IO.
type DeleteObserver func(DeleteReceipt) error

func ValidateDeletePath(value string) (string, error) {
	if len(value) == 0 || len(value) > MaxDeletePath || !utf8.ValidString(value) || strings.ContainsRune(value, 0) || !strings.HasPrefix(value, "/") {
		return "", errors.New("deletion requires a valid absolute path of at most 4096 bytes")
	}
	for _, part := range strings.Split(value, "/") {
		if part == ".." {
			return "", errors.New("deletion path must not contain '..'")
		}
	}
	value = path.Clean(value)
	switch value {
	case "/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var":
		return "", fmt.Errorf("refusing to delete protected path %s", value)
	}
	return value, nil
}

// DeleteTree uses Lstat for every visited entry; listing attributes are never
// used to decide whether to recurse into a link. SFTP v3 cannot atomically bind
// Lstat and later path operations, so concurrent remote renames remain possible.
func DeleteTree(ctx context.Context, fs DeleteFS, root string, report *DeleteReport, observe DeleteObserver) error {
	root, err := ValidateDeletePath(root)
	if err != nil {
		return err
	}
	if report.stopped != nil {
		return report.stopped
	}
	if report.discovered >= MaxDeleteEntries {
		return report.record(DeleteReceipt{Path: root, Kind: "entry", Outcome: "failed"}, ErrDeleteLimit, observe)
	}
	report.discovered++
	return deleteTree(ctx, fs, root, report, observe, 0)
}

func deleteTree(ctx context.Context, fs DeleteFS, target string, report *DeleteReport, observe DeleteObserver, depth int) error {
	if report.stopped != nil {
		return report.stopped
	}
	if err := ctx.Err(); err != nil {
		return report.record(DeleteReceipt{Path: target, Kind: "entry", Outcome: "canceled"}, err, observe)
	}
	if depth > MaxDeleteDepth || report.Visited >= MaxDeleteEntries || len(target) > MaxDeletePath {
		return report.record(DeleteReceipt{Path: target, Kind: "entry", Outcome: "failed"}, ErrDeleteLimit, observe)
	}
	report.Visited++
	info, err := fs.Lstat(target)
	if err != nil {
		return report.readFailure(ctx, target, "entry", err, observe)
	}
	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		if err := ctx.Err(); err != nil {
			return report.record(DeleteReceipt{Path: target, Kind: "directory", Outcome: "canceled"}, err, observe)
		}
		// pkg/sftp ReadDir materializes a whole directory. This check bounds our
		// traversal and receipts, not the transport library's listing allocation.
		entries, err := fs.ReadDir(target)
		if err != nil {
			return report.readFailure(ctx, target, "directory", err, observe)
		}
		if len(entries) > MaxDeleteEntries-report.discovered {
			return report.record(DeleteReceipt{Path: target, Kind: "directory", Outcome: "failed"}, ErrDeleteLimit, observe)
		}
		// Count all discovered siblings before descending. Otherwise a deep
		// first child could retain an entire near-limit listing at every level.
		report.discovered += len(entries)
		// Validate the whole listing before mutating any child from this listing.
		seen := make(map[string]struct{}, len(entries))
		for _, entry := range entries {
			if entry == nil {
				return report.record(DeleteReceipt{Path: target, Kind: "directory", Outcome: "failed"}, errors.New("invalid directory entry"), observe)
			}
			name := entry.Name()
			_, duplicate := seen[name]
			if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\x00") || !utf8.ValidString(name) || len(path.Join(target, name)) > MaxDeletePath || duplicate {
				return report.record(DeleteReceipt{Path: target, Kind: "directory", Outcome: "failed"}, errors.New("invalid or duplicate directory entry name"), observe)
			}
			seen[name] = struct{}{}
		}
		for _, entry := range entries {
			if err := deleteTree(ctx, fs, path.Join(target, entry.Name()), report, observe, depth+1); err != nil {
				return err
			}
		}
	}
	return DeleteEntry(ctx, fs, target, info, report, observe)
}

// DeleteEntry removes exactly one entry using already observed Lstat metadata.
// Callers which need recursion must use DeleteTree instead.
func DeleteEntry(ctx context.Context, fs DeleteFS, target string, info os.FileInfo, report *DeleteReport, observe DeleteObserver) error {
	if report.stopped != nil {
		return report.stopped
	}
	if _, err := ValidateDeletePath(target); err != nil {
		return err
	}
	if info == nil {
		return errors.New("deletion requires entry metadata")
	}
	receipt := DeleteReceipt{Path: target, Kind: "file", Outcome: "removed"}
	if info.Mode()&os.ModeSymlink != 0 {
		receipt.Kind = "symlink"
	} else if info.IsDir() {
		receipt.Kind = "directory"
	}
	if err := ctx.Err(); err != nil {
		receipt.Outcome = "canceled"
		return report.record(receipt, err, observe)
	}
	var err error
	if receipt.Kind == "directory" {
		err = fs.RemoveDirectory(target)
	} else {
		err = fs.Remove(target)
	}
	if err != nil {
		err = MutationError(err)
		receipt.Outcome = "failed"
		if errors.Is(err, ErrMutationOutcomeUnknown) {
			receipt.Outcome = "unknown"
			report.UncertainPath = target
		} else if os.IsNotExist(err) {
			receipt.Outcome = "missing"
			err = nil
		}
		return report.record(receipt, err, observe)
	}
	if receipt.Kind == "directory" {
		report.DirectoriesRemoved++
	} else {
		report.FilesRemoved++
		if info.Mode().IsRegular() && info.Size() > 0 {
			receipt.Bytes = info.Size()
			report.BytesRemoved += receipt.Bytes
		}
	}
	return report.record(receipt, nil, observe)
}

func (r *DeleteReport) readFailure(ctx context.Context, target, kind string, err error, observe DeleteObserver) error {
	receipt := DeleteReceipt{Path: target, Kind: kind, Outcome: "failed"}
	if os.IsNotExist(err) {
		receipt.Outcome, err = "missing", nil
	} else if ctx.Err() != nil {
		receipt.Outcome, err = "canceled", ctx.Err()
	}
	return r.record(receipt, err, observe)
}

func (r *DeleteReport) record(receipt DeleteReceipt, err error, observe DeleteObserver) error {
	if err != nil {
		receipt.Error = err.Error()
		r.StoppedPath = receipt.Path
	}
	if observe == nil {
		r.Receipts = append(r.Receipts, receipt)
	}
	if observe != nil {
		if saveErr := observe(receipt); saveErr != nil {
			r.Receipts = append(r.Receipts, receipt)
			err = errors.Join(err, fmt.Errorf("%w: %v", ErrDeleteReceipt, saveErr))
			r.StoppedPath = receipt.Path
		}
	}
	if errors.Is(err, ErrMutationOutcomeUnknown) || errors.Is(err, ErrDeleteLimit) || errors.Is(err, ErrDeleteReceipt) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		r.stopped = err
	}
	return err
}
