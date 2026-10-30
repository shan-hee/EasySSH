package aichatui

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSessionIndexContainsVisibleTextOnlyNewestFirst(t *testing.T) {
	messages := []MessageView{{Role: "user", Content: "older text", Attachments: []AttachmentView{{Name: "private-attachment", Data: "private-binary"}}}, {Role: "tool", Content: "private-tool-output"}, {Role: "assistant", Content: " Latest\n ÄBC 100%_! "}}
	index := BuildSessionSearchIndex(messages)
	if index.Text != "Latest ÄBC 100%_!\n\nolder text" || index.Folded != "latest äbc 100%_!\n\nolder text" || index.Preview != "Latest ÄBC 100%_!" {
		t.Fatalf("index: %+v", index)
	}
	if strings.Contains(index.Text, "private") {
		t.Fatal("non-visible content entered index")
	}
	if SessionSearchPattern(" %_! ") != "%!%!_!!%" {
		t.Fatal("search wildcards were not escaped")
	}
}
func TestSessionPreviewIsBoundedWithoutBreakingUnicode(t *testing.T) {
	index := BuildSessionSearchIndex([]MessageView{{Role: "assistant", Content: strings.Repeat("中", 1000)}})
	if !utf8.ValidString(index.Preview) || utf8.RuneCountInString(index.Preview) > 182 {
		t.Fatal("unbounded preview")
	}
	if len(index.Text) != 3000 {
		t.Fatal("search index silently truncated history")
	}
}
