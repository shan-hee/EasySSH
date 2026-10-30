package transferjob

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/easyssh/server/internal/domain/systemconfig"
)

func TestStorageReservationIncludesConcurrentUnwrittenBytes(t *testing.T) {
	root := t.TempDir()
	s := &service{dataDir: root}
	cfg := &systemconfig.SystemConfig{TransferStoragePath: root, TransferMaxStorageGB: 1}
	const limit int64 = 1 << 30
	reservation, err := s.reserveStorage(cfg, limit, false)
	if err != nil {
		t.Fatal(err)
	}
	defer reservation.Close()
	if _, err := s.reserveStorage(cfg, 1, false); err == nil {
		t.Fatal("concurrent reservation oversold the store")
	}
	file, err := os.OpenFile(filepath.Join(root, "artifact"), os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := reservation.Writer(file).Write([]byte("payload")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.reserveStorage(cfg, 1, false); err == nil {
		t.Fatal("settled bytes disappeared between reservation and disk accounting")
	}
	reservation.Close()
	reservation.Close()
	remaining, err := s.reserveStorage(cfg, limit-int64(len("payload")), false)
	if err != nil {
		t.Fatalf("unused reserved capacity was not released: %v", err)
	}
	defer remaining.Close()
	if _, err := s.reserveStorage(cfg, 1, false); err == nil {
		t.Fatal("existing disk bytes were not counted")
	}
}

func TestStorageWriterRejectsBytesOutsideReservation(t *testing.T) {
	root := t.TempDir()
	s := &service{dataDir: root}
	cfg := &systemconfig.SystemConfig{TransferStoragePath: root, TransferMaxStorageGB: 1}
	reservation, err := s.reserveStorage(cfg, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	defer reservation.Close()
	file, err := os.OpenFile(filepath.Join(root, "artifact"), os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if n, err := reservation.Writer(file).Write([]byte("extra")); err == nil || n != 0 {
		t.Fatalf("unreserved write succeeded: n=%d err=%v", n, err)
	}
	info, err := file.Stat()
	if err != nil || info.Size() != 0 {
		t.Fatalf("rejected write changed artifact: %v", err)
	}
}
