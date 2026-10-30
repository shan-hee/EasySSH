package app

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/easyssh/shared/activitystats"
)

type DesktopActivityOverviewRequest = activitystats.Request

type DesktopActivityWork struct {
	DesktopActivityLogItem
	ObservedAttempts int  `json:"observed_attempts"`
	EverFailed       bool `json:"ever_failed"`
	Recovered        bool `json:"recovered"`
}

type DesktopActivityOverview struct {
	ConnectionDurationIsLowerBound bool                               `json:"connection_duration_is_lower_bound"`
	MetricVersion                  string                             `json:"metric_version"`
	AsOf                           time.Time                          `json:"as_of"`
	Start                          time.Time                          `json:"start"`
	End                            time.Time                          `json:"end"`
	Timezone                       string                             `json:"timezone"`
	Coverage                       activitystats.OverviewCoverage     `json:"coverage"`
	Volume                         activitystats.WorkMetrics          `json:"volume"`
	Targets                        activitystats.WorkMetrics          `json:"targets"`
	ResultEvents                   activitystats.ResultEvents         `json:"result_events"`
	TargetResultEvents             activitystats.ResultEvents         `json:"target_result_events"`
	CarryOver                      int64                              `json:"carry_over"`
	ConnectionDurationMs           int64                              `json:"connection_duration_ms"`
	Servers                        []activitystats.ServerDistribution `json:"servers"`
	Timeline                       []activitystats.TimeBucket         `json:"timeline"`
	Records                        []DesktopActivityWork              `json:"records"`
	Total                          int                                `json:"total"`
	Page                           int                                `json:"page"`
	PageSize                       int                                `json:"page_size"`
}

func (s *ActivityLogService) GetOverview(req DesktopActivityOverviewRequest) (DesktopActivityOverview, error) {
	return s.getOverview(context.Background(), req, time.Time{})
}

func (s *ActivityLogService) getOverview(ctx context.Context, req DesktopActivityOverviewRequest, now time.Time) (DesktopActivityOverview, error) {
	if err := s.reconcileConnections(ctx); err != nil {
		return DesktopActivityOverview{}, err
	}
	live := now.IsZero()
	if live {
		now = time.Now().UTC()
	}
	req, err := activitystats.Normalize(req)
	if err != nil {
		return DesktopActivityOverview{}, err
	}
	start, end, _, err := activitystats.Window(req, now)
	if err != nil {
		return DesktopActivityOverview{}, err
	}
	db, err := s.database()
	if err != nil {
		return DesktopActivityOverview{}, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return DesktopActivityOverview{}, err
	}
	defer tx.Rollback()
	var collected, pruned string
	coverageErr := tx.QueryRowContext(ctx, `SELECT started_at,pruned_before FROM desktop_activity_coverage WHERE id='activity'`).Scan(&collected, &pruned)
	if coverageErr != nil && !errors.Is(coverageErr, sql.ErrNoRows) {
		return DesktopActivityOverview{}, coverageErr
	}
	if live {
		now = time.Now().UTC()
		start, end, _, err = activitystats.Window(req, now)
		if err != nil {
			return DesktopActivityOverview{}, err
		}
	}
	var collectedAt, prunedAt *time.Time
	if coverageErr == nil {
		collectedAt, err = desktopActivityTime(collected)
		if err != nil {
			return DesktopActivityOverview{}, err
		}
		prunedAt, err = desktopActivityTime(pruned)
		if err != nil {
			return DesktopActivityOverview{}, err
		}
	}
	// A consistent UTC snapshot supplies entire retry chains. Filters on status,
	// resources and sources are applied to logical works, never to a partial chain.
	actor := desktopLocalActor()
	query := desktopActivitySummarySQL + ` WHERE actor_kind='owner' AND actor_id=? AND actor_grant_id='' AND julianday(created_at)<=julianday(?) AND work_id IN (
 SELECT work_id FROM activity_logs WHERE actor_kind='owner' AND actor_id=? AND actor_grant_id='' AND (
 (julianday(work_started_at)>=julianday(?) AND julianday(work_started_at)<julianday(?)) OR
 (julianday(finished_at)>=julianday(?) AND julianday(finished_at)<julianday(?)) OR
 (julianday(work_started_at)<julianday(?) AND finished_at='') OR
 (julianday(established_at)<julianday(?) AND (finished_at='' OR julianday(finished_at)>julianday(?) OR julianday(connection_uncertain_until)>julianday(?)))
 )) ORDER BY created_at,id`
	rows, err := tx.QueryContext(ctx, query, actor.ID, now.Format(time.RFC3339Nano), actor.ID, start.Format(time.RFC3339Nano), end.Format(time.RFC3339Nano), start.Format(time.RFC3339Nano), end.Format(time.RFC3339Nano), start.Format(time.RFC3339Nano), end.Format(time.RFC3339Nano), start.Format(time.RFC3339Nano), start.Format(time.RFC3339Nano))
	if err != nil {
		return DesktopActivityOverview{}, err
	}
	originals := map[string]DesktopActivityLogItem{}
	facts := []activitystats.Fact{}
	ids := []string{}
	for rows.Next() {
		item, scanErr := scanDesktopActivity(rows)
		if scanErr != nil {
			rows.Close()
			return DesktopActivityOverview{}, scanErr
		}
		fact, scanErr := desktopActivityFact(item)
		if scanErr != nil {
			rows.Close()
			return DesktopActivityOverview{}, scanErr
		}
		originals[item.ID] = item
		facts = append(facts, fact)
		ids = append(ids, item.ID)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return DesktopActivityOverview{}, err
	}
	if err = rows.Close(); err != nil {
		return DesktopActivityOverview{}, err
	}
	resources, err := readDesktopActivityResources(ctx, tx, ids)
	if err != nil {
		return DesktopActivityOverview{}, err
	}
	coverage := activitystats.Coverage(start, collectedAt, prunedAt)
	snapshot, err := activitystats.Aggregate(facts, resources, req, now, coverage)
	if err != nil {
		return DesktopActivityOverview{}, err
	}
	result := DesktopActivityOverview{ConnectionDurationIsLowerBound: snapshot.ConnectionDurationIsLowerBound, MetricVersion: snapshot.MetricVersion, AsOf: snapshot.AsOf, Start: snapshot.Start, End: snapshot.End, Timezone: snapshot.Timezone, Coverage: snapshot.Coverage, Volume: snapshot.Volume, Targets: snapshot.Targets, ResultEvents: snapshot.ResultEvents, TargetResultEvents: snapshot.TargetResultEvents, CarryOver: snapshot.CarryOver, ConnectionDurationMs: snapshot.ConnectionDurationMs, Servers: snapshot.Servers, Timeline: snapshot.Timeline, Total: snapshot.Total, Page: snapshot.Page, PageSize: snapshot.PageSize, Records: []DesktopActivityWork{}}
	for _, work := range snapshot.Records {
		item := originals[work.ID]
		item.Resources = work.Resources
		result.Records = append(result.Records, DesktopActivityWork{DesktopActivityLogItem: item, ObservedAttempts: work.ObservedAttempts, EverFailed: work.EverFailed, Recovered: work.Recovered})
	}
	if err = tx.Commit(); err != nil {
		return DesktopActivityOverview{}, err
	}
	return result, nil
}

