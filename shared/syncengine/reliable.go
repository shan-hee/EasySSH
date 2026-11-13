package syncengine

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"maps"

	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

// One durable request per replica. It survives lost responses, process exits,
// and local edits while a request is in flight.
type flight struct {
	Peer     Peer              `json:"peer"`
	Snapshot syncdata.Snapshot `json:"snapshot"`
}

// Retain only the last write receipt per replica. It identifies a retry, whose
// changes are already applied and must not be applied again. The retry is
// answered from the current state: storing the original answer would keep a
// copy of everything a replica was sent inside the hub document.
type receipt struct {
	Sequence uint64 `json:"sequence"`
	Digest   string `json:"digest"`
}

func newIdentity() string { return uuid.NewString() }

// realigned is a replica that dropped its baseline because the hub is on
// another timeline. Its business data is untouched; the next request is
// baseless and the hub merges it by value.
func realigned(current syncdata.Snapshot) Result {
	return Result{Realigned: true, NeedsSync: true, Snapshot: cloneSnapshot(current), Conflicts: []Conflict{}}
}

// Rotate starts a new timeline for a hub document whose history no longer
// continues the one its replicas have seen, as after a restore from a backup.
// Every replica then realigns instead of trusting versions that now name
// different edits.
func Rotate(document string) (string, error) {
	if document == "" {
		return "", nil
	}
	st, err := load(document)
	if err != nil {
		return "", err
	}
	st.Timeline, st.Receipts = newIdentity(), nil
	return st.save(), nil
}

func requestDigest(peer Peer) string {
	data, _ := json.Marshal(peer)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// checkRequest reports whether the request repeats the replica's last write.
func (st *state) checkRequest(peer Peer) (bool, error) {
	if len(peer.Changes) == 0 && peer.Sequence == 0 {
		return false, nil
	}
	if _, err := uuid.Parse(peer.Replica); err != nil || peer.Sequence == 0 {
		return false, errors.New("sync writes require a replica and sequence")
	}
	previous, exists := st.Receipts[peer.Replica]
	if exists && peer.Sequence == previous.Sequence {
		if requestDigest(peer) != previous.Digest {
			return false, errors.New("sync request sequence was reused with different contents")
		}
		return true, nil
	}
	if peer.Sequence != previous.Sequence+1 {
		return false, errors.New("unexpected sync request sequence")
	}
	if !exists && len(st.Receipts) >= maxRecords {
		return false, errors.New("too many sync replicas")
	}
	return false, nil
}

// Detach gives a replica document a new identity while keeping the values and
// cursor it has acknowledged. A device does this whenever it is authorized
// again: after either side was restored from a backup, its old request
// sequence no longer continues the hub's receipts.
//
// Unacknowledged edits keep the version they were based on. Comparing the
// business data with the document would not find them all again: a value
// added to a conflict is not a difference the comparison reports.
func Detach(document string) (string, error) {
	if document == "" {
		return "", nil
	}
	st, err := load(document)
	if err != nil {
		return "", err
	}
	if st.Flight != nil {
		// The pending request already carries every queued edit.
		st.Queued = nil
		for _, change := range st.Flight.Peer.Changes {
			// A deletion is found again by the comparison.
			if !change.Deleted {
				st.Queued = append(st.Queued, change)
			}
		}
	}
	st.Replica, st.Sequence, st.Flight = "", 0, nil
	return st.save(), nil
}

// Prepare must be persisted before sending Response. Repeated calls return the
// same outstanding request even when the business data has since changed.
func Prepare(document string, current syncdata.Snapshot) (Result, error) {
	st, err := load(document)
	if err != nil {
		return Result{}, err
	}
	if st.Flight == nil {
		peer, err := Outgoing(document, current)
		if err != nil {
			return Result{}, err
		}
		st.Replica = peer.Replica
		st.Flight = &flight{Peer: peer, Snapshot: cloneSnapshot(current)}
	}
	_, conflicts := st.project()
	return Result{Document: st.save(), Response: st.Flight.Peer, Conflicts: conflicts}, nil
}

func cloneSnapshot(snapshot syncdata.Snapshot) syncdata.Snapshot {
	result := make(syncdata.Snapshot, len(snapshot))
	for key, fields := range snapshot {
		result[key] = maps.Clone(fields)
	}
	return result
}

// Complete acknowledges the durable request, then reapplies edits made since
// its captured snapshot. Callers persist both document and business snapshot
// atomically, with a compare-and-swap against current.
func Complete(document string, current syncdata.Snapshot, response Peer, configuration bool) (Result, error) {
	st, err := load(document)
	if err != nil {
		return Result{}, err
	}
	if st.Flight == nil {
		return Result{}, errors.New("no pending sync request")
	}
	if response.Replica != st.Flight.Peer.Replica || response.Sequence != st.Flight.Peer.Sequence {
		return Result{}, errors.New("sync response does not acknowledge the pending request")
	}
	if response.Realign {
		return realigned(current), nil
	}
	sent := st.Flight.Snapshot
	result, err := Receive(document, sent, response, configuration)
	if err != nil {
		return Result{}, err
	}
	acknowledged, err := load(result.Document)
	if err != nil {
		return Result{}, err
	}
	for key := range sent {
		if _, exists := current[key]; !exists {
			delete(result.Snapshot, key)
		}
	}
	for key, fields := range current {
		old, existed := sent[key]
		if !existed {
			if rec := acknowledged.Records[key]; rec != nil && rec.Deleted != 0 {
				continue
			}
			result.Snapshot[key] = maps.Clone(fields)
			if remote := acknowledged.live(key); remote != nil {
				for name, value := range fields {
					if remote.Fields[name].Value != value || acknowledged.conflict(key, name) != nil {
						acknowledged.Queued = append(acknowledged.Queued, Change{Key: key, Field: name, Value: value})
					}
				}
			}
			continue
		}
		target := result.Snapshot[key]
		// A remote deletion still wins over an edit of an existing record.
		if target == nil {
			continue
		}
		for name := range old {
			if _, exists := fields[name]; !exists {
				delete(target, name)
			}
		}
		for name, value := range fields {
			if previous, exists := old[name]; !exists || previous != value {
				target[name] = value
				// The projection adds a default order record the hub does not
				// have; an edit of it has no remote value to be concurrent with.
				remote := acknowledged.live(key)
				if acknowledged.conflict(key, name) != nil || remote != nil && remote.Fields[name].Value != old[name] {
					// The user edited a value they had actually seen, not the
					// unseen remote value returned by this pull. Keep that base
					// so the next round detects a real concurrent edit.
					var base uint64
					if before := st.live(key); before != nil {
						base = before.Fields[name].Version
					}
					acknowledged.Queued = append(acknowledged.Queued, Change{Key: key, Field: name, Value: value, Version: base})
				}
			}
		}
	}
	for key := range current {
		delete(acknowledged.Withheld, key)
	}
	result.Document = acknowledged.save()
	result.NeedsSync = syncdata.Hash(current) != syncdata.Hash(sent)
	return result, nil
}
