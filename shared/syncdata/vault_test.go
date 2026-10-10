package syncdata

import (
	"encoding/base64"
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
	a := VaultPayload{Kind: "ai_config", Source: "desktop", UpdatedAt: time.Now(), AIConfig: &AIConfig{Provider: "openai", APIKey: "private-api-key"}}
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
	b.AIConfig = &AIConfig{Provider: "openai", APIKey: "changed-key"}
	if SameVaultValue(JSON(a), JSON(b)) {
		t.Fatal("actual credential edit ignored")
	}
}
