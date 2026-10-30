// Package contentstore stores immutable bodies beneath the host's data directory.
// Authorization and the reference lifecycle belong to the host's database.
package contentstore

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"hash"
	"io"
	"os"
	"runtime"
	"strings"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

const MaxReadBytes = 256 << 10

var ErrQuery = errors.New("invalid content range")
var ErrChanged = errors.New("content reference changed")

type Store struct{ root *os.Root }

func Open(directory string) (*Store, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	return &Store{root: root}, nil
}
func (s *Store) Close() error  { return s.root.Close() }
func name(id uuid.UUID) string { return id.String() + ".body" }

// Load restores a complete immutable body for trusted host execution or sync.
// Public offset reads still use Read. Integrity is checked once per restoration,
// never by reading the complete file for each public byte-range request.
func (s *Store) Load(ref protocol.ContentReference) ([]byte, error) {
	if err := ValidateReference(ref); err != nil {
		return nil, err
	}
	file, err := s.root.Open(name(ref.ID))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() != ref.Size {
		return nil, ErrChanged
	}
	raw, err := io.ReadAll(io.LimitReader(file, ref.Size))
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(raw)
	if int64(len(raw)) != ref.Size || hex.EncodeToString(digest[:]) != ref.Sha256 {
		return nil, ErrChanged
	}
	return raw, nil
}

type Writer struct {
	file   *os.File
	digest hash.Hash
	ref    protocol.ContentReference
	closed bool
	err    error
}

func (s *Store) Create(id uuid.UUID, mediaType string) (*Writer, error) {
	if id == uuid.Nil || mediaType == "" || len(mediaType) > 128 {
		return nil, ErrQuery
	}
	file, err := s.root.OpenFile(name(id), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, err
	}
	// Persist the directory entry before a caller performs any external effect.
	if runtime.GOOS != "windows" {
		dir, openErr := s.root.Open(".")
		if openErr != nil {
			_ = file.Close()
			return nil, openErr
		}
		err = errors.Join(dir.Sync(), dir.Close())
		if err != nil {
			_ = file.Close()
			return nil, err
		}
	}
	return &Writer{file: file, digest: sha256.New(), ref: protocol.ContentReference{ID: id, MediaType: mediaType}}, nil
}
func (w *Writer) Write(data []byte) (int, error) {
	if w.closed {
		return 0, os.ErrClosed
	}
	if w.err != nil {
		return 0, w.err
	}
	n, err := w.file.Write(data)
	_, _ = w.digest.Write(data[:n])
	w.ref.Size += int64(n)
	w.err = err
	return n, err
}
func (w *Writer) Finish() (protocol.ContentReference, error) {
	if !w.closed {
		w.closed = true
		w.ref.Sha256 = hex.EncodeToString(w.digest.Sum(nil))
		w.err = errors.Join(w.err, w.file.Sync(), w.file.Close())
	}
	return w.ref, w.err
}

