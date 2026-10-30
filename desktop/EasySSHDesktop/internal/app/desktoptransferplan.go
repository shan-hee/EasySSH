package app

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"

	"github.com/easyssh/shared/protocol"
	"github.com/pkg/sftp"
)

type desktopTransferTree interface {
	Lstat(string) (os.FileInfo, error)
	ReadDir(string) ([]os.FileInfo, error)
}

type desktopTransferSelection struct {
	Paths           []string `json:"source_paths"`
	ExcludePatterns []string `json:"exclude_patterns"`
	Archive         bool     `json:"archive"`
}

type desktopTransferEntry struct {
	remote, name string
	info         os.FileInfo
}
type desktopTransferPlan struct {
	entries         []desktopTransferEntry
	bytes           int64
	files, excluded int
	archive         bool
}

func normalizeDesktopTransferSelection(paths, patterns []string, archive bool) (desktopTransferSelection, error) {
	selection := desktopTransferSelection{Paths: append([]string(nil), paths...), ExcludePatterns: append([]string(nil), patterns...), Archive: archive}
	if len(paths) == 0 || len(paths) > 100 || len(patterns) > 100 || !archive && len(paths) != 1 {
		return selection, errors.New("invalid transfer selection size")
	}
	seen := make(map[string]bool)
	for i, p := range selection.Paths {
		if !path.IsAbs(p) || len(p) > 4096 || strings.ContainsAny(p, "\\\x00") {
			return selection, errors.New("remote source must be an absolute path")
		}
		p = path.Clean(p)
		if p == "/" || seen[p] {
			return selection, errors.New("filesystem root and duplicate sources are not supported")
		}
		seen[p], selection.Paths[i] = true, p
	}
	for _, pattern := range patterns {
		if pattern == "" || len(pattern) > 255 || strings.ContainsAny(pattern, "/\\\x00") {
			return selection, errors.New("invalid exclusion name pattern")
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return selection, err
		}
	}
	return selection, nil
}

// Both download and native relay consume this one snapshot. The budget counts
// excluded entries too; no second recursive size walk precedes execution.
func planDesktopTransfer(ctx context.Context, source desktopTransferTree, selection desktopTransferSelection, limits protocol.TransferLimits) (desktopTransferPlan, error) {
	plan := desktopTransferPlan{archive: selection.Archive}
	if limits.MaxEntries < 1 || limits.MaxDepth < 1 {
		return plan, errors.New("invalid transfer limits")
	}
	visited := 0
	var visit func(string, string, int) error
	visit = func(remote, name string, depth int) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		visited++
		if visited > limits.MaxEntries || depth > limits.MaxDepth {
			return errors.New("transfer entry or nesting limit exceeded")
		}
		if depth > 0 || selection.Archive {
			for _, pattern := range selection.ExcludePatterns {
				if matched, _ := path.Match(pattern, path.Base(remote)); matched {
					plan.excluded++
					return nil
				}
			}
		}
		info, err := source.Lstat(remote)
		if err != nil {
			return err
		}
		if !info.IsDir() && !info.Mode().IsRegular() || info.Size() < 0 {
			return errors.New("transfer requires regular files and directories")
		}
		if len(name) > 65534 {
			return errors.New("archive entry name is too long")
		}
		plan.entries = append(plan.entries, desktopTransferEntry{remote: remote, name: name, info: info})
		if !info.IsDir() {
			if plan.bytes > (1<<63-1)-info.Size() {
				return errors.New("transfer size overflow")
			}
			plan.bytes += info.Size()
			plan.files++
			return nil
		}
		plan.archive = true
		entries, err := source.ReadDir(remote)
		if err != nil {
			return err
		}
		seen := make(map[string]bool)
		for _, entry := range entries {
			if entry == nil {
				return errors.New("invalid directory entry")
			}
			child := entry.Name()
			if child == "" || child == "." || child == ".." || strings.ContainsAny(child, "/\\\x00") || seen[child] {
				return errors.New("invalid directory entry")
			}
			seen[child] = true
			if err := visit(path.Join(remote, child), path.Join(name, child), depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	used := make(map[string]bool)
	for _, remote := range selection.Paths {
		name := path.Base(remote)
		candidate := name
		for suffix := 2; used[candidate]; suffix++ {
			candidate = desktopTransferSuffixedName(name, suffix)
		}
		used[candidate] = true
		if err := visit(remote, candidate, 0); err != nil {
			return plan, err
		}
	}
	if len(plan.entries) == 0 {
		return plan, errors.New("selection contains no included entries")
	}
	return plan, nil
}

func desktopTransferSuffixedName(name string, suffix int) string {
	ext := path.Ext(name)
	if ext == name {
		ext = ""
	}
	return fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(name, ext), suffix, ext)
}

func writeDesktopTransferArchive(ctx context.Context, client *sftp.Client, plan desktopTransferPlan, output io.Writer, progress func(int64) error) error {
	var archive *zip.Writer
	if plan.archive {
		archive = zip.NewWriter(output)
	}
	var processed int64
	for _, entry := range plan.entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		writer := output
		if archive != nil {
			name := entry.name
			if entry.info.IsDir() {
				name += "/"
			}
			header := &zip.FileHeader{Name: name, Method: zip.Store}
			header.SetMode(entry.info.Mode())
			header.SetModTime(entry.info.ModTime())
			var err error
			writer, err = archive.CreateHeader(header)
			if err != nil {
				return err
			}
		}
		if entry.info.IsDir() {
			continue
		}
		input, err := client.Open(entry.remote)
		if err != nil {
			return err
		}
		var written int64
		tracked := newDesktopSFTPProgressWriter(writer, entry.info.Size(), func(n, total int64) error {
			written = n
			if progress != nil {
				return progress(processed + n)
			}
			return nil
		})
		_, copyErr := copyDesktopSFTPExact(tracked, input, entry.info)
		closeErr := input.Close()
		if err := errors.Join(copyErr, closeErr); err != nil {
			return err
		}
		processed += written
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if archive != nil {
		return archive.Close()
	}
	return nil
}
