package sftputil

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/pkg/sftp"
)

// A folder upload travels as one body so a browser can send a whole tree in a
// single request with an exact length: the magic, a big-endian uint32 manifest
// length, the JSON manifest, then every file's bytes in manifest order.
const (
	FolderBundleMagic      = "EASYSSH-FOLDER-1\n"
	MaxFolderManifestBytes = 32 << 20

	folderFileMode      os.FileMode = 0644
	folderDirectoryMode os.FileMode = 0755
)

var ErrFolderExists = errors.New("upload folder already exists")

// Paths are relative to the uploaded folder. A directory is listed after its
// parent; empty directories are listed too, since files do not imply them.
type FolderManifest struct {
	Directories []string             `json:"directories"`
	Files       []FolderManifestFile `json:"files"`
}

type FolderManifestFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

type FolderLimits struct {
	MaxEntries int
	MaxDepth   int
}

func EncodeFolderBundleHeader(manifest FolderManifest) ([]byte, error) {
	data, err := json.Marshal(manifest)
	if err != nil {
		return nil, err
	}
	if len(data) > MaxFolderManifestBytes {
		return nil, errors.New("folder manifest is too large")
	}
	header := make([]byte, 0, len(FolderBundleMagic)+4+len(data))
	header = append(header, FolderBundleMagic...)
	header = binary.BigEndian.AppendUint32(header, uint32(len(data)))
	return append(header, data...), nil
}

// ReadFolderBundleHeader consumes the header and returns the validated manifest,
// the header length and the number of content bytes that must follow it.
func ReadFolderBundleHeader(reader io.Reader, limits FolderLimits) (FolderManifest, int64, int64, error) {
	var manifest FolderManifest
	prefix := make([]byte, len(FolderBundleMagic)+4)
	if _, err := io.ReadFull(reader, prefix); err != nil {
		return manifest, 0, 0, fmt.Errorf("invalid folder bundle: %w", err)
	}
	if string(prefix[:len(FolderBundleMagic)]) != FolderBundleMagic {
		return manifest, 0, 0, errors.New("invalid folder bundle")
	}
	size := binary.BigEndian.Uint32(prefix[len(FolderBundleMagic):])
	if size == 0 || size > MaxFolderManifestBytes {
		return manifest, 0, 0, errors.New("invalid folder manifest size")
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return manifest, 0, 0, fmt.Errorf("invalid folder bundle: %w", err)
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return manifest, 0, 0, fmt.Errorf("invalid folder manifest: %w", err)
	}
	content, err := manifest.Validate(limits)
	if err != nil {
		return manifest, 0, 0, err
	}
	return manifest, int64(len(prefix)) + int64(size), content, nil
}

// Validate returns the total file size. Names are never cleaned: a path that
// would change under cleaning is rejected rather than written somewhere else.
func (m FolderManifest) Validate(limits FolderLimits) (int64, error) {
	if limits.MaxEntries < 1 || limits.MaxDepth < 1 {
		return 0, errors.New("invalid folder upload limits")
	}
	if len(m.Directories)+len(m.Files) > limits.MaxEntries {
		return 0, errors.New("folder upload entry limit exceeded")
	}
	directories := make(map[string]bool, len(m.Directories))
	check := func(name string) error {
		if !validFolderEntry(name) {
			return fmt.Errorf("invalid folder entry: %q", name)
		}
		if strings.Count(name, "/")+1 > limits.MaxDepth {
			return errors.New("folder upload nesting limit exceeded")
		}
		if parent := path.Dir(name); parent != "." && !directories[parent] {
			return fmt.Errorf("folder entry is listed before its parent: %q", name)
		}
		if directories[name] {
			return fmt.Errorf("duplicate folder entry: %q", name)
		}
		return nil
	}
	for _, name := range m.Directories {
		if err := check(name); err != nil {
			return 0, err
		}
		directories[name] = true
	}
	files := make(map[string]bool, len(m.Files))
	var total int64
	for _, file := range m.Files {
		if err := check(file.Path); err != nil {
			return 0, err
		}
		if files[file.Path] {
			return 0, fmt.Errorf("duplicate folder entry: %q", file.Path)
		}
		files[file.Path] = true
		if file.Size < 0 || total > math.MaxInt64-file.Size {
			return 0, errors.New("invalid folder file size")
		}
		total += file.Size
	}
	return total, nil
}

