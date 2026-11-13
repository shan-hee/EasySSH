package datasync

import (
	"errors"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"github.com/easyssh/shared/syncengine"
)

type Peer = syncengine.Peer
type Conflict = syncengine.Conflict
type Resolution = syncengine.Resolution

type EngineInput struct {
	Inspect       bool
	Configuration bool
	Document      string
	Current       syncdata.Snapshot
	Peer          Peer
	Resolution    *Resolution
}
type EngineResult struct {
	Document       string
	Snapshot       syncdata.Snapshot
	Conflicts      []Conflict
	Response       Peer
	AffectedGrants []protocol.SyncAffectedGrant
	// Missing lists payload objects the request refers to but the server lacks.
	// When it is set, nothing was applied.
	Missing []string
}

func publicConflicts(conflicts []Conflict) []protocol.SyncConflict {
	result := make([]protocol.SyncConflict, len(conflicts))
	for i, conflict := range conflicts {
		version := int64(conflict.Version)
		result[i] = protocol.SyncConflict{Key: conflict.Key, Field: protocol.SyncConflictField(conflict.Field), Values: conflict.Values, Version: &version}
	}
	return result
}

func publicPeer(peer Peer) protocol.SyncPeer {
	changes := make([]protocol.SyncChange, len(peer.Changes))
	for i, change := range peer.Changes {
		version := int64(change.Version)
		changes[i] = protocol.SyncChange{Key: change.Key, Field: &change.Field, Value: &change.Value, Version: &version, Deleted: &change.Deleted, Resolve: &change.Resolve}
	}
	conflicts := publicConflicts(peer.Conflicts)
	sequence := int64(peer.Sequence)
	return protocol.SyncPeer{Timeline: &peer.Timeline, Realign: &peer.Realign, Replica: &peer.Replica, Sequence: &sequence, Cursor: int64(peer.Cursor), Changes: &changes, Conflicts: &conflicts}
}

func (result EngineResult) ExchangeResult() protocol.SyncExchangeResult {
	return protocol.SyncExchangeResult{Response: publicPeer(result.Response), AffectedGrants: result.AffectedGrants}
}

func (result EngineResult) VaultResult() protocol.SyncVaultResult {
	output := protocol.SyncVaultResult{Response: publicPeer(result.Response), AffectedGrants: result.AffectedGrants,
		Snapshot: make(map[string]map[string]string, len(result.Snapshot)), Conflicts: publicConflicts(result.Conflicts)}
	for key, record := range result.Snapshot {
		output.Snapshot[key] = map[string]string(record)
	}
	if len(result.Missing) > 0 {
		output.MissingObjects = &result.Missing
	}
	return output
}

// runEngine merges on the hub side. The server is the only hub of its sync space.
func runEngine(input EngineInput) (EngineResult, error) {
	var result syncengine.Result
	var err error
	if input.Inspect {
		result, err = syncengine.Inspect(input.Document)
	} else {
		result, err = syncengine.Exchange(syncengine.HubInput{Document: input.Document, Current: input.Current, Peer: input.Peer, Resolution: input.Resolution, Configuration: input.Configuration})
	}
	if err != nil {
		return EngineResult{}, err
	}
	if len(result.Document) > syncdata.MaxDocumentBytes {
		return EngineResult{}, errors.New("sync state exceeds the 32 MiB limit")
	}
	if err := syncdata.Validate(result.Snapshot); err != nil {
		return EngineResult{}, err
	}
	return EngineResult{Document: result.Document, Snapshot: result.Snapshot, Conflicts: result.Conflicts, Response: result.Response}, nil
}
