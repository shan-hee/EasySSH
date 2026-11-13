package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easyssh/shared/syncdata"
	"github.com/easyssh/shared/syncengine"
	"github.com/google/uuid"
)

func TestConfigurationRoundPreservesRevertDuringNetworkRequest(t *testing.T) {
	for _, loseResponse := range []bool{false, true} {
		name := "response received"
		if loseResponse {
			name = "response lost and client restarted"
		}
		t.Run(name, func(t *testing.T) {
			s := newDesktopSyncTestService(t)
			instance, owner, id := uuid.New(), uuid.New(), uuid.NewString()
			space := uuid.NewSHA1(instance, []byte(owner.String())).String()
			hubDocument := ""
			hubSnapshot := syncdata.Snapshot{}
			reverted := false
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/api/v1/sync/device" {
					_ = json.NewEncoder(w).Encode(map[string]any{"space_id": space, "instance_id": instance, "user_id": owner, "account_name": "account", "protocol": syncdata.ConfigurationProtocol, "grants": syncdata.SyncScopes{}})
					return
				}
				var peer syncengine.Peer
				if err := json.NewDecoder(r.Body).Decode(&peer); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				var durable string
				if err := s.servers.db.QueryRow("SELECT document FROM desktop_sync_spaces WHERE id=?", space).Scan(&durable); err != nil || !strings.Contains(durable, `"flight"`) {
					t.Error("request was sent before persistence", err)
				}
				result, err := syncengine.Exchange(syncengine.HubInput{Document: hubDocument, Current: hubSnapshot, Peer: peer, Configuration: true})
				if err != nil {
					t.Error(err)
					w.WriteHeader(409)
					return
				}
				hubDocument, hubSnapshot = result.Document, result.Snapshot
				if !reverted && hubSnapshot["script/"+id]["content"] == "echo sent" {
					reverted = true
					if _, err := s.servers.db.Exec("UPDATE desktop_scripts SET content='echo base' WHERE id=?", id); err != nil {
						t.Error(err)
					}
					if loseResponse {
						w.WriteHeader(503)
						return
					}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"response": result.Response})
			}))
			defer remote.Close()
			if err := s.connect(remote.URL, "ess_sync_"+strings.Repeat("a", 64)); err != nil {
				t.Fatal(err)
			}
			if _, err := s.servers.db.Exec("INSERT INTO desktop_scripts(id,name,content,language,created_at,updated_at) VALUES(?,'script','echo base','bash','','')", id); err != nil {
				t.Fatal(err)
			}
			if err := s.Enroll(space, []string{"script/" + id}); err != nil {
				t.Fatal(err)
			}
			if _, err := s.SynchronizeConfiguration(); err != nil {
				t.Fatal(err)
			}
			if _, err := s.servers.db.Exec("UPDATE desktop_scripts SET content='echo sent' WHERE id=?", id); err != nil {
				t.Fatal(err)
			}
			_, err := s.SynchronizeConfiguration()
			if loseResponse {
				if err == nil {
					t.Fatal("missing transport error")
				}
				// Drop all service memory, retaining only the database.
				s = &DesktopSyncService{servers: s.servers, scripts: s.scripts, ai: s.ai}
				_, err = s.SynchronizeConfiguration()
			}
			if err != nil {
				t.Fatal(err)
			}
			state, err := s.Load()
			if err != nil || state.Snapshot["script/"+id]["content"] != "echo base" || len(state.Conflicts) != 0 || hubSnapshot["script/"+id]["content"] != "echo base" {
				t.Fatalf("revert lost or conflicted: %+v %v", state, err)
			}
		})
	}
}

func TestRemoteRecordDoesNotAdoptAnUnenrolledLocalCopy(t *testing.T) {
	s := newDesktopSyncTestService(t)
	space, id := uuid.NewString(), uuid.NewString()
	activateSyncTestSpace(t, s, space)
	if _, err := s.servers.db.Exec("INSERT INTO desktop_scripts(id,name,content,language,created_at,updated_at) VALUES(?,'script','local offline edit','bash','','')", id); err != nil {
		t.Fatal(err)
	}
	state, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := syncengine.Prepare(state.Document, state.Snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := s.save(DesktopSyncSave{Revision: state.Revision, Hash: state.Hash, Document: prepared.Document}); err != nil || !ok {
		t.Fatal(ok, err)
	}
	remote := syncdata.Snapshot{"script/" + id: {"name": "script", "content": "remote version", "language": "bash", "tags": "[]", "description": ""}}
	answer, err := syncengine.Exchange(syncengine.HubInput{Current: remote, Peer: prepared.Response, Configuration: true})
	if err != nil {
		t.Fatal(err)
	}
	state, err = s.Load()
	if err != nil {
		t.Fatal(err)
	}
	completed, err := syncengine.Complete(state.Document, state.Snapshot, answer.Response, true)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := s.save(DesktopSyncSave{Revision: state.Revision, Hash: state.Hash, Document: completed.Document, Snapshot: completed.Snapshot}); err == nil || ok || !strings.Contains(err.Error(), "主动加入") {
		t.Fatal("local copy was adopted without enrollment", ok, err)
	}
	if err := s.Enroll(space, []string{"script/" + id}); err != nil {
		t.Fatal(err)
	}
	state, err = s.Load()
	if err != nil {
		t.Fatal(err)
	}
	completed, err = syncengine.Complete(state.Document, state.Snapshot, answer.Response, true)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := s.save(DesktopSyncSave{Revision: state.Revision, Hash: state.Hash, Document: completed.Document, Snapshot: completed.Snapshot}); err != nil || !ok {
		t.Fatal(ok, err)
	}
	peer, err := syncengine.Outgoing(completed.Document, completed.Snapshot)
	if err != nil {
		t.Fatal(err)
	}
	merged, err := syncengine.Exchange(syncengine.HubInput{Document: answer.Document, Current: answer.Snapshot, Peer: peer, Configuration: true})
	if err != nil || len(merged.Conflicts) != 1 {
		t.Fatalf("enrolled offline edit was not preserved as a conflict: %+v %v", merged.Conflicts, err)
	}
	var content string
	if err := s.servers.db.QueryRow("SELECT content FROM desktop_scripts WHERE id=?", id).Scan(&content); err != nil || content != "local offline edit" {
		t.Fatal("local content lost", content, err)
	}
}
