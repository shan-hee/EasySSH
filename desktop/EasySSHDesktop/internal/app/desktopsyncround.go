package app

import (
	"errors"
	"slices"
	"strings"

	"github.com/easyssh/shared/syncdata"
	"github.com/easyssh/shared/syncengine"
)

// Bound retries under continuous local editing; pending requests remain durable.
const desktopSyncAttempts = 3

var (
	errDesktopSyncBusy    = errors.New("Local data changed during sync; the next attempt will retry")
	errDesktopSyncChanged = errors.New("Local data changed; refresh and retry")
)

type DesktopSyncChange struct {
	Changed        bool `json:"changed"`
	ServersChanged bool `json:"servers_changed"`
}

// syncSignature compares contents, including the effective server order after
// deleted and new server IDs.
func syncSignature(snapshot syncdata.Snapshot, serversOnly bool) string {
	view := syncdata.Snapshot{}
	for key, record := range snapshot {
		if serversOnly && !strings.HasPrefix(key, "server/") && !strings.HasPrefix(key, "order/") {
			continue
		}
		if key == syncdata.ServerOrderKey {
			if ordered, err := syncdata.OrderedServers(snapshot); err == nil {
				record = syncdata.Record{"ids": syncdata.JSON(ordered)}
			}
		}
		view[key] = record
	}
	return syncdata.JSON(view)
}

// SynchronizeConfiguration exchanges servers, scripts, groups and their order
// with the connected account once.
func (s *DesktopSyncService) SynchronizeConfiguration() (DesktopSyncChange, error) {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	var changed DesktopSyncChange
	for attempt := 0; attempt < desktopSyncAttempts; attempt++ {
		state, err := s.Load()
		if err != nil {
			return changed, err
		}
		if !state.Enabled || state.SpaceID == "" {
			return changed, nil
		}
		prepared, err := syncengine.Prepare(state.Document, state.Snapshot)
		if err != nil {
			return changed, err
		}
		if prepared.Document != state.Document {
			saved, err := s.save(DesktopSyncSave{Revision: state.Revision, Hash: state.Hash, Document: prepared.Document})
			if err != nil {
				return changed, err
			}
			if !saved {
				continue
			}
			state, err = s.Load()
			if err != nil {
				return changed, err
			}
			if state.Document != prepared.Document {
				return changed, errDesktopSyncChanged
			}
		}
		response, err := s.exchange(prepared.Response, state.Revision)
		if err != nil {
			return changed, err
		}
		completed := false
		for commit := 0; commit < desktopSyncAttempts; commit++ {
			current, err := s.Load()
			if err != nil {
				return changed, err
			}
			if current.SpaceID != state.SpaceID || !current.Enabled || current.Document != prepared.Document {
				return changed, errDesktopSyncChanged
			}
			received, err := syncengine.Complete(current.Document, current.Snapshot, response, true)
			if err != nil {
				return changed, err
			}
			saved, err := s.save(DesktopSyncSave{Revision: current.Revision, Hash: current.Hash, Document: received.Document, Snapshot: received.Snapshot})
			if err != nil {
				return changed, err
			}
			if !saved {
				continue
			}
			changed.Changed = changed.Changed || syncSignature(current.Snapshot, false) != syncSignature(received.Snapshot, false)
			changed.ServersChanged = changed.ServersChanged || syncSignature(current.Snapshot, true) != syncSignature(received.Snapshot, true)
			if !received.NeedsSync {
				return changed, nil
			}
			completed = true
			break
		}
		if !completed {
			return changed, errDesktopSyncBusy
		}
	}
	return changed, errDesktopSyncBusy
}

func vaultSave(state DesktopVaultState, result syncengine.Result) DesktopVaultSave {
	conflicts := make([]syncdata.VaultConflict, len(result.Conflicts))
	for i, conflict := range result.Conflicts {
		conflicts[i] = syncdata.VaultConflict{Key: conflict.Key, Field: conflict.Field, Values: conflict.Values}
	}
	return DesktopVaultSave{Kind: state.Kind, ID: state.ID, SpaceID: state.SpaceID, BindingRevision: state.BindingRevision, Revision: state.Revision, Document: result.Document, Snapshot: result.Snapshot, Conflicts: conflicts}
}

