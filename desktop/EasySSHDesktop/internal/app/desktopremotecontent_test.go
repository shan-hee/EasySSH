package app

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func TestRemoteContentPinsSourceAndRejectsForeignRanges(t *testing.T) {
	store, err := contentstore.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	writer, err := store.Create(uuid.New(), "text/plain")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte(strings.Repeat("result", 1000))); err != nil {
		t.Fatal(err)
	}
	ref, err := writer.Finish()
	if err != nil {
		t.Fatal(err)
	}
	input := protocol.ContentReadInput{Sha256: ref.Sha256, Offset: 10, Limit: 128}
	chunk, err := store.Read(ref, input)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	session, _ := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodGet || r.URL.Host != "source.example" || r.Header.Get("Authorization") != "Access source-access-secret" || r.Header.Get("Cookie") != "" {
			t.Fatal("content escaped fixed source")
		}
		if r.URL.Path == "/api/v1/content/"+ref.ID.String() {
			return remoteTaskResponse(t, r, ref), nil
		}
		if r.URL.Path != "/api/v1/content/"+ref.ID.String()+"/bytes" || r.URL.Query().Get("sha256") != ref.Sha256 || r.URL.Query().Get("offset") != "10" {
			t.Fatal("incorrect range")
		}
		return remoteTaskResponse(t, r, chunk), nil
	})
	if _, err := session.remoteContent(context.Background(), ref.ID.String()); err != nil {
		t.Fatal(err)
	}
	if _, err := session.readRemoteContent(context.Background(), ref, input); err != nil {
		t.Fatal(err)
	}
	chunk.ID = uuid.New()
	if _, err := session.readRemoteContent(context.Background(), ref, input); err == nil {
		t.Fatal("foreign content accepted")
	}
	if _, err := session.remoteContent(context.Background(), "../owner"); err == nil || calls != 3 {
		t.Fatal("path traversal dispatched")
	}
	input.Limit = contentstore.MaxReadBytes + 1
	if _, err := session.readRemoteContent(context.Background(), ref, input); err == nil || calls != 3 {
		t.Fatal("unbounded range dispatched")
	}
}
