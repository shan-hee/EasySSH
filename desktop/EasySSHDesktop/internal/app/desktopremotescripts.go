package app

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/easyssh/shared/scriptutil"
	"github.com/google/uuid"
)

func validRemoteScriptVersion(value string) bool {
	if len(value) != 64 || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
func (session *desktopRemoteSession) availableRemoteScripts(ctx context.Context, serverID string, input protocol.ScriptCatalogInput) (*protocol.ScriptCatalogPage, error) {
	if _, err := remoteTaskID(serverID); err != nil {
		return nil, remoteError("invalid_server_id")
	}
	input, err := scriptutil.NormalizeCatalogInput(input)
	if err != nil {
		return nil, remoteError("invalid_script_query")
	}
	var result protocol.ScriptCatalogPage
	query := url.Values{"server_id": {serverID}, "limit": {strconv.Itoa(input.Limit)}}
	if input.AfterID != "" {
		query.Set("after_id", input.AfterID)
	}
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/scripts/available", query, nil, &result, ""); err != nil {
		return nil, err
	}
	if result.ServerID != serverID || len(result.Items) > input.Limit {
		return nil, remoteError("invalid_remote_response")
	}
	if _, err := scriptutil.NormalizeCatalogInput(protocol.ScriptCatalogInput{AfterID: result.NextAfterID}); err != nil {
		return nil, remoteError("invalid_remote_response")
	}
	if result.NextAfterID < input.AfterID || result.HasMore && result.NextAfterID <= input.AfterID {
		return nil, remoteError("invalid_remote_response")
	}
	previous := input.AfterID
	for _, row := range result.Items {
		id := row.ID.String()
		if row.ID == uuid.Nil || id <= previous || id > result.NextAfterID || !validRemoteScriptVersion(row.Version) || !remoteTaskText(row.Name, 512) || !remoteTaskText(row.Description, 16384) {
			return nil, remoteError("invalid_remote_response")
		}
		if _, err := scriptutil.Interpreter(row.Language); err != nil {
			return nil, remoteError("invalid_remote_response")
		}
		if err := scriptutil.ValidateParameterRules(row.Parameters); err != nil {
			return nil, remoteError("invalid_remote_response")
		}
		previous = id
	}
	encoded, err := json.Marshal(result)
	if err != nil || len(encoded) > scriptutil.MaxCatalogBytes {
		return nil, remoteError("invalid_remote_response")
	}
	if result.Items == nil {
		result.Items = []protocol.AvailableScript{}
	}
	return &result, nil
}

func (s *DesktopRemoteWorkspaceService) AvailableRemoteScripts(ctx context.Context, serverID string, input protocol.ScriptCatalogInput) (*protocol.ScriptCatalogPage, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return nil, err
	}
	defer done()
	return session.availableRemoteScripts(ctx, serverID, input)
}
func (session *desktopRemoteSession) executeRemoteScript(ctx context.Context, id string, input protocol.ScriptExecuteInput) (protocol.ScriptAccepted, error) {
	if _, err := remoteTaskID(id); err != nil {
		return protocol.ScriptAccepted{}, remoteError("invalid_script_id")
	}
	if !validRemoteScriptVersion(input.Version) || len(input.ServerIDs) == 0 || len(input.ServerIDs) > 100 {
		return protocol.ScriptAccepted{}, remoteError("invalid_script_execution")
	}
	if input.ExecutionMode == "" {
		input.ExecutionMode = "parallel"
	}
	if input.ExecutionMode != "parallel" && input.ExecutionMode != "sequential" {
		return protocol.ScriptAccepted{}, remoteError("invalid_script_execution")
	}
	seen := map[string]bool{}
	for _, serverID := range input.ServerIDs {
		if _, err := remoteTaskID(serverID); err != nil || seen[serverID] {
			return protocol.ScriptAccepted{}, remoteError("invalid_script_execution")
		}
		seen[serverID] = true
	}
	if err := scriptutil.ValidateParameters(input.Parameters); err != nil {
		return protocol.ScriptAccepted{}, remoteError("invalid_script_parameters")
	}
	// JSON escaping can expand otherwise valid parameter values beyond the
	// source endpoint's body limit; reject before attempting any execution.
	encoded, err := json.Marshal(input)
	if err != nil || len(encoded) > scriptutil.MaxExecuteBytes {
		return protocol.ScriptAccepted{}, remoteError("invalid_script_parameters")
	}
	var result protocol.ScriptAccepted
	if err := session.requestRecord(ctx, http.MethodPost, "/api/v1/scripts/"+id+"/execute", nil, input, &result, "script_execution_outcome_unknown"); err != nil {
		return protocol.ScriptAccepted{}, err
	}
	if result.TaskID == uuid.Nil || result.BatchTaskID != result.TaskID || result.Status != "queued" {
		return protocol.ScriptAccepted{}, remoteError("script_execution_outcome_unknown")
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) ExecuteRemoteScript(ctx context.Context, id string, input protocol.ScriptExecuteInput) (protocol.ScriptAccepted, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.ScriptAccepted{}, err
	}
	defer done()
	return session.executeRemoteScript(ctx, id, input)
}
