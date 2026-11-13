// Package syncengine merges per-field edits between one hub (the server) and
// its replicas (desktop devices). The hub assigns every accepted edit an
// increasing version; a replica reports each edit together with the version it
// was based on, which is what separates an ordinary update from a concurrent one.
package syncengine

import (
	"encoding/json"
	"errors"
	"maps"
	"regexp"
	"slices"
	"strings"

	"github.com/easyssh/shared/syncdata"
)

const (
	maxRecords    = 20000
	maxFieldBytes = 1 << 20
)

var keyPattern = regexp.MustCompile(`^(server|script|group|value|order)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

var errConflictChanged = errors.New("conflict has changed; refresh and retry")

// Change is one edit on the wire. From a replica, Version is the hub version the
// edit was based on, or the conflict version when Resolve is set. From the hub,
// Version is the version assigned to the value or to the deletion.
type Change struct {
	Key     string `json:"key"`
	Field   string `json:"field,omitempty"`
	Value   string `json:"value,omitempty"`
	Version uint64 `json:"version,omitempty"`
	Deleted bool   `json:"deleted,omitempty"`
	Resolve bool   `json:"resolve,omitempty"`
}

// Conflict lists the candidate values of one field. Version changes whenever
// the candidates change, so a resolution cannot discard a candidate its author
// never saw.
type Conflict struct {
	Key     string   `json:"key"`
	Field   string   `json:"field"`
	Values  []string `json:"values"`
	Version uint64   `json:"version,omitempty"`
}

// Peer is the exchange message in both directions. Cursor is the highest hub
// version the sender has applied. Only the hub fills Conflicts, always with the
// complete list.
//
// Timeline names the hub history that Cursor and the change versions belong to.
// A replica sends the timeline of its baseline, or none when it has no
// baseline. When the hub is on another timeline it answers Realign without
// applying anything: the replica drops its baseline and asks again.
type Peer struct {
	Timeline  string     `json:"timeline,omitempty"`
	Realign   bool       `json:"realign,omitempty"`
	Replica   string     `json:"replica,omitempty"`
	Sequence  uint64     `json:"sequence,omitempty"`
	Cursor    uint64     `json:"cursor"`
	Changes   []Change   `json:"changes,omitempty"`
	Conflicts []Conflict `json:"conflicts,omitempty"`
}

type Resolution struct {
	Key   string `json:"key"`
	Field string `json:"field"`
	Value string `json:"value"`
}

type Result struct {
	// Realigned reports that the replica dropped its baseline and changed no data.
	Realigned bool
	NeedsSync bool
	Document  string
	Snapshot  syncdata.Snapshot
	Conflicts []Conflict
	Response  Peer
}

type HubInput struct {
	Document string
	// Current is the hub's own data; differences from Document are hub edits.
	Current    syncdata.Snapshot
	Peer       Peer
	Resolution *Resolution
	// Configuration keeps the hub's own value of every conflicting field.
	Configuration bool
}

type field struct {
	Value   string `json:"v"`
	Version uint64 `json:"n"`
}

// A deleted record keeps only the version of its deletion.
type record struct {
	Fields  map[string]field `json:"f,omitempty"`
	Deleted uint64           `json:"d,omitempty"`
}

type candidates struct {
	Values  []string `json:"v"`
	Version uint64   `json:"n"`
}

type pending struct {
	Value   string `json:"v"`
	Version uint64 `json:"n"`
}

// state is the persisted document. On the hub it holds the authoritative
// values; on a replica it holds the values last acknowledged by the hub.
type state struct {
	// Timeline identifies the hub history the versions belong to. A hub gets a
	// new one whenever its history stops continuing the previous one, such as
	// after a restore from a backup.
	Timeline  string                            `json:"timeline,omitempty"`
	Queued    []Change                          `json:"queued,omitempty"`
	Replica   string                            `json:"replica,omitempty"`
	Sequence  uint64                            `json:"sequence,omitempty"`
	Flight    *flight                           `json:"flight,omitempty"`
	Receipts  map[string]receipt                `json:"receipts,omitempty"`
	Seq       uint64                            `json:"seq"`
	Records   map[string]*record                `json:"records"`
	Conflicts map[string]map[string]*candidates `json:"conflicts,omitempty"`
	// Resolutions are replica choices not yet reported to the hub.
	Resolutions map[string]map[string]pending `json:"resolutions,omitempty"`
	// Withheld are conflicting records this side has never applied. Their
	// absence from the business data is not a deletion.
	Withheld map[string]bool `json:"withheld,omitempty"`
}

func load(document string) (*state, error) {
	st := &state{}
	if document != "" {
		if err := json.Unmarshal([]byte(document), st); err != nil {
			return nil, errors.New("invalid sync document")
		}
	}
	if st.Records == nil {
		st.Records = map[string]*record{}
	}
	if len(st.Records) > maxRecords {
		return nil, errors.New("sync history has too many records")
	}
	for key, rec := range st.Records {
		if rec == nil || !keyPattern.MatchString(key) {
			return nil, errors.New("invalid sync record")
		}
	}
	return st, nil
}

func (st *state) save() string {
	data, _ := json.Marshal(st)
	return string(data)
}

func sortedKeys[V any](m map[string]V) []string {
	return slices.Sorted(maps.Keys(m))
}

func conflictField(key, name string) bool {
	switch name {
	case "connection", "content", "ref", "ids":
		return true
	case "name", "sort_order":
		return strings.HasPrefix(key, "group/")
	case "group_id":
		return strings.HasPrefix(key, "server/")
	}
	return false
}

func (st *state) live(key string) *record {
	if rec := st.Records[key]; rec != nil && rec.Deleted == 0 {
		return rec
	}
	return nil
}

func (st *state) conflict(key, name string) *candidates {
	return st.Conflicts[key][name]
}

func (st *state) clearConflict(key, name string) {
	delete(st.Conflicts[key], name)
	if len(st.Conflicts[key]) == 0 {
		delete(st.Conflicts, key)
	}
}

// set writes a hub value. Any write supersedes the field's conflict.
func (st *state) set(key, name, value string) {
	rec := st.Records[key]
	if rec == nil || rec.Deleted != 0 {
		rec = &record{}
		st.Records[key] = rec
	}
	if rec.Fields == nil {
		rec.Fields = map[string]field{}
	}
	st.Seq++
	rec.Fields[name] = field{Value: value, Version: st.Seq}
	st.clearConflict(key, name)
}

func (st *state) remove(key string) {
	st.Seq++
	st.Records[key] = &record{Deleted: st.Seq}
	delete(st.Conflicts, key)
}

func (st *state) addCandidate(key, name string, values ...string) {
	if st.Conflicts == nil {
		st.Conflicts = map[string]map[string]*candidates{}
	}
	if st.Conflicts[key] == nil {
		st.Conflicts[key] = map[string]*candidates{}
	}
	c := st.Conflicts[key][name]
	if c == nil {
		c = &candidates{}
		st.Conflicts[key][name] = c
	}
	changed := false
	for _, value := range values {
		if !slices.Contains(c.Values, value) {
			c.Values = append(c.Values, value)
			changed = true
		}
	}
	if changed {
		st.Seq++
		c.Version = st.Seq
	}
}

// A server whose group was deleted leaves the group; the group's own record is
// what carries the deletion.
func (st *state) detachDeletedGroups(snapshot syncdata.Snapshot) {
	for key, fields := range snapshot {
		if !strings.HasPrefix(key, "server/") || fields["group_id"] == "" {
			continue
		}
		if group := st.Records["group/"+fields["group_id"]]; group != nil && group.Deleted != 0 {
			fields["group_id"] = ""
		}
	}
}

func (st *state) project() (syncdata.Snapshot, []Conflict) {
	snapshot := syncdata.Snapshot{}
	for key, rec := range st.Records {
		if rec.Deleted != 0 {
			continue
		}
		fields := make(syncdata.Record, len(rec.Fields))
		for name, value := range rec.Fields {
			fields[name] = value.Value
		}
		snapshot[key] = fields
	}
	st.detachDeletedGroups(snapshot)
	conflicts := []Conflict{}
	for _, key := range sortedKeys(st.Conflicts) {
		if snapshot[key] == nil {
			continue
		}
		for _, name := range sortedKeys(st.Conflicts[key]) {
			c := st.Conflicts[key][name]
			conflicts = append(conflicts, Conflict{Key: key, Field: name, Values: slices.Clone(c.Values), Version: c.Version})
		}
	}
	return snapshot, conflicts
}

// projectConfiguration is what the local database should hold: every side keeps
// its own value of a conflicting field until someone resolves it.
func (st *state) projectConfiguration(current syncdata.Snapshot) (syncdata.Snapshot, []Conflict) {
	snapshot, conflicts := st.project()
	st.Withheld = nil
	for _, conflict := range conflicts {
		local, exists := current[conflict.Key]
		if !exists {
			// A new conflicting record has no confirmed local version to apply.
			// A group is display metadata: keep the hub's value so new servers
			// retain a valid dependency while the conflict stays visible.
			if !strings.HasPrefix(conflict.Key, "group/") {
				delete(snapshot, conflict.Key)
				if st.Withheld == nil {
					st.Withheld = map[string]bool{}
				}
				st.Withheld[conflict.Key] = true
			}
			continue
		}
		if fields := snapshot[conflict.Key]; fields != nil {
			if value, ok := local[conflict.Field]; ok {
				fields[conflict.Field] = value
			}
		}
	}
	st.detachDeletedGroups(snapshot)
	if snapshot[syncdata.ServerOrderKey] == nil {
		snapshot[syncdata.ServerOrderKey] = syncdata.Record{"ids": "[]"}
	}
	return snapshot, conflicts
}

func parseIDs(value string) ([]string, error) {
	var ids []string
	if err := json.Unmarshal([]byte(value), &ids); err != nil || ids == nil {
		return nil, errors.New("invalid server order")
	}
	return ids, nil
}

// effectiveOrder is an ordering decision applied to the current members:
// removed IDs are ignored and members it does not mention follow in ID order.
func effectiveOrder(ids, members []string) []string {
	remaining := make(map[string]bool, len(members))
	for _, id := range members {
		remaining[id] = true
	}
	ordered := make([]string, 0, len(members))
	for _, id := range ids {
		if remaining[id] {
			ordered = append(ordered, id)
			delete(remaining, id)
		}
	}
	return append(ordered, sortedKeys(remaining)...)
}

// A membership change is not a different ordering decision.
func sameEffectiveOrder(previous, value string) bool {
	actual, err := parseIDs(value)
	if err != nil {
		return false
	}
	old, err := parseIDs(previous)
	if err != nil {
		return false
	}
	return slices.Equal(effectiveOrder(old, actual), actual)
}

// pruneOrderConflict drops ordering candidates that no longer differ once
// applied to the live servers.
func (st *state) pruneOrderConflict() error {
	c := st.conflict(syncdata.ServerOrderKey, "ids")
	if c == nil {
		return nil
	}
	var members []string
	for key, rec := range st.Records {
		if rec.Deleted == 0 && strings.HasPrefix(key, "server/") {
			members = append(members, strings.TrimPrefix(key, "server/"))
		}
	}
	seen := map[string]bool{}
	kept := []string{}
	for _, value := range c.Values {
		ids, err := parseIDs(value)
		if err != nil {
			return err
		}
		signature := strings.Join(effectiveOrder(ids, members), ",")
		if !seen[signature] {
			seen[signature] = true
			kept = append(kept, value)
		}
	}
	if len(kept) > 1 {
		c.Values = kept
	} else {
		st.clearConflict(syncdata.ServerOrderKey, "ids")
	}
	return nil
}

type edit struct {
	key, field, value string
	deleted           bool
}

// diff lists how current differs from the document. A field in conflict is not
// an edit: retaining a value is not a resolution. A vault reference is the
// exception, because a new reference is a new version that supersedes both.
// Removing a record is always an edit, conflicts or not, unless the record was
// withheld and so was never there to remove.
func (st *state) diff(current syncdata.Snapshot) []edit {
	previous, conflicts := st.project()
	blocked := map[string]map[string]bool{}
	for _, conflict := range conflicts {
		if conflict.Field == "ref" {
			continue
		}
		if blocked[conflict.Key] == nil {
			blocked[conflict.Key] = map[string]bool{}
		}
		blocked[conflict.Key][conflict.Field] = true
	}
	// No order record means the implicit empty baseline. A side that has not
	// received its first data must not publish an empty ordering decision.
	skipOrder := st.Records[syncdata.ServerOrderKey] == nil && current[syncdata.ServerOrderKey]["ids"] == "[]"
	var edits []edit
	for _, key := range sortedKeys(previous) {
		if _, exists := current[key]; exists {
			continue
		}
		if !st.Withheld[key] {
			edits = append(edits, edit{key: key, deleted: true})
		}
	}
	for _, key := range sortedKeys(current) {
		if skipOrder && key == syncdata.ServerOrderKey {
			continue
		}
		for _, name := range sortedKeys(current[key]) {
			value := current[key][name]
			if blocked[key][name] {
				continue
			}
			if old, exists := previous[key][name]; exists {
				if old == value {
					continue
				}
				if name == "ids" && old != "" && strings.HasPrefix(key, "order/") && sameEffectiveOrder(old, value) {
					continue
				}
			}
			edits = append(edits, edit{key: key, field: name, value: value})
		}
	}
	return edits
}

// receive merges a replica's changes. A baseless replica shares no history
// with the hub, so its data can only be compared by value: nothing it lacks is
// a deletion and nothing it holds is known to be newer.
func (st *state) receive(peer Peer, baseless bool) error {
	for _, change := range peer.Changes {
		if !keyPattern.MatchString(change.Key) {
			return errors.New("invalid sync record")
		}
		if baseless {
			if change.Deleted {
				continue
			}
			change.Version, change.Resolve = 0, false
		}
		rec := st.Records[change.Key]
		if change.Deleted {
			// A deletion wins over concurrent edits.
			if rec != nil && rec.Deleted == 0 {
				st.remove(change.Key)
			}
			continue
		}
		if change.Field == "" || len(change.Value) > maxFieldBytes {
			return errors.New("invalid sync field")
		}
		if rec == nil {
			st.set(change.Key, change.Field, change.Value)
			continue
		}
		if rec.Deleted != 0 {
			// Only a replica that has seen the deletion can recreate the record.
			// A baseless one cannot have seen it and keeps what it holds.
			if baseless || peer.Cursor >= rec.Deleted {
				st.set(change.Key, change.Field, change.Value)
			}
			continue
		}
		current, exists := rec.Fields[change.Field]
		if !exists {
			st.set(change.Key, change.Field, change.Value)
			continue
		}
		conflict := st.conflict(change.Key, change.Field)
		if change.Resolve && conflict != nil && conflict.Version == change.Version {
			st.set(change.Key, change.Field, change.Value)
			continue
		}
		if current.Value == change.Value {
			continue
		}
		if conflict != nil {
			st.addCandidate(change.Key, change.Field, change.Value)
			continue
		}
		if !change.Resolve && change.Version == current.Version {
			st.set(change.Key, change.Field, change.Value)
			continue
		}
		// The replica had not seen the hub's current value.
		if conflictField(change.Key, change.Field) {
			st.addCandidate(change.Key, change.Field, current.Value, change.Value)
		} else if !baseless {
			st.set(change.Key, change.Field, change.Value)
		}
	}
	return nil
}

func (st *state) resolve(resolution Resolution) error {
	conflict := st.conflict(resolution.Key, resolution.Field)
	if st.live(resolution.Key) == nil || conflict == nil || !slices.Contains(conflict.Values, resolution.Value) {
		return errConflictChanged
	}
	st.set(resolution.Key, resolution.Field, resolution.Value)
	return nil
}

func (st *state) outgoing(cursor uint64) Peer {
	peer := Peer{Cursor: st.Seq}
	for _, key := range sortedKeys(st.Records) {
		rec := st.Records[key]
		if rec.Deleted != 0 {
			if rec.Deleted > cursor {
				peer.Changes = append(peer.Changes, Change{Key: key, Deleted: true, Version: rec.Deleted})
			}
			continue
		}
		for _, name := range sortedKeys(rec.Fields) {
			if value := rec.Fields[name]; value.Version > cursor {
				peer.Changes = append(peer.Changes, Change{Key: key, Field: name, Value: value.Value, Version: value.Version})
			}
		}
	}
	_, peer.Conflicts = st.project()
	return peer
}

// Exchange runs one round on the hub: record the hub's own edits, merge the
// replica's, apply an optional resolution, and answer with everything the
// replica has not seen.
func Exchange(input HubInput) (Result, error) {
	st, err := load(input.Document)
	if err != nil {
		return Result{}, err
	}
	if st.Timeline == "" {
		st.Timeline = newIdentity()
	}
	baseless := input.Peer.Timeline == ""
	realign := !baseless && input.Peer.Timeline != st.Timeline
	cursor := input.Peer.Cursor
	if baseless {
		cursor = 0
	}
	if !realign && cursor > st.Seq {
		return Result{}, errors.New("device sync state is newer than the server")
	}
	if err = st.pruneOrderConflict(); err != nil {
		return Result{}, err
	}
	for _, e := range st.diff(input.Current) {
		if e.deleted {
			st.remove(e.key)
		} else {
			st.set(e.key, e.field, e.value)
		}
	}
	duplicate := false
	if !realign {
		if duplicate, err = st.checkRequest(input.Peer); err != nil {
			return Result{}, err
		}
		if !duplicate {
			if err = st.receive(input.Peer, baseless); err != nil {
				return Result{}, err
			}
		}
	}
	if input.Resolution != nil {
		if err = st.resolve(*input.Resolution); err != nil {
			return Result{}, err
		}
	}
	if len(st.Records) > maxRecords {
		return Result{}, errors.New("sync history has too many records")
	}
	if err = st.pruneOrderConflict(); err != nil {
		return Result{}, err
	}
	result := Result{Response: Peer{Realign: true}}
	if !realign {
		result.Response = st.outgoing(cursor)
	}
	result.Response.Timeline = st.Timeline
	result.Response.Replica, result.Response.Sequence = input.Peer.Replica, input.Peer.Sequence
	if !realign && !duplicate && input.Peer.Sequence != 0 {
		if st.Receipts == nil {
			st.Receipts = map[string]receipt{}
		}
		st.Receipts[input.Peer.Replica] = receipt{Sequence: input.Peer.Sequence, Digest: requestDigest(input.Peer)}
	}
	if input.Configuration {
		result.Snapshot, result.Conflicts = st.projectConfiguration(input.Current)
	} else {
		result.Snapshot, result.Conflicts = st.project()
	}
	result.Document = st.save()
	return result, nil
}

// Inspect reads a document without changing it.
func Inspect(document string) (Result, error) {
	st, err := load(document)
	if err != nil {
		return Result{}, err
	}
	result := Result{Document: document}
	result.Snapshot, result.Conflicts = st.project()
	return result, nil
}

// Outgoing is a replica's request: its edits since the last exchange and the
// choices it made for conflicts.
func Outgoing(document string, current syncdata.Snapshot) (Peer, error) {
	st, err := load(document)
	if err != nil {
		return Peer{}, err
	}
	if st.Flight != nil {
		return st.Flight.Peer, nil
	}
	peer := Peer{Timeline: st.Timeline, Cursor: st.Seq, Replica: st.Replica}
	if peer.Replica == "" {
		peer.Replica = newIdentity()
	}
	sent := map[string]bool{}
	for _, e := range st.diff(current) {
		if e.deleted {
			sent[e.key] = true
			peer.Changes = append(peer.Changes, Change{Key: e.key, Deleted: true})
			continue
		}
		change := Change{Key: e.key, Field: e.field, Value: e.value}
		if choice, exists := st.Resolutions[e.key][e.field]; exists {
			change.Resolve, change.Version = true, choice.Version
		} else if conflict := st.conflict(e.key, e.field); conflict != nil {
			change.Resolve, change.Version = true, conflict.Version
		} else if rec := st.live(e.key); rec != nil {
			change.Version = rec.Fields[e.field].Version
		}
		sent[e.key+"\x00"+e.field] = true
		peer.Changes = append(peer.Changes, change)
	}
	// A choice equal to the hub's value is not an edit, yet the hub must still
	// learn that the conflict is settled.
	for _, key := range sortedKeys(st.Resolutions) {
		if sent[key] {
			continue
		}
		for _, name := range sortedKeys(st.Resolutions[key]) {
			if sent[key+"\x00"+name] {
				continue
			}
			choice := st.Resolutions[key][name]
			value := choice.Value
			if local, exists := current[key][name]; exists {
				value = local
			}
			peer.Changes = append(peer.Changes, Change{Key: key, Field: name, Value: value, Version: choice.Version, Resolve: true})
		}
	}
	for _, change := range st.Queued {
		value, exists := current[change.Key][change.Field]
		if !exists {
			continue
		}
		change.Value = value
		if sent[change.Key] {
			continue
		}
		index := slices.IndexFunc(peer.Changes, func(existing Change) bool { return existing.Key == change.Key && existing.Field == change.Field })
		if index >= 0 {
			peer.Changes[index] = change
		} else {
			peer.Changes = append(peer.Changes, change)
		}
	}
	if len(peer.Changes) > 0 {
		peer.Sequence = st.Sequence + 1
	}
	return peer, nil
}

// Receive applies the hub's answer to a replica. Every edit of the request was
// either accepted, merged or turned into a conflict, so the hub's values plus
// the replica's own conflicting values are the complete local data.
func Receive(document string, current syncdata.Snapshot, response Peer, configuration bool) (Result, error) {
	st, err := load(document)
	if err != nil {
		return Result{}, err
	}
	if st.Flight != nil && (response.Replica != st.Flight.Peer.Replica || response.Sequence != st.Flight.Peer.Sequence) {
		return Result{}, errors.New("sync response does not acknowledge the pending request")
	}
	if response.Realign {
		return realigned(current), nil
	}
	if response.Timeline == "" || st.Timeline != "" && response.Timeline != st.Timeline {
		return Result{}, errors.New("sync response belongs to another server history")
	}
	if response.Cursor < st.Seq {
		return Result{}, errors.New("server sync state is older than this device")
	}
	for _, change := range response.Changes {
		if !keyPattern.MatchString(change.Key) {
			return Result{}, errors.New("invalid sync record")
		}
		if change.Deleted {
			st.Records[change.Key] = &record{Deleted: change.Version}
			continue
		}
		if change.Field == "" {
			return Result{}, errors.New("invalid sync field")
		}
		rec := st.live(change.Key)
		if rec == nil {
			rec = &record{}
			st.Records[change.Key] = rec
		}
		if rec.Fields == nil {
			rec.Fields = map[string]field{}
		}
		rec.Fields[change.Field] = field{Value: change.Value, Version: change.Version}
	}
	if len(st.Records) > maxRecords {
		return Result{}, errors.New("sync history has too many records")
	}
	st.Seq = response.Cursor
	st.Timeline = response.Timeline
	st.Replica = response.Replica
	if response.Sequence != 0 {
		st.Sequence = response.Sequence
	}
	st.Flight = nil
	st.Queued = nil
	st.Conflicts = nil
	for _, conflict := range response.Conflicts {
		if st.Conflicts == nil {
			st.Conflicts = map[string]map[string]*candidates{}
		}
		if st.Conflicts[conflict.Key] == nil {
			st.Conflicts[conflict.Key] = map[string]*candidates{}
		}
		st.Conflicts[conflict.Key][conflict.Field] = &candidates{Values: slices.Clone(conflict.Values), Version: conflict.Version}
	}
	st.Resolutions = nil
	result := Result{}
	if configuration {
		result.Snapshot, result.Conflicts = st.projectConfiguration(current)
	} else {
		result.Snapshot, result.Conflicts = st.project()
	}
	result.Document = st.save()
	return result, nil
}

// Resolve records a replica's choices and returns the local data with them
// applied. The hub learns about them in the next exchange.
func Resolve(document string, current syncdata.Snapshot, choices []Resolution) (Result, error) {
	st, err := load(document)
	if err != nil {
		return Result{}, err
	}
	if st.Flight != nil || len(st.Queued) > 0 {
		return Result{}, errors.New("finish the pending sync before resolving conflicts")
	}
	snapshot := make(syncdata.Snapshot, len(current))
	for key, fields := range current {
		snapshot[key] = maps.Clone(fields)
	}
	for _, choice := range choices {
		conflict := st.conflict(choice.Key, choice.Field)
		if st.live(choice.Key) == nil || conflict == nil || !slices.Contains(conflict.Values, choice.Value) {
			return Result{}, errConflictChanged
		}
		if st.Resolutions == nil {
			st.Resolutions = map[string]map[string]pending{}
		}
		if st.Resolutions[choice.Key] == nil {
			st.Resolutions[choice.Key] = map[string]pending{}
		}
		st.Resolutions[choice.Key][choice.Field] = pending{Value: choice.Value, Version: conflict.Version}
		st.clearConflict(choice.Key, choice.Field)
	}
	for _, choice := range choices {
		if snapshot[choice.Key] != nil {
			snapshot[choice.Key][choice.Field] = choice.Value
			continue
		}
		// A record withheld by its conflicts appears once the last one is settled.
		if len(st.Conflicts[choice.Key]) > 0 {
			continue
		}
		fields := syncdata.Record{}
		for name, value := range st.live(choice.Key).Fields {
			fields[name] = value.Value
		}
		for name, settled := range st.Resolutions[choice.Key] {
			fields[name] = settled.Value
		}
		snapshot[choice.Key] = fields
	}
	for key := range st.Withheld {
		if snapshot[key] != nil {
			delete(st.Withheld, key)
		}
	}
	st.detachDeletedGroups(snapshot)
	result := Result{Document: st.save(), Snapshot: snapshot}
	_, result.Conflicts = st.project()
	return result, nil
}
