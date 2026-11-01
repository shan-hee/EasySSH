package app

import (
	"context"
	"strings"
	"testing"
)

func TestDesktopExternalContextIsDataAndSurvivesStorage(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.PermissionMode = DesktopAIPermissionPrivileged
	record.Messages[0].ExternalContent = true
	const external = "REMOTE_CONTEXT_INSTRUCTION"
	modelMessages := desktopAIProviderMessages(record, external)
	for _, message := range modelMessages {
		if message.Role == "system" && strings.Contains(message.Content, external) {
			t.Fatal("external context became system policy")
		}
	}
	last := modelMessages[len(modelMessages)-1]
	if last.Role != "user" || !strings.Contains(last.Content, external) || record.Messages[0].Content != "question" {
		t.Fatal("external data was lost or merged into the authored user message")
	}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	restored, err := ai.loadSession(record.ID)
	if err != nil || !desktopAIHasExternalContent(restored) || restored.PermissionMode != DesktopAIPermissionPrivileged {
		t.Fatalf("restored context lost its provenance or changed the selected mode: %+v %v", restored, err)
	}
	spec := desktopAIToolSpec{ConfirmStrategy: desktopAIConfirmUser}
	// Privileged mode never asks, even after external content.
	if desktopAIRequiresConfirmation(restored.PermissionMode, spec) {
		t.Fatal("privileged mode required confirmation")
	}
	if !desktopAIRequiresConfirmation(DesktopAIPermissionBalanced, spec) {
		t.Fatal("balanced mode skipped ordinary confirmation")
	}
	if desktopAIRequiresConfirmation(DesktopAIPermissionBalanced, desktopAIToolSpec{}) {
		t.Fatal("read-only tools unnecessarily required execution confirmation")
	}
	mkdir := desktopAIToolSpec{Name: "create_directory", ConfirmStrategy: desktopAIConfirmNone}
	if desktopAIRequiresConfirmation(DesktopAIPermissionBalanced, mkdir) || desktopAIRequiresConfirmation(DesktopAIPermissionPrivileged, mkdir) {
		t.Fatal("directory creation required confirmation despite its tool strategy")
	}
}

func TestDesktopToolOutputAndDerivedMessagesRetainExternalProvenance(t *testing.T) {
	record := desktopAISessionRecord{Tasks: []DesktopAITaskView{{ID: "read", Result: "remote file instructions"}}}
	if !desktopAIHasExternalContent(record) {
		t.Fatal("tool output was treated as owner intent")
	}
	record.Messages = []DesktopAIMessageView{{ID: "reply", Role: "assistant", Content: "derived recommendation", ExternalContent: desktopAIHasExternalContent(record)}}
	record.Tasks = nil
	roundTrip := fromAichatUIMessages(toAichatUIMessages(record.Messages))
	if len(roundTrip) != 1 || !roundTrip[0].ExternalContent || !desktopAIHasExternalContent(desktopAISessionRecord{Messages: roundTrip}) {
		t.Fatal("public history conversion stripped derived-text provenance")
	}
}
