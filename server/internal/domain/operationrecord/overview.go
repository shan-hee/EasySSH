package operationrecord

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/easyssh/server/internal/storage/accessquery"
	"github.com/easyssh/shared/activitystats"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrInvalidWindow = activitystats.ErrInvalidWindow

// Dates are local calendar dates, inclusive. UTC boundaries are half-open.
type OverviewRequest struct {
	Timezone  string     `form:"timezone"`
	Range     string     `form:"range"`
	StartDate string     `form:"start_date"`
	EndDate   string     `form:"end_date"`
	ServerID  *uuid.UUID `form:"server_id"`
	Source    string     `form:"source"`
	Type      RecordType `form:"type"`
	Status    Status     `form:"status"`
	History   string     `form:"history"`
	View      string     `form:"view"`
	Page      int        `form:"page"`
	PageSize  int        `form:"page_size"`
}

type Coverage struct {
	ID           string     `gorm:"primaryKey;size:20" json:"-"`
	StartedAt    time.Time  `json:"started_at"`
	PrunedBefore *time.Time `json:"pruned_before,omitempty"`
}

func (Coverage) TableName() string { return "activity_coverage" }

type OverviewCoverage = activitystats.OverviewCoverage
type WorkMetrics = activitystats.WorkMetrics
type ResultEvents = activitystats.ResultEvents
type ServerDistribution = activitystats.ServerDistribution
type TimeBucket = activitystats.TimeBucket

type WorkSummary struct {
	OperationRecordSummary
	EverFailed       bool               `json:"ever_failed"`
	Recovered        bool               `json:"recovered"`
	ObservedAttempts int                `json:"observed_attempts"`
	Resources        []ResourceSnapshot `json:"resources"`
}

type Overview struct {
	ConnectionDurationIsLowerBound bool                 `json:"connection_duration_is_lower_bound"`
	MetricVersion                  string               `json:"metric_version"`
	AsOf                           time.Time            `json:"as_of"`
	Start                          time.Time            `json:"start"`
	End                            time.Time            `json:"end"`
	Timezone                       string               `json:"timezone"`
	Coverage                       OverviewCoverage     `json:"coverage"`
	Volume                         WorkMetrics          `json:"volume"`
	Targets                        WorkMetrics          `json:"targets"`
	ResultEvents                   ResultEvents         `json:"result_events"`
	TargetResultEvents             ResultEvents         `json:"target_result_events"`
	CarryOver                      int64                `json:"carry_over"`
	ConnectionDurationMs           int64                `json:"connection_duration_ms"`
	Servers                        []ServerDistribution `json:"servers"`
	Timeline                       []TimeBucket         `json:"timeline"`
	Records                        []WorkSummary        `json:"records"`
	Total                          int                  `json:"total"`
	Page                           int                  `json:"page"`
	PageSize                       int                  `json:"page_size"`
}

func (req OverviewRequest) statsRequest() activitystats.Request {
	serverID := ""
	if req.ServerID != nil {
		serverID = req.ServerID.String()
	}
	return activitystats.Request{Timezone: req.Timezone, Range: req.Range, StartDate: req.StartDate, EndDate: req.EndDate, ServerID: serverID, Source: req.Source, Type: req.Type, Status: req.Status, History: req.History, View: req.View, Page: req.Page, PageSize: req.PageSize}
}
func activityWindow(req OverviewRequest, now time.Time) (time.Time, time.Time, *time.Location, error) {
	return activitystats.Window(req.statsRequest(), now)
}
func newMetrics() WorkMetrics { return activitystats.NewMetrics() }