// SynchronizeVault exchanges one credential, AI configuration or AI session and
// reports whether a different version was applied locally.
func (s *DesktopSyncService) SynchronizeVault(kind, id string) (bool, error) {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	changed := false
	for attempt := 0; attempt < desktopSyncAttempts; attempt++ {
		state, err := s.prepareVault(kind, id)
		if err != nil {
			return changed, err
		}
		prepared, err := syncengine.Prepare(state.Document, state.Snapshot)
		if err != nil {
			return changed, err
		}
		if prepared.Document != state.Document {
			saved, err := s.saveVault(vaultSave(state, prepared))
			if err != nil {
				return changed, err
			}
			if !saved {
				continue
			}
		}
		response, err := s.exchangeVault(kind, id, prepared.Response, state.SpaceID, state.BindingRevision)
		if err != nil {
			return changed, err
		}
		completed := false
		for commit := 0; commit < desktopSyncAttempts; commit++ {
			current, err := s.prepareVault(kind, id)
			if err != nil {
				return changed, err
			}
			if current.SpaceID != state.SpaceID || current.BindingRevision != state.BindingRevision || current.Document != prepared.Document {
				return changed, errDesktopSyncChanged
			}
			received, err := syncengine.Complete(current.Document, current.Snapshot, response, false)
			if err != nil {
				return changed, err
			}
			if received.Realigned {
				// The baseline is gone, so the record's version is whatever is
				// applied locally, not a server version an open conflict had selected.
				received.Snapshot = syncdata.Snapshot{}
				if current.AppliedRef != "" {
					received.Snapshot[syncdata.ValueKey] = syncdata.Record{"ref": current.AppliedRef}
				}
			}
			saved, err := s.saveVault(vaultSave(current, received))
			if err != nil {
				return changed, err
			}
			if !saved {
				continue
			}
			changed = changed || (!received.Realigned && len(received.Conflicts) == 0 && syncdata.Hash(current.Snapshot) != syncdata.Hash(received.Snapshot))
			if !received.NeedsSync {
				return changed, nil
			}
			completed = true
			break
		}
		if !completed {
			return changed, errDesktopSyncBusy
		}
	}
	return changed, errDesktopSyncBusy
}

// ResolveConflicts applies the user's choices locally; the next exchange reports
// them. Configuration choices share one document and one save, each vault
// record is its own document.
func (s *DesktopSyncService) ResolveConflicts(choices []syncengine.Resolution) error {
	var configuration, vault []syncengine.Resolution
	for _, choice := range choices {
		if strings.HasPrefix(choice.Key, "vault/") {
			vault = append(vault, choice)
		} else {
			configuration = append(configuration, choice)
		}
	}
	if len(configuration) > 0 {
		state, err := s.Load()
		if err != nil {
			return err
		}
		result, err := syncengine.Resolve(state.Document, state.Snapshot, configuration)
		if err != nil {
			return err
		}
		saved, err := s.save(DesktopSyncSave{Revision: state.Revision, Hash: state.Hash, Document: result.Document, Snapshot: result.Snapshot})
		if err != nil {
			return err
		}
		if !saved {
			return errDesktopSyncChanged
		}
	}
	for _, choice := range vault {
		if err := s.ResolveVault(choice.Key, choice.Value, nil); err != nil {
			return err
		}
	}
	return nil
}

// ResolveVault chooses one version of a vault record. A non-nil identical is
// the candidate set that was compared as equal; the choice is only made
// automatically while those are still the candidates.
func (s *DesktopSyncService) ResolveVault(key, value string, identical []string) error {
	parts := strings.Split(key, "/")
	if len(parts) != 3 || parts[0] != "vault" {
		return errors.New("invalid vault conflict")
	}
	state, err := s.prepareVault(parts[1], parts[2])
	if err != nil {
		return err
	}
	// A local edit made since the conflict is a new version that supersedes it.
	peer, err := syncengine.Outgoing(state.Document, state.Snapshot)
	if err != nil {
		return err
	}
	if len(peer.Changes) > 0 {
		return errDesktopSyncChanged
	}
	if identical != nil {
		inspected, err := syncengine.Inspect(state.Document)
		if err != nil {
			return err
		}
		index := slices.IndexFunc(inspected.Conflicts, func(conflict syncengine.Conflict) bool {
			return conflict.Key == syncdata.ValueKey && conflict.Field == "ref"
		})
		if index < 0 || len(inspected.Conflicts[index].Values) != len(identical) || slices.ContainsFunc(inspected.Conflicts[index].Values, func(candidate string) bool {
			return !slices.Contains(identical, candidate)
		}) {
			return errDesktopSyncChanged
		}
	}
	result, err := syncengine.Resolve(state.Document, state.Snapshot, []syncengine.Resolution{{Key: syncdata.ValueKey, Field: "ref", Value: value}})
	if err != nil {
		return err
	}
	saved, err := s.saveVault(vaultSave(state, result))
	if err != nil {
		return err
	}
	if !saved {
		return errDesktopSyncChanged
	}
	return nil
}
