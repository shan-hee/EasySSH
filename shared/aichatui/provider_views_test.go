package aichatui

import (
	"reflect"
	"testing"

	"github.com/easyssh/shared/aiprovider"
)

func TestAttachmentViews(t *testing.T) {
	for _, tt := range []struct {
		name  string
		input []aiprovider.Attachment
		want  []AttachmentView
	}{
		{name: "nil", want: []AttachmentView{}},
		{name: "empty", input: []aiprovider.Attachment{}, want: []AttachmentView{}},
		{name: "all fields and order", input: []aiprovider.Attachment{{ID: "a", Name: "image.png", MediaType: "image/png", Data: "data", Size: 12}, {ID: "b"}}, want: []AttachmentView{{ID: "a", Name: "image.png", MediaType: "image/png", Data: "data", Size: 12}, {ID: "b"}}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := AttachmentViews(tt.input)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %#v", got)
			}
			if len(got) > 0 {
				got[0].Name = "changed"
				if tt.input[0].Name == "changed" {
					t.Fatal("aliased input")
				}
			}
		})
	}
}

func TestUsageFromProvider(t *testing.T) {
	for _, tt := range []struct {
		name  string
		input *aiprovider.Usage
		want  *UsageView
	}{
		{name: "nil desktop value"},
		{name: "zero server value", input: &aiprovider.Usage{}, want: &UsageView{}},
		{name: "all fields", input: &aiprovider.Usage{InputTokens: 1, OutputTokens: 2, CachedTokens: 3, CacheWriteTokens: 4, ReasoningTokens: 5, TotalTokens: 6}, want: &UsageView{InputTokens: 1, OutputTokens: 2, CachedTokens: 3, CacheWriteTokens: 4, ReasoningTokens: 5, TotalTokens: 6}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := UsageFromProvider(tt.input)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v", got)
			}
			if got != nil {
				got.InputTokens = 100
				if tt.input.InputTokens == 100 {
					t.Fatal("aliased input")
				}
			}
		})
	}
}

func TestMetadataFromProvider(t *testing.T) {
	for _, tt := range []struct {
		name  string
		input *aiprovider.ProviderMetadata
		want  *ProviderMetadata
	}{
		{name: "nil desktop value"},
		{name: "zero server value", input: &aiprovider.ProviderMetadata{}, want: &ProviderMetadata{}},
		{name: "all fields", input: &aiprovider.ProviderMetadata{Provider: "provider", API: "api", Endpoint: "endpoint", RequestID: "request", ResponseID: "response", Model: "model", FinishReason: "stop", ServiceTier: "tier", EstimatedCostMicros: 12, CostEstimateKind: "estimate"}, want: &ProviderMetadata{Provider: "provider", API: "api", Endpoint: "endpoint", RequestID: "request", ResponseID: "response", Model: "model", FinishReason: "stop", ServiceTier: "tier", EstimatedCostMicros: 12, CostEstimateKind: "estimate"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := MetadataFromProvider(tt.input)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v", got)
			}
			if got != nil {
				got.Model = "changed"
				if tt.input.Model == "changed" {
					t.Fatal("aliased input")
				}
			}
		})
	}
}

func TestLatestServerReferences(t *testing.T) {
	for _, tt := range []struct {
		name     string
		messages []MessageView
		want     []ServerReference
	}{
		{name: "empty"},
		{name: "assistant is not a source", messages: []MessageView{{Role: "assistant", ServerReferences: []ServerReference{{ServerID: "wrong"}}}}},
		{name: "latest user", messages: []MessageView{{Role: "user", ServerReferences: []ServerReference{{ServerID: "old"}}}, {Role: "user", ServerReferences: []ServerReference{{ServerID: "a"}, {ServerID: "b"}}}, {Role: "assistant", ServerReferences: []ServerReference{{ServerID: "wrong"}}}}, want: []ServerReference{{ServerID: "a"}, {ServerID: "b"}}},
		{name: "do not reuse older references", messages: []MessageView{{Role: "user", ServerReferences: []ServerReference{{ServerID: "old"}}}, {Role: "user"}}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := LatestServerReferences(tt.messages); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v", got)
			}
		})
	}
}