// Recover runs once at startup for bodies whose writer was interrupted. It
// preserves the bytes that reached disk without replaying their source work.
func (s *Store) Recover(id uuid.UUID, mediaType string) (protocol.ContentReference, error) {
	if id == uuid.Nil {
		return protocol.ContentReference{}, ErrQuery
	}
	file, err := s.root.Open(name(id))
	if err != nil {
		return protocol.ContentReference{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return protocol.ContentReference{}, err
	}
	if !info.Mode().IsRegular() {
		return protocol.ContentReference{}, ErrQuery
	}
	digest := sha256.New()
	n, err := io.Copy(digest, file)
	return protocol.ContentReference{ID: id, Size: n, Sha256: hex.EncodeToString(digest.Sum(nil)), MediaType: mediaType}, err
}
func (s *Store) Remove(id uuid.UUID) error {
	if id == uuid.Nil {
		return ErrQuery
	}
	err := s.root.Remove(name(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// Scan visits bounded batches of body IDs. Callers exclude active writers and
// decide retention from their database; filenames never confer read authority.
func (s *Store) Scan(visit func([]uuid.UUID) error) error {
	dir, err := s.root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	for {
		entries, err := dir.ReadDir(128)
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}
		ids := make([]uuid.UUID, 0, len(entries))
		for _, entry := range entries {
			if !entry.Type().IsRegular() || !strings.HasSuffix(entry.Name(), ".body") {
				continue
			}
			id, parseErr := uuid.Parse(strings.TrimSuffix(entry.Name(), ".body"))
			if parseErr == nil && id != uuid.Nil && name(id) == entry.Name() {
				ids = append(ids, id)
			}
		}
		if len(ids) > 0 {
			if err := visit(ids); err != nil {
				return err
			}
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
	}
}
func Normalize(input protocol.ContentReadInput) (protocol.ContentReadInput, error) {
	if input.Limit == 0 {
		input.Limit = 128 << 10
	}
	if input.Offset < 0 || input.Limit < 1 || input.Limit > MaxReadBytes || !validHash(input.Sha256) {
		return input, ErrQuery
	}
	return input, nil
}
func ValidateReference(ref protocol.ContentReference) error {
	if ref.ID == uuid.Nil || ref.Size < 0 || !validHash(ref.Sha256) || ref.MediaType == "" || len(ref.MediaType) > 128 {
		return ErrQuery
	}
	return nil
}
func (s *Store) Read(ref protocol.ContentReference, input protocol.ContentReadInput) (protocol.ContentChunk, error) {
	input, err := Normalize(input)
	if err != nil {
		return protocol.ContentChunk{}, err
	}
	if err = ValidateReference(ref); err != nil {
		return protocol.ContentChunk{}, err
	}
	if input.Sha256 != ref.Sha256 {
		return protocol.ContentChunk{}, ErrChanged
	}
	if input.Offset > ref.Size {
		return protocol.ContentChunk{}, ErrQuery
	}
	file, err := s.root.Open(name(ref.ID))
	if err != nil {
		return protocol.ContentChunk{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return protocol.ContentChunk{}, err
	}
	if !info.Mode().IsRegular() || info.Size() != ref.Size {
		return protocol.ContentChunk{}, ErrChanged
	}
	data := make([]byte, int(min(int64(input.Limit), ref.Size-input.Offset)))
	if len(data) > 0 {
		if _, err := file.ReadAt(data, input.Offset); err != nil {
			return protocol.ContentChunk{}, err
		}
	}
	return protocol.ContentChunk{ID: ref.ID, Sha256: ref.Sha256, Offset: input.Offset, NextOffset: input.Offset + int64(len(data)), Size: ref.Size, Data: base64.StdEncoding.EncodeToString(data)}, nil
}
func ValidateChunk(ref protocol.ContentReference, input protocol.ContentReadInput, chunk protocol.ContentChunk) error {
	input, err := Normalize(input)
	if err != nil || ValidateReference(ref) != nil {
		return ErrQuery
	}
	if input.Sha256 != ref.Sha256 || chunk.ID != ref.ID || chunk.Sha256 != ref.Sha256 || chunk.Size != ref.Size || chunk.Offset != input.Offset || input.Offset > ref.Size {
		return ErrQuery
	}
	length := min(int64(input.Limit), ref.Size-input.Offset)
	if chunk.NextOffset != input.Offset+length || len(chunk.Data) > base64.StdEncoding.EncodedLen(int(length)) {
		return ErrQuery
	}
	data, err := base64.StdEncoding.Strict().DecodeString(chunk.Data)
	if err != nil || int64(len(data)) != length {
		return ErrQuery
	}
	if chunk.Offset == 0 && chunk.NextOffset == ref.Size {
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != ref.Sha256 {
			return ErrChanged
		}
	}
	return nil
}
func validHash(value string) bool {
	if len(value) != 64 || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
