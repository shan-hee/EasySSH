package app

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"strconv"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/easyssh/shared/dockerutil"
)

func (s *DesktopRemoteWorkspaceService) dockerRequest(ctx context.Context, connectionID, method, operation string, query url.Values, output any, mutation bool) (string, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return "", err
	}
	defer done()
	if err = session.beginOpening(); err != nil {
		return "", err
	}
	defer session.opening.Done()
	return session.requestDocker(ctx, connectionID, method, operation, query, output, mutation)
}

// The native window supplies the workspace; a registered Docker connection
// supplies the server. No renderer argument can select an origin or an API path.
func (session *desktopRemoteSession) requestDocker(ctx context.Context, connectionID, method, operation string, query url.Values, output any, mutation bool) (string, error) {
	if !protocol.ValidConnectionID(connectionID) {
		return "", remoteError("invalid_connection_id")
	}
	connection, err := session.connection(connectionID)
	if err != nil {
		return "", err
	}
	if connection.Mode != protocol.DockerConnection {
		return "", remoteError("invalid_connection_mode")
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	var attempted atomic.Bool
	if mutation {
		ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { attempted.Store(true) }})
	}
	err = session.client.requestWithOptions(ctx, method, "/api/v1/docker/"+connection.ServerID+"/"+operation, nil, output, true, desktopRemoteRequestOptions{query: query, connectionID: connection.ID, responseLimit: int(dockerutil.MaxResponseBytes), timeout: 60 * time.Second})
	if isRemoteAccessEnded(err) {
		session.cancel()
	}
	if err != nil && (err.Error() == "connection_unavailable" || err.Error() == "resource_paused") {
		session.dropConnection(connectionID)
	}
	// A lost result is not a rejection. Never automatically repeat a management
	// request; source task/activity remains authoritative if its ID was not received.
	if err != nil && mutation && attempted.Load() && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || err.Error() == "remote_unavailable" || err.Error() == "invalid_remote_response" || err.Error() == "remote_request_failed" || err.Error() == "remote_redirect_rejected") {
		return connection.ServerID, remoteError("docker_outcome_unknown")
	}
	return connection.ServerID, err
}