func validFolderEntry(name string) bool {
	if name == "" || len(name) > 4096 || !utf8.ValidString(name) || strings.ContainsAny(name, "\\\x00") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." || len(part) > 255 {
			return false
		}
	}
	return true
}

// A new folder becomes visible only on success, so Files and Bytes count only
// merged files; callers record the full totals when WriteFolder succeeds.
type FolderProgress struct {
	Written int64 // content bytes sent to the remote
	Files   int   // files committed at the target
	Bytes   int64 // content bytes of those files
}

type FolderWrite struct {
	// Target is the remote folder. Without Merge it must not exist yet.
	Target string
	// Merge writes into an existing folder and replaces same-named files.
	Merge bool
	// Check runs before each remote mutation.
	Check    func() error
	Progress func(FolderProgress) error
}

// WriteFolder writes a new folder into a private sibling directory and renames
// it into place only after every file was written, so a failure never leaves a
// partial folder at Target. A merge writes in place: each file is replaced
// atomically, but files committed before a failure remain.
func WriteFolder(ctx context.Context, client *sftp.Client, manifest FolderManifest, content io.Reader, options FolderWrite) (err error) {
	writer := &folderWriter{ctx: ctx, client: client, options: options}
	target := path.Clean(options.Target)
	info, err := client.Lstat(target)
	switch {
	case err == nil && !info.IsDir():
		return fmt.Errorf("upload target exists and is not a directory: %s", target)
	case err == nil && !options.Merge:
		return ErrFolderExists
	case err == nil:
		writer.root, writer.merge = target, true
	case os.IsNotExist(err):
		writer.root = path.Join(path.Dir(target), ".easyssh-upload-"+uuid.NewString())
	default:
		return err
	}
	if !writer.merge {
		if err := writer.check(); err != nil {
			return err
		}
		if err := client.Mkdir(writer.root); err != nil {
			return err
		}
		committed := false
		defer func() {
			if !committed {
				err = errors.Join(err, writer.discard())
			}
		}()
		// Files stay private until the folder is complete and renamed into place.
		if err := client.Chmod(writer.root, 0700); err != nil {
			return err
		}
		if err := writer.write(manifest, content); err != nil {
			return err
		}
		if err := writer.check(); err != nil {
			return err
		}
		if err := client.Chmod(writer.root, folderDirectoryMode); err != nil {
			return err
		}
		// Plain SFTP rename refuses an existing destination; also catch servers
		// that implement it with overwrite semantics.
		if _, err := client.Lstat(target); err == nil {
			return ErrFolderExists
		} else if !os.IsNotExist(err) {
			return err
		}
		if err := client.Rename(writer.root, target); err != nil {
			err = MutationError(err)
			// After an unknown rename the private folder may already be the target.
			committed = errors.Is(err, ErrMutationOutcomeUnknown)
			return err
		}
		committed = true
		return nil
	}
	return writer.write(manifest, content)
}

type folderWriter struct {
	ctx      context.Context
	client   *sftp.Client
	options  FolderWrite
	root     string
	merge    bool
	progress FolderProgress
	created  []string // private-folder entries, children after parents
}

func (w *folderWriter) check() error {
	if err := w.ctx.Err(); err != nil {
		return err
	}
	if w.options.Check != nil {
		return w.options.Check()
	}
	return nil
}

func (w *folderWriter) report() error {
	if w.options.Progress != nil {
		return w.options.Progress(w.progress)
	}
	return nil
}

// Only a merge changes Target before the final rename, so only a merge reports
// unknown mutation outcomes for individual entries.
func (w *folderWriter) mutation(err error) error {
	if w.merge {
		return MutationError(err)
	}
	return err
}

