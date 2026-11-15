package aitools

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/easyssh/shared/aitooloutput"
	"github.com/easyssh/shared/aiworkspace"
)

func TestReadFileResultRanges(t *testing.T) {
	for _, tc := range []struct {
		name, content, excerpt                 string
		start, limit, first, last, total, next int
	}{
		{"middle", "one\ntwo\nthree\n", "two", 2, 1, 2, 2, 3, 3},
		{"last", "one\ntwo\nthree\n", "three", 3, 100, 3, 3, 3, 0},
		{"empty", "", "", 0, 0, 1, 1, 1, 0},
		{"blank last line", "one\n\n", "one\n", -1, -1, 1, 2, 2, 0},
		{"sanitized with raw hash", "\x1b[31mred\x1b[0m\n", "red", 1, 1, 1, 1, 1, 0},
		{"no 500 line cap", strings.Repeat("x\n", 601), strings.TrimSuffix(strings.Repeat("x\n", 601), "\n"), 1, 1000, 1, 601, 601, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ReadFileResult("/file", tc.content, tc.start, tc.limit)
			next := ""
			if tc.next > 0 {
				next = fmt.Sprintf("，继续读取请传 start_line=%d", tc.next)
			}
			want := fmt.Sprintf("文件内容 (/file，第 %d-%d 行，共 %d 行，sha256=%s%s):\n```\n%s\n```", tc.first, tc.last, tc.total, aiworkspace.Hash(tc.content), next, tc.excerpt)
			if err != nil || got != want {
				t.Fatalf("got %q, %v; want %q", got, err, want)
			}
		})
	}
}

func TestReadFileResultBudgetAndErrors(t *testing.T) {
	line := strings.Repeat("界", aitooloutput.StoredTextBytes/3)
	content := line + "\nnext"
	first, err := ReadFileResult("/file", content, 1, 100)
	if err != nil || !strings.Contains(first, "第 1-1 行，共 2 行") || !strings.Contains(first, "start_line=2") || !strings.Contains(first, "\n"+line+"\n```") {
		t.Fatalf("exact byte boundary split a line: %v", err)
	}
	second, err := ReadFileResult("/file", content, 2, 100)
	if err != nil || !strings.Contains(second, "\nnext\n```") || strings.Contains(second, "继续读取") {
		t.Fatalf("continuation failed: %q %v", second, err)
	}
	oversized := line + "x"
	first, err = ReadFileResult("/file", "ok\n"+oversized+"\ntail", 1, 100)
	if err != nil || !strings.Contains(first, "start_line=2") {
		t.Fatalf("did not stop before oversized second line: %v", err)
	}
	for _, tc := range []struct {
		content string
		start   int
		message string
	}{
		{oversized, 1, "第 1 行超过"},
		{"ok\n" + oversized + "\ntail", 2, "第 2 行超过"},
		{"one\ntwo\n", 3, "共 2 行，start_line=3 超出范围"},
		{strings.Repeat("x", aiworkspace.MaxFileBytes+1), 1, "2 MiB"},
	} {
		got, err := ReadFileResult("/file", tc.content, tc.start, 100)
		if got != "" || err == nil || !strings.Contains(err.Error(), tc.message) {
			t.Fatalf("expected %q error, got %q %v", tc.message, got, err)
		}
	}
	defaults, err := ReadFileResult("/file", strings.Repeat("x\n", 101), 0, 0)
	if err != nil || !strings.Contains(defaults, "第 1-100 行，共 101 行") || !strings.Contains(defaults, "start_line=101") {
		t.Fatalf("default range changed: %q %v", defaults, err)
	}
}

type directoryPage struct {
	Path       string           `json:"path"`
	Parent     string           `json:"parent"`
	Files      []DirectoryEntry `json:"files"`
	Offset     int              `json:"offset"`
	Total      int              `json:"total"`
	CanRead    bool             `json:"can_read"`
	NextOffset *int             `json:"next_offset"`
}

func decodeDirectoryPage(t *testing.T, result string) directoryPage {
	t.Helper()
	if !strings.HasPrefix(result, "目录列表:\n") {
		t.Fatalf("missing result title: %q", result)
	}
	var page directoryPage
	if err := json.Unmarshal([]byte(strings.TrimPrefix(result, "目录列表:\n")), &page); err != nil {
		t.Fatal(err)
	}
	if page.Files == nil {
		t.Fatal("files must be an array, including empty pages")
	}
	return page
}

func TestDirectoryResultPagination(t *testing.T) {
	entries := []DirectoryEntry{{Name: "c"}, {Name: "a"}, {Name: "b"}}
	for _, tc := range []struct {
		offset, limit, start, count, next int
		first                             string
	}{
		{0, 1, 0, 1, 1, "a"},
		{1, 1, 1, 1, 2, "b"},
		{2, 2, 2, 1, -1, "c"},
		{99, 1, 3, 0, -1, ""},
		{-1, 0, 0, 3, -1, "a"},
	} {
		page := decodeDirectoryPage(t, DirectoryResult("/tmp/example", true, entries, tc.offset, tc.limit))
		if page.Path != "/tmp/example" || page.Parent != "/tmp" || !page.CanRead || page.Total != 3 || page.Offset != tc.start || len(page.Files) != tc.count {
			t.Fatalf("incorrect page: %+v", page)
		}
		if tc.count > 0 && page.Files[0].Name != tc.first {
			t.Fatalf("incorrect sort: %+v", page.Files)
		}
		if tc.next < 0 {
			if page.NextOffset != nil {
				t.Fatal("last page has a continuation")
			}
		} else if page.NextOffset == nil || *page.NextOffset != tc.next {
			t.Fatalf("incorrect continuation: %+v", page)
		}
	}
	if entries[0].Name != "c" {
		t.Fatal("caller-owned entries were sorted in place")
	}
	empty := decodeDirectoryPage(t, DirectoryResult("/", false, nil, 100, 100))
	if empty.Offset != 0 || empty.Total != 0 || empty.CanRead || empty.NextOffset != nil {
		t.Fatalf("incorrect empty page: %+v", empty)
	}
	entries = make([]DirectoryEntry, 101)
	for i := range entries {
		entries[i].Name = fmt.Sprintf("%03d", i)
	}
	page := decodeDirectoryPage(t, DirectoryResult("/", true, entries, 0, 0))
	if len(page.Files) != 100 || page.NextOffset == nil || *page.NextOffset != 100 {
		t.Fatalf("incorrect default limit: %+v", page)
	}
}

func TestDirectoryResultBudgetAndMetadata(t *testing.T) {
	entry := DirectoryEntry{Name: "a", Path: "/a", Size: 42, IsLink: true, Permission: "lrwxrwxrwx", ModifiedAt: "2026-01-02T03:04:05Z", LinkTarget: strings.Repeat("x", aitooloutput.StoredTextBytes/2)}
	second := entry
	second.Name = "b"
	page := decodeDirectoryPage(t, DirectoryResult("/", true, []DirectoryEntry{second, entry}, 0, 100))
	if len(page.Files) != 1 || !reflect.DeepEqual(page.Files[0], entry) || page.NextOffset == nil || *page.NextOffset != 1 {
		t.Fatal("budget did not stop at a whole entry or metadata changed")
	}
	entry.LinkTarget = strings.Repeat("x", aitooloutput.StoredTextBytes+1)
	page = decodeDirectoryPage(t, DirectoryResult("/", true, []DirectoryEntry{entry, second}, 0, 100))
	if len(page.Files) != 1 || page.NextOffset == nil || *page.NextOffset != 1 {
		t.Fatal("oversized entry did not make progress")
	}
}
