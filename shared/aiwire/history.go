package aiwire

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	MaxHistoryPageBytes   = 512 << 10
	MaxHistoryInlineBytes = 32 << 10
)

var ErrHistoryQuery = errors.New("invalid AI history query")
var ErrHistoryCursor = errors.New("AI history cursor no longer exists; refresh the history")

func ValidHistoryID(value string) bool {
	if value == "" || len(value) > 256 || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func validHistoryKind(kind string) bool { return kind == "messages" || kind == "tasks" }
func ValidHistoryHash(value string) bool {
	if len(value) != 64 || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
func HistoryHash(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func NormalizeHistoryInput(input protocol.AIHistoryInput) (protocol.AIHistoryInput, error) {
	if input.Limit == 0 {
		input.Limit = 20
	}
	if !validHistoryKind(input.Kind) || input.AfterID != "" && !ValidHistoryID(input.AfterID) || input.Limit < 1 || input.Limit > 100 {
		return input, ErrHistoryQuery
	}
	return input, nil
}
func DescribeHistoryItem(id string, value any) (protocol.AIHistoryItem, error) {
	if !ValidHistoryID(id) {
		return protocol.AIHistoryItem{}, ErrHistoryQuery
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return protocol.AIHistoryItem{}, err
	}
	item := protocol.AIHistoryItem{ID: id, Bytes: len(raw), Hash: HistoryHash(raw)}
	if len(raw) <= MaxHistoryInlineBytes {
		item.Data = raw
	}
	return item, nil
}

// Pages are live, in source order. An explicit deleted cursor is a conflict;
// unseen entries are never silently consumed by the page byte budget.
func BuildHistoryPage(sessionID string, updatedAt time.Time, input protocol.AIHistoryInput, ids []string, read func(int) (any, error)) (protocol.AIHistoryPage, error) {
	input, err := NormalizeHistoryInput(input)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	start := 0
	if input.AfterID != "" {
		found := false
		for i, id := range ids {
			if id == input.AfterID {
				start = i + 1
				found = true
				break
			}
		}
		if !found {
			return protocol.AIHistoryPage{}, ErrHistoryCursor
		}
	}
	return BuildHistoryWindow(sessionID, updatedAt, input, len(ids), ids[start:], func(i int) (any, error) { return read(start + i) })
}

// ids is an already selected window after the validated cursor. A database
// reader fetches at most limit+1 items, so the extra row indicates more data
// without loading the remainder of the conversation. Byte limits may end the
// page earlier; the next cursor always names the last item actually returned.
func BuildHistoryWindow(sessionID string, updatedAt time.Time, input protocol.AIHistoryInput, total int, ids []string, read func(int) (any, error)) (protocol.AIHistoryPage, error) {
	return BuildHistoryDescriptorWindow(sessionID, updatedAt, input, total, ids, func(i int) (protocol.AIHistoryItem, error) {
		value, err := read(i)
		if err != nil {
			return protocol.AIHistoryItem{}, err
		}
		return DescribeHistoryItem(ids[i], value)
	})
}

// BuildHistoryDescriptorWindow assembles a page without loading referenced bodies.
func BuildHistoryDescriptorWindow(sessionID string, updatedAt time.Time, input protocol.AIHistoryInput, total int, ids []string, describe func(int) (protocol.AIHistoryItem, error)) (protocol.AIHistoryPage, error) {
	input, err := NormalizeHistoryInput(input)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	result := protocol.AIHistoryPage{SessionID: sessionID, Kind: input.Kind, UpdatedAt: updatedAt, Items: []protocol.AIHistoryItem{}, Total: total, NextAfterID: input.AfterID}
	used := 4096 // bounded envelope, timestamps and cursors
	next := 0
	for next < len(ids) && len(result.Items) < input.Limit {
		item, err := describe(next)
		if err != nil {
			return protocol.AIHistoryPage{}, err
		}
		if item.Content == nil && len(item.Data) == 0 {
			return protocol.AIHistoryPage{}, ErrHistoryQuery
		}
		encoded, err := json.Marshal(item)
		if err != nil {
			return protocol.AIHistoryPage{}, err
		}
		if used+len(encoded)+1 > MaxHistoryPageBytes {
			break
		}
		used += len(encoded) + 1
		result.Items = append(result.Items, item)
		result.NextAfterID = item.ID
		next++
	}
	result.HasMore = next < len(ids)
	return result, nil
}
func ValidateHistoryPage(sessionID string, input protocol.AIHistoryInput, page protocol.AIHistoryPage) error {
	input, err := NormalizeHistoryInput(input)
	if err != nil {
		return err
	}
	if page.SessionID != sessionID || page.Kind != input.Kind || page.Total < 0 || len(page.Items) > input.Limit || len(page.Items) > page.Total || page.UpdatedAt.IsZero() {
		return ErrHistoryQuery
	}
	seen := map[string]bool{}
	cursor := input.AfterID
	for _, item := range page.Items {
		if !ValidHistoryID(item.ID) || item.ID == input.AfterID || seen[item.ID] || item.Bytes < 1 || !ValidHistoryHash(item.Hash) {
			return ErrHistoryQuery
		}
		if len(item.Data) > 0 && (len(item.Data) > MaxHistoryInlineBytes || len(item.Data) != item.Bytes || HistoryHash(item.Data) != item.Hash || !json.Valid(item.Data)) {
			return ErrHistoryQuery
		}
		if item.Content != nil && (len(item.Data) != 0 || contentstore.ValidateReference(*item.Content) != nil || item.Content.Size != int64(item.Bytes) || item.Content.Sha256 != item.Hash || item.Content.MediaType != "application/json") {
			return ErrHistoryQuery
		}
		if len(item.Data) == 0 && item.Content == nil || item.Bytes <= MaxHistoryInlineBytes && len(item.Data) == 0 {
			return ErrHistoryQuery
		}
		seen[item.ID] = true
		cursor = item.ID
	}
	if page.NextAfterID != cursor || page.HasMore && len(page.Items) == 0 {
		return ErrHistoryQuery
	}
	raw, err := json.Marshal(page)
	if err != nil || len(raw) > MaxHistoryPageBytes {
		return ErrHistoryQuery
	}
	return nil
}