func (w *folderWriter) write(manifest FolderManifest, content io.Reader) error {
	for _, name := range manifest.Directories {
		if err := w.directory(path.Join(w.root, name)); err != nil {
			return err
		}
	}
	for _, file := range manifest.Files {
		if err := w.check(); err != nil {
			return err
		}
		remote := path.Join(w.root, file.Path)
		body := &folderBody{reader: io.LimitReader(content, file.Size), writer: w}
		var err error
		if w.merge {
			err = w.replace(remote, body, file.Size)
		} else {
			err = w.create(remote, body, file.Size)
		}
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			err = fmt.Errorf("folder content ended before %s: %w", file.Path, err)
		}
		if err != nil {
			return err
		}
		if w.merge {
			w.progress.Files++
			w.progress.Bytes += file.Size
			if err := w.report(); err != nil {
				return err
			}
		}
	}
	return nil
}

func (w *folderWriter) directory(remote string) error {
	if err := w.check(); err != nil {
		return err
	}
	if w.merge {
		info, err := w.client.Lstat(remote)
		if err == nil {
			if !info.IsDir() {
				return fmt.Errorf("upload entry exists and is not a directory: %s", remote)
			}
			return nil
		}
		if !os.IsNotExist(err) {
			return err
		}
	}
	if err := w.client.Mkdir(remote); err != nil {
		return w.mutation(err)
	}
	w.created = append(w.created, remote)
	return w.mutation(w.client.Chmod(remote, folderDirectoryMode))
}

func (w *folderWriter) create(remote string, body io.Reader, size int64) error {
	file, err := w.client.OpenFile(remote, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return err
	}
	w.created = append(w.created, remote)
	defer file.Close()
	written, err := io.Copy(file, body)
	if err != nil {
		return err
	}
	if written != size {
		return io.ErrUnexpectedEOF
	}
	if err := file.Chmod(folderFileMode); err != nil {
		return err
	}
	return file.Close()
}

// Replacement keeps an existing file's permissions, like single-file uploads.
func (w *folderWriter) replace(remote string, body io.Reader, size int64) (err error) {
	mode := folderFileMode
	info, err := w.client.Lstat(remote)
	if err == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("upload entry exists and is not a regular file: %s", remote)
		}
		mode = info.Mode().Perm()
	} else if !os.IsNotExist(err) {
		return err
	}
	temporary := path.Join(path.Dir(remote), ".easyssh-upload-"+uuid.NewString())
	file, err := w.client.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		_ = file.Close()
		if !committed {
			if removeErr := w.client.Remove(temporary); removeErr != nil && !os.IsNotExist(removeErr) {
				err = errors.Join(err, fmt.Errorf("temporary file cleanup failed (%s): %w", temporary, removeErr))
			}
		}
	}()
	if err := file.Chmod(0600); err != nil {
		return err
	}
	// A short body must fail before the temporary file replaces the target.
	written, err := io.Copy(file, body)
	if err != nil {
		return err
	}
	if written != size {
		return io.ErrUnexpectedEOF
	}
	if err := file.Chmod(mode); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := w.check(); err != nil {
		return err
	}
	if _, supported := w.client.HasExtension("posix-rename@openssh.com"); supported {
		err = MutationError(w.client.PosixRename(temporary, remote))
	} else {
		err = MutationError(w.client.Rename(temporary, remote))
	}
	committed = err == nil || errors.Is(err, ErrMutationOutcomeUnknown)
	return err
}

// discard removes the private folder. It runs after cancellation too, so it
// never consults the context.
func (w *folderWriter) discard() error {
	var errs []error
	for i := len(w.created) - 1; i >= 0; i-- {
		if err := w.client.Remove(w.created[i]); err != nil && !os.IsNotExist(err) {
			errs = append(errs, err)
		}
	}
	if err := w.client.RemoveDirectory(w.root); err != nil && !os.IsNotExist(err) {
		errs = append(errs, err)
	}
	if len(errs) > 0 {
		return fmt.Errorf("temporary folder cleanup failed (%s): %w", w.root, errors.Join(errs...))
	}
	return nil
}

type folderBody struct {
	reader io.Reader
	writer *folderWriter
}

func (b *folderBody) Read(p []byte) (int, error) {
	if err := b.writer.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := b.reader.Read(p)
	if n > 0 {
		b.writer.progress.Written += int64(n)
		if reportErr := b.writer.report(); reportErr != nil {
			return n, reportErr
		}
	}
	return n, err
}
