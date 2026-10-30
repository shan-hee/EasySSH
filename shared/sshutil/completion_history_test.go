package sshutil

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestCompletionOutputLimitCancelsWithoutGrowingBuffer(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	buffer := &completionBuffer{limit: 4, cancel: cancel}
	if _, err := buffer.Write([]byte("abcd")); err != nil {
		t.Fatal(err)
	}
	if _, err := buffer.Write([]byte("e")); !errors.Is(err, errCompletionOutputLimit) {
		t.Fatalf("overflow: %v", err)
	}
	if ctx.Err() == nil || buffer.data.Len() != 4 {
		t.Fatal("unbounded completion output")
	}
}

func TestCompletionHistoryRejectsOversizedLine(t *testing.T) {
	if _, err := parseCompletionHistory(shellBash, strings.Repeat("x", 9000)); err == nil {
		t.Fatal("silently accepted truncated history")
	}
	lines, err := parseCompletionHistory(shellZsh, ": 123:0;ls\n: 124:0;pwd\n: 125:0;ls\n")
	if err != nil {
		t.Fatal(err)
	}
	got := deduplicateNewestFirst(lines)
	if len(got) != 2 || got[0] != "ls" || got[1] != "pwd" {
		t.Fatalf("history order: %#v", got)
	}
}