func (s *DesktopRemoteWorkspaceService) ListDockerContainers(ctx context.Context, connectionID string, all bool) (dockerutil.ContainersResult, error) {
	var result dockerutil.ContainersResult
	_, err := s.dockerRequest(ctx, connectionID, http.MethodGet, "containers", url.Values{"all": {strconv.FormatBool(all)}}, &result, false)
	if err != nil {
		return dockerutil.ContainersResult{}, err
	}
	if result.Total != len(result.Data) || result.Total > dockerutil.MaxListItems {
		return dockerutil.ContainersResult{}, remoteError("invalid_remote_response")
	}
	seen := make(map[string]bool, len(result.Data))
	for _, item := range result.Data {
		if !dockerutil.ValidateContainerRef(item.ID) || seen[item.ID] {
			return dockerutil.ContainersResult{}, remoteError("invalid_remote_response")
		}
		seen[item.ID] = true
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) ListDockerImages(ctx context.Context, connectionID string) (dockerutil.ImagesResult, error) {
	var result dockerutil.ImagesResult
	_, err := s.dockerRequest(ctx, connectionID, http.MethodGet, "images", nil, &result, false)
	if err != nil {
		return dockerutil.ImagesResult{}, err
	}
	if result.Total != len(result.Data) || result.Total > dockerutil.MaxListItems {
		return dockerutil.ImagesResult{}, remoteError("invalid_remote_response")
	}
	for _, item := range result.Data {
		if !remoteText(item.ID, 255) || item.ID == "" || item.Size < 0 || item.VirtualSize < 0 {
			return dockerutil.ImagesResult{}, remoteError("invalid_remote_response")
		}
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) DockerSystemInfo(ctx context.Context, connectionID string) (dockerutil.SystemInfo, error) {
	var response protocol.DockerSystemResult
	_, err := s.dockerRequest(ctx, connectionID, http.MethodGet, "system", nil, &response, false)
	if err != nil {
		return dockerutil.SystemInfo{}, err
	}
	if !validRemoteDockerSystem(response.Data) {
		return dockerutil.SystemInfo{}, remoteError("invalid_remote_response")
	}
	return *response.Data, nil
}
func validRemoteDockerSystem(value *dockerutil.SystemInfo) bool {
	return value != nil && value.ContainersRunning >= 0 && value.ContainersPaused >= 0 && value.ContainersStopped >= 0 && value.ContainersTotal >= 0 && value.ImagesCount >= 0 && value.TotalMemory >= 0 && value.CPUs >= 0
}
func validRemoteDockerStat(value dockerutil.ContainerStats) bool {
	return dockerutil.ValidateContainerRef(value.ContainerID) && value.CPUPercent >= 0 && value.MemoryUsage >= 0 && value.MemoryLimit >= 0 && value.MemoryPercent >= 0 && value.NetworkIn >= 0 && value.NetworkOut >= 0 && value.BlockRead >= 0 && value.BlockWrite >= 0 && value.PIDs >= 0
}
func validRemoteDockerStats(values []dockerutil.ContainerStats, total, limit int, truncated bool) bool {
	if limit < 1 || limit > dockerutil.MaxStatsLimit || len(values) > limit || total < len(values) || total > dockerutil.MaxListItems || truncated != (total > len(values)) {
		return false
	}
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		if !validRemoteDockerStat(value) || seen[value.ContainerID] {
			return false
		}
		seen[value.ContainerID] = true
	}
	return true
}
func (s *DesktopRemoteWorkspaceService) DockerStats(ctx context.Context, connectionID string) (dockerutil.StatsResult, error) {
	var result dockerutil.StatsResult
	_, err := s.dockerRequest(ctx, connectionID, http.MethodGet, "stats", nil, &result, false)
	if err != nil {
		return dockerutil.StatsResult{}, err
	}
	if result.Limit != dockerutil.MaxStatsLimit || !validRemoteDockerStats(result.Data, result.Total, result.Limit, result.Truncated) {
		return dockerutil.StatsResult{}, remoteError("invalid_remote_response")
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) DockerResources(ctx context.Context, connectionID string) (dockerutil.ResourcesResult, error) {
	var result dockerutil.ResourcesResult
	_, err := s.dockerRequest(ctx, connectionID, http.MethodGet, "resources", nil, &result, false)
	if err != nil {
		return dockerutil.ResourcesResult{}, err
	}
	if result.StatsLimit != dockerutil.DefaultResourceStatsLimit || !validRemoteDockerStats(result.Stats, result.RunningStatsTotal, result.StatsLimit, result.StatsTruncated) || result.DockerInstalled && !validRemoteDockerSystem(result.SystemInfo) || !result.DockerInstalled && (len(result.Stats) != 0 || result.SystemInfo != nil) {
		return dockerutil.ResourcesResult{}, remoteError("invalid_remote_response")
	}
	return result, nil
}
func remoteDockerContainerPath(containerID, suffix string) (string, string, error) {
	ref, err := dockerutil.NormalizeContainerRef(containerID)
	if err != nil {
		return "", "", remoteError("invalid_docker_reference")
	}
	return "containers/" + url.PathEscape(ref) + suffix, ref, nil
}
func (s *DesktopRemoteWorkspaceService) DockerContainerStats(ctx context.Context, connectionID, containerID string) (dockerutil.ContainerStats, error) {
	var result dockerutil.ContainerStats
	operation, _, err := remoteDockerContainerPath(containerID, "/stats")
	if err != nil {
		return result, err
	}
	_, err = s.dockerRequest(ctx, connectionID, http.MethodGet, operation, nil, &result, false)
	if err != nil {
		return dockerutil.ContainerStats{}, err
	}
	// Docker resolves a container name or short ID into a full ID.
	if !validRemoteDockerStat(result) {
		return dockerutil.ContainerStats{}, remoteError("invalid_remote_response")
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) DockerContainerLogs(ctx context.Context, connectionID, containerID string, tail int, encoding string) (dockerutil.LogsResult, error) {
	var result dockerutil.LogsResult
	operation, ref, err := remoteDockerContainerPath(containerID, "/logs")
	if err != nil {
		return result, err
	}
	if tail < 0 || tail > dockerutil.MaxLogTail {
		return result, remoteError("invalid_tail")
	}
	tail = dockerutil.NormalizeTail(tail)
	if encoding == "" {
		encoding = "utf-8"
	}
	if !remoteText(encoding, 64) {
		return result, remoteError("invalid_encoding")
	}
	_, err = s.dockerRequest(ctx, connectionID, http.MethodGet, operation, url.Values{"tail": {strconv.Itoa(tail)}, "encoding": {encoding}}, &result, false)
	if err != nil {
		return dockerutil.LogsResult{}, err
	}
	if result.ContainerID != ref || result.Lines != tail || result.Encoding != encoding || len(result.Data) > dockerutil.MaxLogBytes*3 || !utf8.ValidString(result.Data) {
		return dockerutil.LogsResult{}, remoteError("invalid_remote_response")
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) CheckDockerImageUpdate(ctx context.Context, connectionID, containerID string) (dockerutil.ImageUpdateResult, error) {
	var result dockerutil.ImageUpdateResult
	operation, _, err := remoteDockerContainerPath(containerID, "/check-update")
	if err != nil {
		return result, err
	}
	_, err = s.dockerRequest(ctx, connectionID, http.MethodGet, operation, nil, &result, false)
	if err != nil {
		return dockerutil.ImageUpdateResult{}, err
	}
	if !remoteText(result.ImageName, 1024) || !remoteText(result.ContainerName, 255) || !remoteText(result.UpdateCommand, 4096) || !remoteText(result.Error, 4096) {
		return dockerutil.ImageUpdateResult{}, remoteError("invalid_remote_response")
	}
	return result, nil
}

func validRemoteDockerAction(result protocol.DockerActionResult, serverID string) bool {
	if !validRemoteUUID(result.TaskID) || result.ServerID != serverID || !dockerutil.ValidateContainerRef(result.ContainerID) || !result.Action.Valid() || !remoteText(result.ErrorCode, 80) || len(result.ErrorMessage) > 4096 || !utf8.ValidString(result.ErrorMessage) {
		return false
	}
	switch result.Status {
	case "queued", "running", "succeeded", "failed", "unknown", "timeout", "canceled":
	default:
		return false
	}
	return result.Status != "succeeded" || result.ErrorCode == "" && result.ErrorMessage == ""
}
func (s *DesktopRemoteWorkspaceService) ApplyDockerAction(ctx context.Context, connectionID, containerID string, action protocol.DockerAction, force bool) (protocol.DockerActionResult, error) {
	var result protocol.DockerActionResult
	if !action.Valid() || force && action != protocol.DockerActionRemove {
		return result, remoteError("invalid_docker_action")
	}
	suffix := "/" + string(action)
	method := http.MethodPost
	var query url.Values
	if action == protocol.DockerActionRemove {
		suffix = ""
		method = http.MethodDelete
		query = url.Values{"force": {strconv.FormatBool(force)}}
	}
	operation, ref, err := remoteDockerContainerPath(containerID, suffix)
	if err != nil {
		return result, err
	}
	serverID, err := s.dockerRequest(ctx, connectionID, method, operation, query, &result, true)
	if err != nil {
		return protocol.DockerActionResult{}, err
	}
	if !validRemoteDockerAction(result, serverID) || result.ContainerID != ref || result.Action != action || result.Status == "queued" || result.Status == "running" {
		return protocol.DockerActionResult{}, remoteError("docker_outcome_unknown")
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) DockerActionResult(ctx context.Context, connectionID, taskID string) (protocol.DockerActionResult, error) {
	var result protocol.DockerActionResult
	if !validRemoteUUID(taskID) {
		return result, remoteError("invalid_task_id")
	}
	method, operation := http.MethodGet, "tasks/"+taskID
	serverID, err := s.dockerRequest(ctx, connectionID, method, operation, nil, &result, false)
	if err != nil {
		return protocol.DockerActionResult{}, err
	}
	if !validRemoteDockerAction(result, serverID) || result.TaskID != taskID {
		return protocol.DockerActionResult{}, remoteError("invalid_remote_response")
	}
	return result, nil
}
