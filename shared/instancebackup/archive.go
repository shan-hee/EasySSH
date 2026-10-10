// Package instancebackup implements encrypted containers around native database snapshots.
// It does not implement database dumps or merge records.
package instancebackup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"filippo.io/age"
)

const Format = "easyssh-instance"
const ArchiveVersion = 1
const MaxExpandedBytes int64 = 256 << 30

type File struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type Manifest struct {
	Format          string          `json:"format"`
	Version         int             `json:"version"`
	Profile         string          `json:"profile"`
	AppVersion      string          `json:"app_version"`
	Driver          string          `json:"driver"`
	DatabaseVersion string          `json:"database_version"`
	SchemaVersion   int64           `json:"schema_version"`
	CreatedAt       string          `json:"created_at"`
	OriginalDataDir string          `json:"original_data_dir"`
	TransferRoot    string          `json:"transfer_root,omitempty"`
	Files           map[string]File `json:"files"`
}

// Pack streams an age-encrypted tar.gz; output must not exist and is removed on failure.
func Pack(ctx context.Context, staging, output, passphrase string, manifest Manifest) (err error) {
	if strings.TrimSpace(passphrase) == "" {
		return errors.New("backup password is required")
	}
	recipient, err := age.NewScryptRecipient(passphrase)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer func() {
		_ = f.Close()
		if err != nil {
			_ = os.Remove(output)
		}
	}()
	encrypted, err := age.Encrypt(f, recipient)
	if err != nil {
		return err
	}
	compressed := gzip.NewWriter(encrypted)
	archive := tar.NewWriter(compressed)
	manifest.Format = Format
	manifest.Version = ArchiveVersion
	manifest.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	manifest.Files = map[string]File{}
	err = filepath.WalkDir(staging, func(filename string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		info, e := entry.Info()
		if e != nil {
			return e
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("unsupported file type: %s", filename)
		}
		relative, e := filepath.Rel(staging, filename)
		if e != nil {
			return e
		}
		name := filepath.ToSlash(relative)
		if name == "manifest.json" {
			return errors.New("reserved manifest path")
		}
		if e = archive.WriteHeader(&tar.Header{Name: name, Mode: 0600, Size: info.Size(), Typeflag: tar.TypeReg}); e != nil {
			return e
		}
		input, e := os.Open(filename)
		if e != nil {
			return e
		}
		hash := sha256.New()
		n, e := io.Copy(io.MultiWriter(archive, hash), contextReader{ctx, input})
		closeErr := input.Close()
		if e != nil {
			return e
		}
		if closeErr != nil {
			return closeErr
		}
		if n != info.Size() {
			return errors.New("file changed during backup")
		}
		manifest.Files[name] = File{Size: n, SHA256: hex.EncodeToString(hash.Sum(nil))}
		return nil
	})
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err = archive.WriteHeader(&tar.Header{Name: "manifest.json", Mode: 0600, Size: int64(len(data)), Typeflag: tar.TypeReg}); err != nil {
		return err
	}
	if _, err = archive.Write(data); err != nil {
		return err
	}
	if err = archive.Close(); err != nil {
		return err
	}
	if err = compressed.Close(); err != nil {
		return err
	}
	if err = encrypted.Close(); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	return f.Close()
}

