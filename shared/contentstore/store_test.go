package contentstore

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func TestBodyRangesRecoverAndRejectChangedReference(t *testing.T) {
	directory := t.TempDir()
	store, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	id := uuid.New()
	body := bytes.Repeat([]byte("body\x00"), MaxReadBytes)
	writer, err := store.Create(id, "application/octet-stream")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write(body); err != nil {
		t.Fatal(err)
	}
	ref, err := writer.Finish()
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := store.Recover(id, ref.MediaType)
	if err != nil || recovered != ref {
		t.Fatalf("recovered wrong body: %+v %v", recovered, err)
	}
	if _, err := store.Create(id, ref.MediaType); err == nil {
		t.Fatal("overwrote sealed body")
	}
	var collected []byte
	for offset := int64(0); offset < ref.Size; {
		input := protocol.ContentReadInput{Sha256: ref.Sha256, Offset: offset, Limit: MaxReadBytes}
		chunk, err := store.Read(ref, input)
		if err != nil || ValidateChunk(ref, input, chunk) != nil {
			t.Fatalf("invalid range: %+v %v", chunk, err)
		}
		data, err := base64.StdEncoding.DecodeString(chunk.Data)
		if err != nil {
			t.Fatal(err)
		}
		collected = append(collected, data...)
		offset = chunk.NextOffset
	}
	if !bytes.Equal(collected, body) {
		t.Fatal("body did not round trip")
	}
	for _, input := range []protocol.ContentReadInput{
		{Sha256: ref.Sha256, Offset: -1},
		{Sha256: ref.Sha256, Offset: ref.Size + 1},
		{Sha256: ref.Sha256, Limit: MaxReadBytes + 1},
	} {
		if _, err := store.Read(ref, input); !errors.Is(err, ErrQuery) {
			t.Fatalf("accepted invalid range: %+v %v", input, err)
		}
	}
	input := protocol.ContentReadInput{Sha256: ref.Sha256, Offset: ref.Size}
	empty, err := store.Read(ref, input)
	if err != nil || ValidateChunk(ref, input, empty) != nil || empty.Data != "" {
		t.Fatal("EOF range invalid")
	}
	if err := os.Truncate(filepath.Join(directory, id.String()+".body"), 1); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Read(ref, input); !errors.Is(err, ErrChanged) {
		t.Fatalf("accepted changed body: %v", err)
	}
}

func TestBodyCannotEscapeRootThroughSymlink(t *testing.T) {
	directory, outside := t.TempDir(), t.TempDir()
	target := filepath.Join(outside, "secret")
	if err := os.WriteFile(target, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	id := uuid.New()
	if err := os.Symlink(target, filepath.Join(directory, id.String()+".body")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := store.Recover(id, "text/plain"); err == nil {
		t.Fatal("escaped root")
	}
	if _, err := store.Create(id, "text/plain"); err == nil {
		t.Fatal("followed existing symlink")
	}
}
