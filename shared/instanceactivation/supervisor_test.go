package instanceactivation

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/easyssh/shared/instancebackup"
)

func activationFixture(t *testing.T) (*supervisor, Request) {
	t.Helper()
	root := t.TempDir()
	directory := filepath.Join(root, "backups", "restored", "copy")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	id := "0123456789abcdef0123456789abcdef"
	for name, content := range map[string]string{"easyssh.db": "SQLite format 3\x00", "easyssh-root.key": base64.StdEncoding.EncodeToString(make([]byte, 32))} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	record := instancebackup.Record{ID: id, Status: "ready", Driver: "sqlite", RestoredTo: directory}
	if err := atomicJSON(filepath.Join(root, "backups", id+".json"), record); err != nil {
		t.Fatal(err)
	}
	s := &supervisor{stateFile: filepath.Join(root, "selection.json"), token: "private-token", ready: true, requests: make(chan struct{}, 1), state: selection{Version: 1, BackupDirectory: filepath.Join(root, "backups"), Current: Target{Directory: filepath.Join(root, "original")}}}
	return s, Request{RecordID: id, Directory: directory}
}

func TestActivationRejectsStaleOrUnmanagedRestoredDirectory(t *testing.T) {
	s, input := activationFixture(t)
	stale := input
	stale.Directory += "-stale"
	if _, err := s.candidate(stale); err == nil {
		t.Fatal("accepted stale restore selection")
	}
	outside := t.TempDir()
	record := instancebackup.Record{ID: input.RecordID, Status: "ready", Driver: "sqlite", RestoredTo: outside}
	if err := atomicJSON(filepath.Join(s.state.BackupDirectory, input.RecordID+".json"), record); err != nil {
		t.Fatal(err)
	}
	input.Directory = outside
	if _, err := s.candidate(input); err == nil {
		t.Fatal("accepted path outside restored storage")
	}
}

func TestActivationPersistsIntentBeforeAcknowledgingAndRejectsDuplicate(t *testing.T) {
	s, input := activationFixture(t)
	payload, _ := json.Marshal(input)
	request := func(token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/activate", bytes.NewReader(payload))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	if got := request("wrong").Code; got != http.StatusUnauthorized {
		t.Fatalf("unauthenticated activation: %d", got)
	}
	if got := request(s.token).Code; got != http.StatusOK {
		t.Fatalf("activation: %d", got)
	}
	var persisted selection
	b, err := os.ReadFile(s.stateFile)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(b, &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.Pending == nil || persisted.Pending.To.Directory != input.Directory || persisted.Current.Directory == input.Directory {
		t.Fatal("acceptance did not retain original selection and durable pending intent")
	}
	if len(persisted.Operation.ID) != 64 || persisted.Operation.Status != "switching" {
		t.Fatal("missing status capability")
	}
	if got := request(s.token).Code; got != http.StatusConflict {
		t.Fatalf("duplicate activation: %d", got)
	}
}

func TestRollbackRejectsMissingDatabaseWithoutCreatingIt(t *testing.T) {
	s, input := activationFixture(t)
	target, err := s.candidate(input)
	if err != nil {
		t.Fatal(err)
	}
	s.state.Previous = &target
	if err = os.Remove(target.DSN); err != nil {
		t.Fatal(err)
	}
	if _, err = s.candidate(Request{Rollback: true}); err == nil {
		t.Fatal("accepted a deleted previous database")
	}
	if _, err = os.Stat(target.DSN); !os.IsNotExist(err) {
		t.Fatal("database was recreated")
	}
}

func TestActivationWriteFailureDoesNotQueueRestart(t *testing.T) {
	s, input := activationFixture(t)
	s.stateFile = filepath.Join(t.TempDir(), "missing", "selection.json")
	payload, _ := json.Marshal(input)
	r := httptest.NewRequest(http.MethodPost, "/activate", bytes.NewReader(payload))
	r.Header.Set("Authorization", "Bearer "+s.token)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != http.StatusConflict || s.state.Pending != nil {
		t.Fatal("failed write changed current operation")
	}
	select {
	case <-s.requests:
		t.Fatal("restart queued after failed persistence")
	default:
	}
}

func TestDesktopCandidateUsesDesktopDatabaseAndExternalKeyStore(t *testing.T) {
	s, input := activationFixture(t)
	s.options = Options{DatabaseName: "easyssh-desktop.sqlite", Key: func(Target) (string, error) { return "", nil }}
	if err := os.Rename(filepath.Join(input.Directory, "easyssh.db"), filepath.Join(input.Directory, "easyssh-desktop.sqlite")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(input.Directory, "easyssh-root.key")); err != nil {
		t.Fatal(err)
	}
	target, err := s.candidate(input)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(target.DSN) != "easyssh-desktop.sqlite" {
		t.Fatal("selected server database for desktop")
	}
	if err := os.Remove(target.DSN); err != nil {
		t.Fatal(err)
	}
	if _, err := s.candidate(input); err == nil {
		t.Fatal("accepted missing desktop database")
	}
}
