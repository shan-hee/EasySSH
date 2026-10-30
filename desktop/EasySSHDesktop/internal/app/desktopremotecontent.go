package app

import (
	"context"
	"net/http"
	"net/url"
	"strconv"

	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
)

func (s *DesktopRemoteWorkspaceService) GetRemoteContent(ctx context.Context, id string) (protocol.ContentReference, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.ContentReference{}, err
	}
	defer done()
	return session.remoteContent(ctx, id)
}

func (session *desktopRemoteSession) remoteContent(ctx context.Context, id string) (protocol.ContentReference, error) {
	var ref protocol.ContentReference
	if !validRemoteUUID(id) {
		return ref, remoteError("invalid_content_range")
	}
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/content/"+id, nil, nil, &ref, ""); err != nil {
		return ref, err
	}
	if ref.ID.String() != id || contentstore.ValidateReference(ref) != nil {
		return protocol.ContentReference{}, remoteError("invalid_remote_response")
	}
	return ref, nil
}

func (s *DesktopRemoteWorkspaceService) ReadRemoteContent(ctx context.Context, ref protocol.ContentReference, input protocol.ContentReadInput) (protocol.ContentChunk, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.ContentChunk{}, err
	}
	defer done()
	return session.readRemoteContent(ctx, ref, input)
}

func (session *desktopRemoteSession) readRemoteContent(ctx context.Context, ref protocol.ContentReference, input protocol.ContentReadInput) (protocol.ContentChunk, error) {
	input, err := contentstore.Normalize(input)
	if err != nil || contentstore.ValidateReference(ref) != nil || input.Sha256 != ref.Sha256 || input.Offset > ref.Size {
		return protocol.ContentChunk{}, remoteError("invalid_content_range")
	}
	query := url.Values{"sha256": {input.Sha256}, "offset": {strconv.FormatInt(input.Offset, 10)}, "limit": {strconv.Itoa(input.Limit)}}
	var chunk protocol.ContentChunk
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/content/"+ref.ID.String()+"/bytes", query, nil, &chunk, ""); err != nil {
		return protocol.ContentChunk{}, err
	}
	if contentstore.ValidateChunk(ref, input, chunk) != nil {
		return protocol.ContentChunk{}, remoteError("invalid_remote_response")
	}
	return chunk, nil
}
