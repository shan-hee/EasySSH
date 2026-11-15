package aichatui

import "github.com/easyssh/shared/aiprovider"

func AttachmentViews(attachments []aiprovider.Attachment) []AttachmentView {
	result := make([]AttachmentView, 0, len(attachments))
	for _, attachment := range attachments {
		result = append(result, AttachmentView{ID: attachment.ID, Name: attachment.Name, MediaType: attachment.MediaType, Data: attachment.Data, Size: attachment.Size})
	}
	return result
}

func UsageFromProvider(usage *aiprovider.Usage) *UsageView {
	if usage == nil {
		return nil
	}
	result := UsageView(*usage)
	return &result
}

func MetadataFromProvider(metadata *aiprovider.ProviderMetadata) *ProviderMetadata {
	if metadata == nil {
		return nil
	}
	result := ProviderMetadata(*metadata)
	return &result
}

// LatestServerReferences uses only the most recent user message, even if empty.
func LatestServerReferences(messages []MessageView) []ServerReference {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return messages[i].ServerReferences
		}
	}
	return nil
}
