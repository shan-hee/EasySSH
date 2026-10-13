package syncdata

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// ServerOrderKey belongs to its containing configuration space. Its IDs are
// remote server IDs from that space, never local database primary keys.
const ServerOrderKey = "order/00000000-0000-4000-8000-000000000001"

// ConfigurationProtocol includes server ordering across desktop and Web.
const ConfigurationProtocol = 4

func ConfigurationRecordCount(snapshot Snapshot) int {
	count := 0
	for key := range snapshot {
		if strings.HasPrefix(key, "server/") || strings.HasPrefix(key, "script/") {
			count++
		}
	}
	return count
}

func ParseServerOrder(value string) ([]string, error) {
	if len(value) > 1<<20 {
		return nil, fmt.Errorf("server order is too large")
	}
	var ids []string
	if err := json.Unmarshal([]byte(value), &ids); err != nil || ids == nil || len(ids) > 10000 {
		return nil, fmt.Errorf("invalid server order")
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if !ValidUUID(id) || id != strings.ToLower(id) || seen[id] {
			return nil, fmt.Errorf("invalid or duplicate server order ID")
		}
		seen[id] = true
	}
	return ids, nil
}

// OrderedServers filters deleted IDs and appends concurrent additions by remote
// ID, independently of local IDs and local creation times.
func OrderedServers(snapshot Snapshot) ([]string, error) {
	ids, err := ParseServerOrder(snapshot[ServerOrderKey]["ids"])
	if err != nil {
		return nil, err
	}
	remaining := make(map[string]bool)
	for key := range snapshot {
		if strings.HasPrefix(key, "server/") {
			remaining[strings.TrimPrefix(key, "server/")] = true
		}
	}
	result := make([]string, 0, len(remaining))
	for _, id := range ids {
		if remaining[id] {
			result = append(result, id)
			delete(remaining, id)
		}
	}
	added := make([]string, 0, len(remaining))
	for id := range remaining {
		added = append(added, id)
	}
	sort.Strings(added)
	return append(result, added...), nil
}

// ProjectServerSlots only replaces slots belonging to this space. Unenrolled
// servers and records from other spaces keep their positions in the full list.
func ProjectServerSlots(localIDs, orderedRemoteIDs []string, remoteToLocal map[string]string) ([]string, error) {
	selected := make(map[string]bool, len(remoteToLocal))
	for _, localID := range remoteToLocal {
		if localID == "" || selected[localID] {
			return nil, fmt.Errorf("invalid server order mapping")
		}
		selected[localID] = true
	}
	if len(orderedRemoteIDs) != len(selected) {
		return nil, fmt.Errorf("server order does not match space membership")
	}
	ordered := make([]string, 0, len(selected))
	seen := make(map[string]bool, len(selected))
	for _, remoteID := range orderedRemoteIDs {
		localID := remoteToLocal[remoteID]
		if localID == "" || seen[localID] {
			return nil, fmt.Errorf("server order contains an unknown or duplicate ID")
		}
		ordered = append(ordered, localID)
		seen[localID] = true
	}
	result := append([]string(nil), localIDs...)
	next := 0
	for i, id := range result {
		if selected[id] {
			if next == len(ordered) {
				return nil, fmt.Errorf("duplicate local server ID")
			}
			result[i] = ordered[next]
			next++
		}
	}
	if next != len(ordered) {
		return nil, fmt.Errorf("server order mapping references a missing server")
	}
	return result, nil
}