// Unpack writes into a private empty staging directory and validates every file before returning.
// Symlinks, duplicate paths, traversal, undeclared files and oversized archives are rejected.
func Unpack(ctx context.Context, input, staging, passphrase string) (Manifest, error) {
	var manifest Manifest
	identity, err := age.NewScryptIdentity(passphrase)
	if err != nil {
		return manifest, err
	}
	f, err := os.Open(input)
	if err != nil {
		return manifest, err
	}
	defer f.Close()
	decrypted, err := age.Decrypt(contextReader{ctx, f}, identity)
	if err != nil {
		return manifest, err
	}
	compressed, err := gzip.NewReader(decrypted)
	if err != nil {
		return manifest, err
	}
	defer compressed.Close()
	archive := tar.NewReader(compressed)
	seen := map[string]File{}
	var manifestBytes []byte
	var total int64
	for {
		header, e := archive.Next()
		if e == io.EOF {
			break
		}
		if e != nil {
			return manifest, e
		}
		name := header.Name
		if name == "." || path.Clean(name) != name || strings.Contains(name, "\\") || strings.Contains(name, ":") || !fs.ValidPath(name) || !filepath.IsLocal(filepath.FromSlash(name)) || header.Typeflag != tar.TypeReg {
			return manifest, errors.New("invalid archive entry")
		}
		if _, exists := seen[name]; exists {
			return manifest, errors.New("duplicate archive entry")
		}
		if header.Size < 0 || header.Size > MaxExpandedBytes-total {
			return manifest, errors.New("archive exceeds expanded size limit")
		}
		total += header.Size
		if name == "manifest.json" {
			if manifestBytes != nil || header.Size > 8<<20 {
				return manifest, errors.New("invalid manifest size or duplicate manifest")
			}
			manifestBytes, e = io.ReadAll(archive)
			if e != nil {
				return manifest, e
			}
			seen[name] = File{}
			continue
		}
		dest := filepath.Join(staging, filepath.FromSlash(name))
		if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
			return manifest, e
		}
		out, e := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return manifest, e
		}
		hash := sha256.New()
		n, e := io.Copy(io.MultiWriter(out, hash), archive)
		closeErr := out.Close()
		if e != nil {
			return manifest, e
		}
		if closeErr != nil {
			return manifest, closeErr
		}
		seen[name] = File{Size: n, SHA256: hex.EncodeToString(hash.Sum(nil))}
	}
	// Read to authenticated EOF, including gzip trailers and age's final chunk.
	if n, e := io.Copy(io.Discard, io.LimitReader(compressed, 1)); e != nil || n != 0 {
		return manifest, errors.New("archive has trailing content or failed integrity verification")
	}
	if _, err = io.Copy(io.Discard, decrypted); err != nil {
		return manifest, err
	}
	if err = json.Unmarshal(manifestBytes, &manifest); err != nil {
		return manifest, fmt.Errorf("invalid manifest: %w", err)
	}
	if manifest.Format != Format || manifest.Version != ArchiveVersion {
		return manifest, errors.New("unsupported instance backup format")
	}
	delete(seen, "manifest.json")
	if len(seen) != len(manifest.Files) {
		return manifest, errors.New("archive file list mismatch")
	}
	for name, expected := range manifest.Files {
		if actual, ok := seen[name]; !ok || actual != expected {
			return manifest, fmt.Errorf("checksum mismatch: %s", name)
		}
	}
	if _, ok := manifest.Files["database.dump"]; !ok {
		return manifest, errors.New("native database snapshot missing")
	}
	if _, ok := manifest.Files["root.key"]; !ok {
		return manifest, errors.New("root encryption key missing")
	}
	return manifest, nil
}

func CopyTree(ctx context.Context, source, dest string, exclude func(string) bool) error {
	return filepath.WalkDir(source, func(filename string, entry fs.DirEntry, err error) error {
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, filename)
		if err != nil {
			return err
		}
		if exclude != nil && exclude(relative) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		target := filepath.Join(dest, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("cannot snapshot nonregular file %s", filename)
		}
		return CopyFile(ctx, filename, target)
	})
}
func CopyFile(ctx context.Context, source, dest string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	if err = os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
		return err
	}
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, contextReader{ctx, in})
	if err == nil {
		err = out.Sync()
	}
	closeErr := out.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func PasswordFile(filename string) (string, error) {
	if filename == "" {
		return "", errors.New("--password-file is required")
	}
	b, err := os.ReadFile(filename)
	if err != nil {
		return "", err
	}
	password := strings.TrimRight(string(b), "\r\n")
	if strings.TrimSpace(password) == "" {
		return "", errors.New("empty backup password")
	}
	return password, nil
}

// contextReader bounds cancellation latency while copying large local archives.
type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}
