package instancebackup

import (
	"errors"
	"os"
	"testing"
)

func TestActivationReservationSerializesDownloadsAndMutation(t *testing.T) {
	h, err := NewHistory(HistoryOptions{Directory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	record, err := h.newRecord("uploaded", "ready")
	if err != nil {
		t.Fatal(err)
	}
	record.Driver, record.RestoredTo = "sqlite", "restored-copy"
	if err = h.save(record); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(h.archive(record.ID), []byte("archive"), 0600); err != nil {
		t.Fatal(err)
	}
	file, _, unpin, err := h.Open(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = h.ReserveActivation(record.ID); !errors.Is(err, ErrBusy) {
		t.Fatalf("active download was not protected: %v", err)
	}
	file.Close()
	unpin()
	_, release, err := h.ReserveActivation(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = h.Open(record.ID); !errors.Is(err, ErrBusy) {
		t.Fatalf("download allowed during activation: %v", err)
	}
	if err = h.Delete(record.ID); !errors.Is(err, ErrBusy) {
		t.Fatalf("delete allowed during activation: %v", err)
	}
	release()
	release()
	if err = h.Delete(record.ID); err != nil {
		t.Fatalf("reservation was not released: %v", err)
	}
}
