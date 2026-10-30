package aiwire

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestHistoryPagesHonorByteBudgetWithoutSkippingRecords(t *testing.T) {
	ids := make([]string, 60)
	for i := range ids {
		ids[i] = fmt.Sprintf("message-%d", i)
	}
	read := func(i int) (any, error) {
		return map[string]string{"id": ids[i], "text": strings.Repeat("中<&", 2000)}, nil
	}
	input := protocol.AIHistoryInput{Kind: "messages", Limit: 100}
	var got []string
	pages := 0
	for {
		page, err := BuildHistoryPage("session", time.Now(), input, ids, read)
		if err != nil {
			t.Fatal(err)
		}
		if err := ValidateHistoryPage("session", input, page); err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(page)
		if err != nil || len(raw) > MaxHistoryPageBytes {
			t.Fatalf("unbounded page: %d %v", len(raw), err)
		}
		for _, item := range page.Items {
			if len(item.Data) == 0 {
				t.Fatal("fixture must exercise inline byte budget")
			}
			got = append(got, item.ID)
		}
		pages++
		if !page.HasMore {
			break
		}
		input.AfterID = page.NextAfterID
	}
	if pages < 2 || len(got) != len(ids) {
		t.Fatalf("bad traversal: %d pages, %d items", pages, len(got))
	}
	for i := range ids {
		if got[i] != ids[i] {
			t.Fatal("budget consumed an unseen item")
		}
	}
}

func TestHistoryRejectsLostCursorAndInvalidQueries(t *testing.T) {
	read := func(int) (any, error) { t.Fatal("invalid cursor read content"); return nil, nil }
	if _, err := BuildHistoryPage("session", time.Now(), protocol.AIHistoryInput{Kind: "tasks", AfterID: "deleted"}, []string{"retained"}, read); !errors.Is(err, ErrHistoryCursor) {
		t.Fatal(err)
	}
	page, err := BuildHistoryPage("session", time.Now(), protocol.AIHistoryInput{Kind: "tasks"}, nil, read)
	if err != nil || page.HasMore || len(page.Items) != 0 || page.NextAfterID != "" {
		t.Fatal("bad empty history", err)
	}
	if err := ValidateHistoryPage("session", protocol.AIHistoryInput{Kind: "tasks"}, page); err != nil {
		t.Fatal(err)
	}
	for _, input := range []protocol.AIHistoryInput{{Kind: "unknown"}, {Kind: "tasks", Limit: -1}, {Kind: "tasks", Limit: 101}, {Kind: "tasks", AfterID: "bad\n"}} {
		if _, err := NormalizeHistoryInput(input); err == nil {
			t.Fatal("accepted invalid page", input)
		}
	}

}

func TestTextChunksAreUTF8AndEscapeBounded(t *testing.T) {
	text := strings.Repeat("界\x00<", 20000)
	var restored strings.Builder
	for remaining := text; remaining != ""; {
		head, tail := NextTextChunk(remaining)
		if len(head) == 0 || len(head) > MaxTextDeltaBytes || !utf8.ValidString(head) {
			t.Fatal("invalid text boundary")
		}
		raw, err := json.Marshal(map[string]string{"type": "text-delta", "delta": head})
		if err != nil || len(raw) > MaxStreamChunkBytes {
			t.Fatal("JSON escape overflow", err)
		}
		restored.WriteString(head)
		remaining = tail
	}
	if restored.String() != text {
		t.Fatal("lost text")
	}
}

func TestHistoryPageRequiresReadableAndMatchingContentReference(t *testing.T) {
	input := protocol.AIHistoryInput{Kind: "messages"}
	item, err := DescribeHistoryItem("message", map[string]string{"text": strings.Repeat("body", 20000)})
	if err != nil {
		t.Fatal(err)
	}
	describe := func(int) (protocol.AIHistoryItem, error) { return item, nil }
	if _, err := BuildHistoryDescriptorWindow("session", time.Now(), input, 1, []string{item.ID}, describe); err == nil {
		t.Fatal("advertised uncommitted body")
	}
	item.Content = &protocol.ContentReference{ID: uuid.New(), Sha256: item.Hash, Size: int64(item.Bytes), MediaType: "application/json"}
	page, err := BuildHistoryDescriptorWindow("session", time.Now(), input, 1, []string{item.ID}, describe)
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateHistoryPage("session", input, page); err != nil {
		t.Fatal(err)
	}
	page.Items[0].Content.Size++
	if ValidateHistoryPage("session", input, page) == nil {
		t.Fatal("accepted mismatched body")
	}
}