// Overview reads both the aggregates and the requested work page from one
// database snapshot. All grouping happens after the authenticated SQL filter.
func (r *repository) Overview(ctx context.Context, req OverviewRequest) (*Overview, error) {
	normalized, err := activitystats.Normalize(req.statsRequest())
	if err != nil {
		return nil, err
	}
	req.Page, req.PageSize = normalized.Page, normalized.PageSize
	now := time.Now().UTC()
	start, end, loc, err := activityWindow(req, now)
	if err != nil {
		return nil, err
	}
	result := &Overview{AsOf: now, Start: start, End: end, Timezone: loc.String(), Volume: newMetrics(), Targets: newMetrics(), Records: []WorkSummary{}, Servers: []ServerDistribution{}, Timeline: []TimeBucket{}, Page: req.Page, PageSize: req.PageSize}
	opts := &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true}
	if r.db.Dialector.Name() == "sqlite" {
		opts = &sql.TxOptions{}
	}
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var coverage Coverage
		coverageErr := tx.Where("id = ?", "activity").First(&coverage).Error
		if coverageErr != nil && !errors.Is(coverageErr, gorm.ErrRecordNotFound) {
			return coverageErr
		}
		now = time.Now().UTC()
		start, end, loc, err = activityWindow(req, now)
		if err != nil {
			return err
		}
		result.AsOf, result.Start, result.End = now, start, end
		if coverageErr == nil {
			result.Coverage = activitystats.Coverage(start, &coverage.StartedAt, coverage.PrunedBefore)
		} else {
			result.Coverage = activitystats.Coverage(start, nil, nil)
		}
		query, err := accessquery.Visible(ctx, tx.Model(&OperationRecord{}))
		if err != nil {
			return err
		}
		// Select the entire retry chain for relevant logical works. Progress writes
		// do not become activity events. A date filter must never hide a newer retry.
		query = overviewWorkQuery(query).Where("created_at <= ?", now)
		relevant := query.Session(&gorm.Session{}).Select("work_id").Where("(work_started_at >= ? AND work_started_at < ?) OR (finished_at >= ? AND finished_at < ?) OR (work_started_at < ? AND finished_at IS NULL) OR (established_at < ? AND (finished_at IS NULL OR finished_at > ? OR connection_uncertain_until > ?))", start, end, start, end, start, end, start, start)
		var rows []OperationRecordSummary
		if err := query.Session(&gorm.Session{}).Where("work_id IN (?)", relevant).Order("created_at ASC, id ASC").Find(&rows).Error; err != nil {
			return err
		}
		resources := map[uuid.UUID][]ResourceSnapshot{}
		// Bounded IN clauses keep the query valid on SQLite as well as server DBs.
		for offset := 0; offset < len(rows); offset += 300 {
			stop := offset + 300
			if stop > len(rows) {
				stop = len(rows)
			}
			ids := make([]uuid.UUID, 0, stop-offset)
			for _, row := range rows[offset:stop] {
				ids = append(ids, row.ID)
			}
			snapshots, err := readResourceSnapshots(tx, ids)
			if err != nil {
				return err
			}
			for id, items := range snapshots {
				resources[id] = items
			}
		}
		return result.aggregate(rows, resources, req, loc)
	}, opts)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (o *Overview) aggregate(rows []OperationRecordSummary, resources map[uuid.UUID][]ResourceSnapshot, req OverviewRequest, loc *time.Location) error {
	facts := make([]activitystats.Fact, 0, len(rows))
	originals := make(map[string]OperationRecordSummary, len(rows))
	snapshots := make(map[string][]activitystats.Resource, len(resources))
	for _, row := range rows {
		parent := ""
		if row.ParentWorkID != nil {
			parent = row.ParentWorkID.String()
		}
		facts = append(facts, activitystats.Fact{ID: row.ID.String(), WorkID: row.WorkID.String(), ParentWorkID: parent, WorkStartedAt: row.WorkStartedAt, CreatedAt: row.CreatedAt, Attempt: row.Attempt, Type: row.Type, Status: row.Status, Source: row.Source, ConnectionUncertainUntil: row.ConnectionUncertainUntil, EstablishedAt: row.EstablishedAt, StartedAt: row.StartedAt, FinishedAt: row.FinishedAt, SuccessCount: row.SuccessCount, BytesProcessed: row.BytesProcessed, BytesCompleted: row.BytesCompleted})
		originals[row.ID.String()] = row
	}
	for id, items := range resources {
		for _, item := range items {
			snapshots[id.String()] = append(snapshots[id.String()], activitystats.Resource{ServerID: item.ServerID.String(), Name: item.Name, Deleted: item.Deleted})
		}
	}
	sharedReq := req.statsRequest()
	// The repository has already fixed its calendar window within this snapshot.
	sharedReq.Range = "custom"
	sharedReq.StartDate = o.Start.In(loc).Format("2006-01-02")
	sharedReq.EndDate = o.End.Add(-time.Nanosecond).In(loc).Format("2006-01-02")
	result, err := activitystats.Aggregate(facts, snapshots, sharedReq, o.AsOf, o.Coverage)
	if err != nil {
		return err
	}
	o.MetricVersion = result.MetricVersion
	o.AsOf = result.AsOf
	o.Start = result.Start
	o.End = result.End
	o.Timezone = result.Timezone
	o.Volume = result.Volume
	o.Targets = result.Targets
	o.ResultEvents = result.ResultEvents
	o.TargetResultEvents = result.TargetResultEvents
	o.CarryOver = result.CarryOver
	o.ConnectionDurationMs = result.ConnectionDurationMs
	o.ConnectionDurationIsLowerBound = result.ConnectionDurationIsLowerBound
	o.Servers = result.Servers
	o.Timeline = result.Timeline
	o.Total = result.Total
	o.Page = result.Page
	o.PageSize = result.PageSize
	o.Records = make([]WorkSummary, 0, len(result.Records))
	for _, item := range result.Records {
		record := WorkSummary{OperationRecordSummary: originals[item.ID], ObservedAttempts: item.ObservedAttempts, EverFailed: item.EverFailed, Recovered: item.Recovered, Resources: []ResourceSnapshot{}}
		for _, resource := range item.Resources {
			id, err := uuid.Parse(resource.ServerID)
			if err != nil {
				return err
			}
			record.Resources = append(record.Resources, ResourceSnapshot{ServerID: id, Name: resource.Name, Deleted: resource.Deleted})
		}
		o.Records = append(o.Records, record)
	}
	return nil
}

// markPruned conservatively advances the known-complete boundary. This prevents
// a retention change or explicit removal from being presented as zero activity.
func markPruned(tx *gorm.DB, category Category, before time.Time) error {
	if category != "" && category != CategoryActivity && category != CategoryAudit {
		return nil
	}
	return tx.Model(&Coverage{}).Where("id = ? AND (pruned_before IS NULL OR pruned_before < ?)", "activity", before).Update("pruned_before", before).Error
}

// EnsureCoverage records when this installation began collecting these facts.
// An existing boundary is never reset by a restart.
func (r *repository) EnsureCoverage(ctx context.Context) error {
	row := Coverage{ID: "activity", StartedAt: time.Now().UTC()}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}
