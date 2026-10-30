package app

import (
	"context"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/easyssh/shared/activitystats"
	"github.com/google/uuid"
)

func remoteActivityQuery(input activitystats.Request) (url.Values, activitystats.Request, error) {
	if input.Page < 0 || input.Page > 1000000 || input.PageSize < 0 || input.PageSize > 100 || !remoteText(input.Timezone, 128) || !remoteText(input.StartDate, 10) || !remoteText(input.EndDate, 10) {
		return nil, input, remoteError("invalid_activity_query")
	}
	var err error
	input, err = activitystats.Normalize(input)
	if err != nil {
		return nil, input, remoteError("invalid_activity_query")
	}
	if _, _, _, err = activitystats.Window(input, time.Now().UTC()); err != nil {
		return nil, input, remoteError("invalid_activity_window")
	}
	if input.ServerID != "" {
		if _, err = remoteTaskID(input.ServerID); err != nil {
			return nil, input, remoteError("invalid_server_id")
		}
	}
	q := url.Values{"page": {strconv.Itoa(input.Page)}, "page_size": {strconv.Itoa(input.PageSize)}}
	for key, value := range map[string]string{"timezone": input.Timezone, "range": input.Range, "start_date": input.StartDate, "end_date": input.EndDate, "server_id": input.ServerID, "source": input.Source, "type": string(input.Type), "status": string(input.Status), "history": input.History, "view": input.View} {
		if value != "" {
			q.Set(key, value)
		}
	}
	return q, input, nil
}

func (session *desktopRemoteSession) validActivitySummary(r protocol.ActivitySummary) bool {
	if r.ID == uuid.Nil || r.WorkID == uuid.Nil || !session.validTaskActor(r.Actor) || r.Category != "activity" || r.Source != "share" || r.Attempt < 1 || r.CreatedAt.IsZero() || r.UpdatedAt.IsZero() || r.WorkStartedAt.IsZero() || r.Type == "" || r.Status == "" {
		return false
	}
	if _, err := activitystats.Normalize(activitystats.Request{Type: r.Type, Status: r.Status, Source: r.Source}); err != nil {
		return false
	}
	if r.ServerID != nil && *r.ServerID == uuid.Nil || r.ParentWorkID != nil && (*r.ParentWorkID == uuid.Nil || *r.ParentWorkID == r.WorkID) {
		return false
	}
	if r.Progress < 0 || r.Progress > 100 || r.TotalCount < 0 || r.SuccessCount < 0 || r.FailureCount < 0 || r.DurationMs < 0 || r.BytesTotal < 0 || r.BytesProcessed < 0 || r.BytesCompleted < 0 || r.SpeedBps < 0 {
		return false
	}
	return remoteTaskText(r.Title, 4096) && remoteTaskText(r.Resource, 65536) && remoteTaskText(r.ErrorMessage, 65536) && remoteTaskText(r.ServerName, 512) && remoteText(r.Action, 128) && remoteText(r.SourceTable, 128) && remoteText(r.SourceID, 256)
}
func validActivityResources(resources []protocol.ActivityResourceSnapshot) bool {
	if len(resources) > 10000 {
		return false
	}
	seen := make(map[uuid.UUID]bool, len(resources))
	for _, resource := range resources {
		if resource.ServerID == uuid.Nil || seen[resource.ServerID] || !remoteTaskText(resource.Name, 512) {
			return false
		}
		seen[resource.ServerID] = true
	}
	return true
}
func validActivityMetrics(m activitystats.WorkMetrics) bool {
	for _, n := range []int64{m.EverFailed, m.Recovered, m.UnresolvedFailures, m.Active, m.Works, m.Attempts, m.Retries, m.Connections, m.ConnectionFailures, m.Executions, m.Transfers, m.SuccessfulFiles, m.CompletedBytes, m.AttemptBytes, m.ConfigurationChanges, m.Servers} {
		if n < 0 {
			return false
		}
	}
	for kind, n := range m.ByType {
		if _, err := activitystats.Normalize(activitystats.Request{Type: kind}); err != nil || n < 0 || kind == "" {
			return false
		}
	}
	for status, n := range m.ByStatus {
		if _, err := activitystats.Normalize(activitystats.Request{Status: status}); err != nil || n < 0 || status == "" {
			return false
		}
	}
	for source, n := range m.BySource {
		if source != "share" || n < 0 {
			return false
		}
	}
	return true
}
func validActivityResults(r activitystats.ResultEvents) bool {
	for _, n := range []int64{r.Unknown, r.CompletedTransfers, r.SuccessfulFiles, r.CompletedBytes, r.Completed, r.Failed, r.Partial, r.Canceled} {
		if n < 0 {
			return false
		}
	}
	return true
}

