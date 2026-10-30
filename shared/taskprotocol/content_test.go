package taskprotocol

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func TestTaskOverviewDeclaresPreviewsWithoutChangingSource(t *testing.T) {
	run := protocol.TaskRun{ID: uuid.New(), Title: strings.Repeat("界", 300), ErrorMessage: strings.Repeat("failure\x00", 200)}
	view := RunOverview(run)
	if !ValidOverviewText(view) || !utf8.ValidString(view.Title) || len(view.TruncatedFields) != 2 {
		t.Fatal("invalid preview", view)
	}
	if len(run.Title) != 900 || !strings.ContainsRune(run.ErrorMessage, 0) {
		t.Fatal("preview modified original metadata")
	}
}

func TestContentRequiresInlineDataOrCommittedReference(t *testing.T) {
	body := protocol.TaskBody{TaskRunID: uuid.New(), ResultJSON: `{"output":"small"}`}
	descriptor, err := DescribeContent(body)
	if err != nil || ValidateContent(descriptor) != nil || len(descriptor.Data) == 0 {
		t.Fatal("small body not inlined", err)
	}
	bad := descriptor
	bad.Bytes++
	if ValidateContent(bad) == nil {
		t.Fatal("wrong size accepted")
	}
	body.ResultJSON = strings.Repeat("output", 10000)
	if _, err := DescribeContent(body); err == nil {
		t.Fatal("unpersisted large body described")
	}
	ref := protocol.ContentReference{ID: uuid.New(), MediaType: "application/json", Size: 100000, Sha256: strings.Repeat("a", 64)}
	descriptor = protocol.TaskContent{Bytes: int(ref.Size), Hash: ref.Sha256, Content: &ref}
	if ValidateContent(descriptor) != nil {
		t.Fatal("valid reference rejected")
	}
	descriptor.Data = []byte(`{}`)
	if ValidateContent(descriptor) == nil {
		t.Fatal("duplicate inline and file body accepted")
	}
	descriptor.Data = nil
	descriptor.Content = nil
	if ValidateContent(descriptor) == nil {
		t.Fatal("unreadable large body accepted")
	}
	descriptor.Content = &ref
	descriptor.Hash = strings.Repeat("b", 64)
	if ValidateContent(descriptor) == nil {
		t.Fatal("mismatched reference accepted")
	}
}