func desktopActivityTime(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil, errors.New("invalid stored activity timestamp")
	}
	parsed = parsed.UTC()
	return &parsed, nil
}

func desktopActivityFact(item DesktopActivityLogItem) (activitystats.Fact, error) {
	work, err := desktopActivityTime(item.WorkStartedAt)
	if err != nil {
		return activitystats.Fact{}, err
	}
	created, err := desktopActivityTime(item.CreatedAt)
	if err != nil {
		return activitystats.Fact{}, err
	}
	if work == nil || created == nil {
		return activitystats.Fact{}, errors.New("missing activity chronology")
	}
	started, err := desktopActivityTime(item.StartedAt)
	if err != nil {
		return activitystats.Fact{}, err
	}
	finished, err := desktopActivityTime(item.FinishedAt)
	if err != nil {
		return activitystats.Fact{}, err
	}
	established, err := desktopActivityTime(item.EstablishedAt)
	if err != nil {
		return activitystats.Fact{}, err
	}
	uncertainUntil, err := desktopActivityTime(item.ConnectionUncertainUntil)
	if err != nil {
		return activitystats.Fact{}, err
	}
	return activitystats.Fact{ConnectionUncertainUntil: uncertainUntil, ID: item.ID, WorkID: item.WorkID, ParentWorkID: item.ParentWorkID, WorkStartedAt: *work, CreatedAt: *created, Attempt: item.Attempt, Type: item.Kind, Status: activitystats.Status(item.Status), Source: item.Source, StartedAt: started, FinishedAt: finished, EstablishedAt: established, SuccessCount: item.SuccessCount, BytesProcessed: item.BytesProcessed, BytesCompleted: item.BytesCompleted}, nil
}

func readDesktopActivityResources(ctx context.Context, tx *sql.Tx, ids []string) (map[string][]activitystats.Resource, error) {
	resources := map[string][]activitystats.Resource{}
	for offset := 0; offset < len(ids); offset += 300 {
		stop := min(offset+300, len(ids))
		rows, err := tx.QueryContext(ctx, `SELECT r.activity_id,r.server_id,r.name,s.id IS NULL FROM desktop_activity_resources r LEFT JOIN desktop_servers s ON s.id=r.server_id WHERE r.activity_id IN (`+desktopSQLPlaceholders(stop-offset)+`) ORDER BY r.server_id`, desktopStringsToAny(ids[offset:stop])...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			var resource activitystats.Resource
			if err := rows.Scan(&id, &resource.ServerID, &resource.Name, &resource.Deleted); err != nil {
				rows.Close()
				return nil, err
			}
			resources[id] = append(resources[id], resource)
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		if err = rows.Close(); err != nil {
			return nil, err
		}
	}
	return resources, nil
}