func (session *desktopRemoteSession) remoteActivityOverview(ctx context.Context, input activitystats.Request) (protocol.ActivityOverview, error) {
	q, input, err := remoteActivityQuery(input)
	if err != nil {
		return protocol.ActivityOverview{}, err
	}
	var result protocol.ActivityOverview
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/operation-records/overview", q, nil, &result, ""); err != nil {
		return protocol.ActivityOverview{}, err
	}
	if !session.validActivityOverview(result, input) {
		return protocol.ActivityOverview{}, remoteError("invalid_remote_response")
	}
	return result, nil
}
func (session *desktopRemoteSession) validActivityOverview(r protocol.ActivityOverview, input activitystats.Request) bool {
	if r.AsOf.IsZero() || r.MetricVersion != activitystats.MetricVersion || r.Page != input.Page || r.PageSize != input.PageSize || r.Total < 0 || len(r.Records) > input.PageSize || len(r.Records) > r.Total || r.CarryOver < 0 || r.ConnectionDurationMs < 0 || len(r.Servers) > 10000 || len(r.Timeline) > 9000 {
		return false
	}
	// The source clock defines "today"; the native host must not recompute metrics.
	start, end, zone, err := activitystats.Window(input, r.AsOf)
	if err != nil || !r.Start.Equal(start) || !r.End.Equal(end) || r.Timezone != zone.String() {
		return false
	}
	if !validActivityMetrics(r.Volume) || !validActivityMetrics(r.Targets) || !validActivityResults(r.ResultEvents) || !validActivityResults(r.TargetResultEvents) {
		return false
	}
	seen := map[uuid.UUID]bool{}
	for _, record := range r.Records {
		if !session.validActivitySummary(record.Summary()) || seen[record.ID] || record.ObservedAttempts < 1 || !validActivityResources(record.Resources) {
			return false
		}
		seen[record.ID] = true
	}
	servers := map[string]bool{}
	for _, server := range r.Servers {
		if _, err := remoteTaskID(server.ServerID); err != nil || servers[server.ServerID] || server.Works < 0 || !remoteTaskText(server.Name, 512) {
			return false
		}
		servers[server.ServerID] = true
	}
	var previous time.Time
	for _, bucket := range r.Timeline {
		if !bucket.End.After(bucket.Start) || bucket.Start.Before(r.Start) || bucket.End.After(r.End) || !previous.IsZero() && bucket.Start.Before(previous) || bucket.Start.After(r.AsOf) || bucket.Start.In(zone).Format("2006-01-02T15:04:05Z07:00") != bucket.Label || bucket.Started < 0 || bucket.Established < 0 || !validActivityResults(bucket.Results) {
			return false
		}
		previous = bucket.End
	}
	return true
}
func (s *DesktopRemoteWorkspaceService) RemoteActivityOverview(ctx context.Context, input activitystats.Request) (protocol.ActivityOverview, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.ActivityOverview{}, err
	}
	defer done()
	return session.remoteActivityOverview(ctx, input)
}

func (session *desktopRemoteSession) getRemoteActivity(ctx context.Context, id string) (protocol.ActivityRecord, error) {
	parsed, err := remoteTaskID(id)
	if err != nil {
		return protocol.ActivityRecord{}, remoteError("invalid_activity_id")
	}
	var result protocol.ActivityRecord
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/operation-records/"+id, nil, nil, &result, ""); err != nil {
		return protocol.ActivityRecord{}, err
	}
	if result.ID != parsed || !session.validActivitySummary(result.Summary()) || !validActivityResources(result.Resources) {
		return protocol.ActivityRecord{}, remoteError("invalid_remote_response")
	}
	if ref := result.TaskContent; ref != nil {
		if contentstore.ValidateReference(*ref) != nil || ref.MediaType != "application/json" || result.SourceTable != "task_runs" || !validRemoteUUID(result.SourceID) || result.DetailJSON != "" || result.DetailContent != nil {
			return protocol.ActivityRecord{}, remoteError("invalid_remote_response")
		}
	}
	if ref := result.DetailContent; ref != nil {
		if contentstore.ValidateReference(*ref) != nil || ref.MediaType != "text/plain; charset=utf-8" || result.DetailJSON != "" || result.TaskContent != nil {
			return protocol.ActivityRecord{}, remoteError("invalid_remote_response")
		}
	}
	return result, nil
}
func (s *DesktopRemoteWorkspaceService) GetRemoteActivity(ctx context.Context, id string) (protocol.ActivityRecord, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.ActivityRecord{}, err
	}
	defer done()
	return session.getRemoteActivity(ctx, id)
}
