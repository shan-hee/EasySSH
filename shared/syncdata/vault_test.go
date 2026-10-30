package syncdata

import (
	"encoding/base64"
	"github.com/easyssh/shared/protocol"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/shared/aichatui"
)

func TestConversationAttachmentsRoundTripAndRejectSubstitution(t *testing.T) {
	data := base64.StdEncoding.EncodeToString([]byte("attachment content"))
	conversation := Conversation{Messages: []aichatui.MessageView{{ID: "message", Role: "user", Attachments: []aichatui.AttachmentView{{ID: "attachment", Data: data}}}}}
	objects := ExtractAttachments(&conversation)
	if len(objects) != 1 || conversation.Messages[0].Attachments[0].Data == data {
		t.Fatal("attachment was not detached")
	}
	if err := HydrateAttachments(&conversation, func(string) (string, error) { return base64.StdEncoding.EncodeToString([]byte("substituted")), nil }); err == nil {
		t.Fatal("accepted substituted attachment")
	}
	if err := HydrateAttachments(&conversation, func(id string) (string, error) { return objects[id], nil }); err != nil {
		t.Fatal(err)
	}
	attachment := conversation.Messages[0].Attachments[0]
	if attachment.Data != data || attachment.Size != int64(len("attachment content")) {
		t.Fatal("attachment round trip changed content or size")
	}
}

func TestVaultProvenanceDoesNotCreateVersionsOrLeakSecrets(t *testing.T) {
	a := VaultPayload{Kind: "ai_config", Source: "desktop", UpdatedAt: time.Now(), AIConfig: &protocol.AIConfigValue{Provider: "openai", APIKey: "private-api-key"}}
	b := a
	b.Source = "server"
	b.UpdatedAt = b.UpdatedAt.Add(time.Hour)
	if !SameVaultValue(JSON(a), JSON(b)) {
		t.Fatal("metadata-only update created a value change")
	}
	summary := Summarize(a)
	if !summary.HasAPIKey || strings.Contains(JSON(summary), a.AIConfig.APIKey) {
		t.Fatal("unsafe conflict preview")
	}
	b.AIConfig = &protocol.AIConfigValue{Provider: "openai", APIKey: "changed-key"}
	if SameVaultValue(JSON(a), JSON(b)) {
		t.Fatal("actual credential edit ignored")
	}
}

func TestConversationSyncKeepsUnknownAndDoesNotPretendRunningWorkWasCanceled(t *testing.T) {
	c := Conversation{Tasks: []aichatui.TaskView{
		{Status: aichatui.TaskStatusUnknown, Result: "unconfirmed effect"},
		{Status: aichatui.TaskStatusRunning},
		{Status: aichatui.TaskStatusQueued},
		{Status: aichatui.TaskStatusSucceeded, Result: "confirmed effect"},
	}}
	NormalizeConversation(&c)
	NormalizeConversation(&c)
	if c.Tasks[0].Status != aichatui.TaskStatusUnknown || c.Tasks[0].Result != "unconfirmed effect" || c.Tasks[1].Status != aichatui.TaskStatusUnknown || c.Tasks[2].Status != aichatui.TaskStatusCancelled || c.Tasks[3].Status != aichatui.TaskStatusSucceeded {
		t.Fatalf("sync changed execution facts: %+v", c.Tasks)
	}
}

func TestDecodeVaultBoundsPlaintextBeforeJSONParsing(t *testing.T) {
	if _, err := DecodeVault(strings.Repeat(" ", MaxVaultPayloadBytes+1), "ai_session"); err != ErrVaultPayloadTooLarge {
		t.Fatalf("plaintext not bounded before parsing: %v", err)
	}
	value := `{"kind":"ai_session","deleted":true}`
	value += strings.Repeat(" ", MaxVaultPayloadBytes-len(value))
	if _, err := DecodeVault(value, "ai_session"); err != nil {
		t.Fatalf("exact plaintext boundary rejected: %v", err)
	}
}
