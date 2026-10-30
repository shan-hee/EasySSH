package activitystats

import (
	"errors"
	"github.com/easyssh/shared/protocol"
	"sort"
	"time"
	_ "time/tzdata"
)

var ErrInvalidWindow = errors.New("invalid activity window or filter")

const MetricVersion = "workspace-activity-v1"

type Kind = protocol.ActivityKind
type Status = protocol.ActivityStatus

const (
	TypeConnection Kind   = "connection"
	TypeTransfer   Kind   = "transfer"
	TypeExecution  Kind   = "execution"
	TypeAudit      Kind   = "audit"
	StatusPending  Status = "pending"
	StatusRunning  Status = "running"
	StatusSuccess  Status = "success"
	StatusFailure  Status = "failure"
	StatusPartial  Status = "partial"
	StatusCanceled Status = "canceled"
	StatusTimeout  Status = "timeout"
	StatusWarning  Status = "warning"
	StatusUnknown  Status = "unknown"
)

type Request = protocol.ActivityOverviewInput

type Resource struct {
	ServerID string `json:"server_id"`
	Name     string `json:"name"`
	Deleted  bool   `json:"deleted"`
}

// Facts are immutable observations/projections supplied from one authorized
// database snapshot. This package has no access to databases or executors.
type Fact struct {
	ID, WorkID, ParentWorkID             string
	WorkStartedAt, CreatedAt             time.Time
	Attempt                              int
	Type                                 Kind
	Status                               Status
	Source                               string
	EstablishedAt, StartedAt, FinishedAt *time.Time
	ConnectionUncertainUntil             *time.Time
	SuccessCount                         int
	BytesProcessed, BytesCompleted       int64
}

type Work struct {
	ID               string     `json:"id"`
	WorkID           string     `json:"work_id"`
	WorkStartedAt    time.Time  `json:"work_started_at"`
	ObservedAttempts int        `json:"observed_attempts"`
	EverFailed       bool       `json:"ever_failed"`
	Recovered        bool       `json:"recovered"`
	Resources        []Resource `json:"resources"`
}
type OverviewCoverage = protocol.ActivityCoverage

type WorkMetrics = protocol.ActivityWorkMetrics

type ResultEvents = protocol.ActivityResultEvents

type ServerDistribution = protocol.ActivityServerDistribution

type TimeBucket = protocol.ActivityTimeBucket

type Snapshot struct {
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
	Records                        []Work               `json:"records"`
	Total                          int                  `json:"total"`
	Page                           int                  `json:"page"`
	PageSize                       int                  `json:"page_size"`
}

func Window(req Request, now time.Time) (time.Time, time.Time, *time.Location, error) {
	if req.Timezone == "" {
		req.Timezone = "UTC"
	}
	if req.Timezone == "Local" {
		return time.Time{}, time.Time{}, nil, ErrInvalidWindow
	}
	loc, err := time.LoadLocation(req.Timezone)
	if err != nil {
		return time.Time{}, time.Time{}, nil, ErrInvalidWindow
	}
	local := now.In(loc)
	firstDate := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	lastDate := firstDate
	switch req.Range {
	case "", "today":
	case "seven_days":
		firstDate = firstDate.AddDate(0, 0, -6)
	case "custom":
		firstDate, err = time.Parse("2006-01-02", req.StartDate)
		if err != nil {
			return time.Time{}, time.Time{}, nil, ErrInvalidWindow
		}
		lastDate, err = time.Parse("2006-01-02", req.EndDate)
		if err != nil {
			return time.Time{}, time.Time{}, nil, ErrInvalidWindow
		}
	default:
		return time.Time{}, time.Time{}, nil, ErrInvalidWindow
	}
	if lastDate.Before(firstDate) || !lastDate.Before(firstDate.AddDate(1, 0, 1)) {
		return time.Time{}, time.Time{}, nil, ErrInvalidWindow
	}
	start, err := localDateBoundary(firstDate, loc, false)
	if err != nil || start.After(now) {
		return time.Time{}, time.Time{}, nil, ErrInvalidWindow
	}
	if _, err = localDateBoundary(lastDate, loc, false); err != nil {
		return time.Time{}, time.Time{}, nil, ErrInvalidWindow
	}
	end, err := localDateBoundary(lastDate.AddDate(0, 0, 1), loc, true)
	if err != nil || !end.After(start) {
		return time.Time{}, time.Time{}, nil, ErrInvalidWindow
	}
	return start.UTC(), end.UTC(), loc, nil
}

// Some zones advance their clocks at midnight. time.Date may normalize that
// nonexistent midnight into the preceding date. Locate the first actual instant
// instead; an entirely skipped requested date is rejected, while an exclusive
// upper boundary may advance over such a date.
func localDateBoundary(date time.Time, loc *time.Location, allowSkipped bool) (time.Time, error) {
	label := date.Format("2006-01-02")
	nominal := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, loc)
	if nominal.Format("2006-01-02") == label && nominal.Add(-time.Nanosecond).Format("2006-01-02") < label {
		return nominal, nil
	}
	previous := nominal.Add(-26 * time.Hour)
	for current := previous.Add(time.Minute); !current.After(nominal.Add(26 * time.Hour)); current = current.Add(time.Minute) {
		if current.In(loc).Format("2006-01-02") >= label {
			low, high := previous, current
			for high.Sub(low) > time.Nanosecond {
				mid := low.Add(high.Sub(low) / 2)
				if mid.In(loc).Format("2006-01-02") >= label {
					high = mid
				} else {
					low = mid
				}
			}
			if !allowSkipped && high.In(loc).Format("2006-01-02") != label {
				return time.Time{}, ErrInvalidWindow
			}
			return high, nil
		}
		previous = current
	}
	return time.Time{}, ErrInvalidWindow
}

func NewMetrics() WorkMetrics {
	return WorkMetrics{ByStatus: map[Status]int64{}, ByType: map[Kind]int64{}, BySource: map[string]int64{}}
}

func Normalize(req Request) (Request, error) {
	if req.View != "" && req.View != "started" && req.View != "carry_over" && req.View != "results" && req.View != "targets" {
		return req, ErrInvalidWindow
	}
	if req.History != "" && req.History != "ever_failed" && req.History != "recovered" && req.History != "unresolved" {
		return req, ErrInvalidWindow
	}
	switch req.Type {
	case "", TypeConnection, TypeTransfer, TypeExecution, TypeAudit:
	default:
		return req, ErrInvalidWindow
	}
	switch req.Status {
	case "", StatusPending, StatusRunning, StatusSuccess, StatusFailure, StatusPartial, StatusCanceled, StatusTimeout, StatusWarning, StatusUnknown:
	default:
		return req, ErrInvalidWindow
	}
	switch req.Source {
	case "", "manual", "share", "automation":
	default:
		return req, ErrInvalidWindow
	}
	if req.Page < 1 {
		req.Page = 1
	}
	if req.PageSize < 1 {
		req.PageSize = 20
	}
	if req.PageSize > 100 {
		req.PageSize = 100
	}
	return req, nil
}

func Aggregate(rows []Fact, resources map[string][]Resource, req Request, now time.Time, coverage OverviewCoverage) (*Snapshot, error) {
	req, err := Normalize(req)
	if err != nil {
		return nil, err
	}
	start, end, loc, err := Window(req, now)
	if err != nil {
		return nil, err
	}
	o := &Snapshot{MetricVersion: MetricVersion, AsOf: now, Start: start, End: end, Timezone: loc.String(), Coverage: coverage, Volume: NewMetrics(), Targets: NewMetrics(), Servers: []ServerDistribution{}, Timeline: []TimeBucket{}, Records: []Work{}, Page: req.Page, PageSize: req.PageSize}
	o.aggregate(rows, resources, req, loc)
	return o, nil
}

func Coverage(start time.Time, collected *time.Time, pruned *time.Time) OverviewCoverage {
	if collected == nil {
		return OverviewCoverage{Reason: "coverage_unknown"}
	}
	available := *collected
	if pruned != nil && pruned.After(available) {
		available = *pruned
	}
	result := OverviewCoverage{Known: true, AvailableFrom: &available, CompleteWindow: !start.Before(available)}
	if !result.CompleteWindow {
		result.Reason = "window_extends_before_retained_history"
	}
	return result
}
func (o *Snapshot) aggregate(rows []Fact, resources map[string][]Resource, req Request, loc *time.Location) {
	chains := map[string][]Fact{}
	for _, row := range rows {
		if row.CreatedAt.After(o.AsOf) {
			continue
		}
		chains[row.WorkID] = append(chains[row.WorkID], row)
	}
	rootResources := map[string][]Resource{}
	for _, row := range rows {
		if row.ParentWorkID != "" && !row.CreatedAt.After(o.AsOf) {
			rootResources[row.ParentWorkID] = append(rootResources[row.ParentWorkID], resources[row.ID]...)
		}
	}
	servers := map[string]*ServerDistribution{}
	serverSeen := map[string]time.Time{}
	targetServers := map[string]bool{}
	buckets := map[time.Time]*TimeBucket{}
	bucket := func(t time.Time) *TimeBucket {
		if t.Before(o.Start) || !t.Before(o.End) || t.After(o.AsOf) {
			return nil
		}
		local := t.In(loc)
		// Subtract wall-clock minutes from this instant: a repeated DST hour retains
		// its UTC offset and fractional UTC offsets do not shift the local buckets.
		first := t.Add(-time.Duration(local.Minute())*time.Minute - time.Duration(local.Second())*time.Second - time.Duration(local.Nanosecond()))
		zoneStart, zoneEnd := local.ZoneBounds()
		if !zoneStart.IsZero() && first.Before(zoneStart) {
			first = zoneStart.UTC()
		}
		if first.Before(o.Start) {
			first = o.Start
		}
		if b := buckets[first]; b != nil {
			return b
		}
		firstLocal := first.In(loc)
		last := first.Add(time.Duration(60-firstLocal.Minute())*time.Minute - time.Duration(firstLocal.Second())*time.Second - time.Duration(firstLocal.Nanosecond()))
		if !zoneEnd.IsZero() && zoneEnd.Before(last) {
			last = zoneEnd.UTC()
		}
		if last.After(o.End) {
			last = o.End
		}
		b := &TimeBucket{Start: first, End: last, Label: first.In(loc).Format("2006-01-02T15:04:05Z07:00")}
		buckets[first] = b
		return b
	}
	selected := []Work{}
	for _, chain := range chains {
		sort.Slice(chain, func(i, j int) bool {
			if chain[i].Attempt != chain[j].Attempt {
				return chain[i].Attempt < chain[j].Attempt
			}
			if !chain[i].CreatedAt.Equal(chain[j].CreatedAt) {
				return chain[i].CreatedAt.Before(chain[j].CreatedAt)
			}
			return chain[i].ID < chain[j].ID
		})
		latest := chain[len(chain)-1]
		if req.Status != "" && latest.Status != req.Status {
			continue
		}
		if req.Source != "" && latest.Source != req.Source {
			continue
		}
		if req.Type != "" && latest.Type != req.Type {
			continue
		}
		everFailed := false
		for _, row := range chain {
			if row.Status == StatusFailure || row.Status == StatusTimeout || row.Status == StatusPartial {
				everFailed = true
			}
		}
		recovered := everFailed && latest.Status == StatusSuccess
		if req.History == "ever_failed" && !everFailed || req.History == "recovered" && !recovered || req.History == "unresolved" && (!everFailed || recovered) {
			continue
		}
		matchesServer := req.ServerID == ""
		for _, row := range chain {
			for _, resource := range resources[row.ID] {
				if resource.ServerID == req.ServerID {
					matchesServer = true
				}
			}
		}
		for _, resource := range rootResources[latest.WorkID] {
			if resource.ServerID == req.ServerID {
				matchesServer = true
			}
		}
		if !matchesServer {
			continue
		}
		child := latest.ParentWorkID != ""
		started := !latest.WorkStartedAt.Before(o.Start) && latest.WorkStartedAt.Before(o.End) && !latest.WorkStartedAt.After(o.AsOf)
		active := latest.Status == StatusPending || latest.Status == StatusRunning
		carry := latest.WorkStartedAt.Before(o.Start) && active
		inResults := false
		seenResources := map[string]Resource{}
		for _, resource := range rootResources[latest.WorkID] {
			seenResources[resource.ServerID] = resource
		}
		establishedInWindow := false
		connectionOverlapsWindow := false
		for _, row := range chain {
			for _, resource := range resources[row.ID] {
				seenResources[resource.ServerID] = resource
			}
			metrics := &o.Volume
			if child {
				metrics = &o.Targets
			}
			if row.Type == TypeConnection && row.EstablishedAt != nil && !row.EstablishedAt.Before(o.Start) && row.EstablishedAt.Before(o.End) && !row.EstablishedAt.After(o.AsOf) {
				establishedInWindow = true
				metrics.Connections++
			}
			if row.Type == TypeConnection && row.EstablishedAt == nil && (row.Status == StatusFailure || row.Status == StatusTimeout) && row.FinishedAt != nil && !row.FinishedAt.Before(o.Start) && row.FinishedAt.Before(o.End) && !row.FinishedAt.After(o.AsOf) {
				metrics.ConnectionFailures++
			}
			if row.FinishedAt != nil && !row.FinishedAt.Before(o.Start) && row.FinishedAt.Before(o.End) && !row.FinishedAt.After(o.AsOf) {
				inResults = true
				events := &o.ResultEvents
				if child {
					events = &o.TargetResultEvents
				}
				addResult(events, row)
				if !child {
					if b := bucket(*row.FinishedAt); b != nil {
						addResult(&b.Results, row)
					}
				}
			}
			if !child && row.EstablishedAt != nil && !row.EstablishedAt.After(o.AsOf) {
				if b := bucket(*row.EstablishedAt); b != nil {
					b.Established++
				}
				from := *row.EstablishedAt
				if from.Before(o.Start) {
					from = o.Start
				}
				to := o.AsOf
				if row.FinishedAt != nil && row.FinishedAt.Before(to) {
					to = *row.FinishedAt
				}
				if to.After(o.End) {
					to = o.End
				}
				if to.After(from) {
					connectionOverlapsWindow = true
					o.ConnectionDurationMs += to.Sub(from).Milliseconds()
					if row.Status == StatusUnknown {
						o.ConnectionDurationIsLowerBound = true
					}
				}
				// A zero confirmed duration inside an interruption gap is still a
				// lower bound, not evidence that no connection existed that day.
				uncertainEnd := o.AsOf
				if o.End.Before(uncertainEnd) {
					uncertainEnd = o.End
				}
				if row.ConnectionUncertainUntil != nil && row.FinishedAt != nil && uncertainEnd.After(o.Start) && row.FinishedAt.Before(uncertainEnd) && row.ConnectionUncertainUntil.After(*row.FinishedAt) && row.ConnectionUncertainUntil.After(o.Start) {
					connectionOverlapsWindow = true
					o.ConnectionDurationIsLowerBound = true
					o.Coverage.CompleteWindow = false
					if o.Coverage.Reason == "" {
						o.Coverage.Reason = "interrupted_connection_observation"
					}
					found := false
					for _, metric := range o.Coverage.UnavailableMetrics {
						found = found || metric == "connection_duration_ms"
					}
					if !found {
						o.Coverage.UnavailableMetrics = append(o.Coverage.UnavailableMetrics, "connection_duration_ms")
					}
				}
			}
		}
		if !child && carry {
			o.CarryOver++
		}
		if started {
			metrics := &o.Volume
			if child {
				metrics = &o.Targets
				for id := range seenResources {
					targetServers[id] = true
				}
			}
			metrics.Works++
			if everFailed {
				metrics.EverFailed++
				if recovered {
					metrics.Recovered++
				} else {
					metrics.UnresolvedFailures++
				}
			}
			if active {
				metrics.Active++
			}
			metrics.BySource[latest.Source]++
			metrics.Attempts += int64(len(chain))
			metrics.ByStatus[latest.Status]++
			metrics.ByType[latest.Type]++
			for _, row := range chain {
				if row.Attempt > 1 {
					metrics.Retries++
				}
				metrics.AttemptBytes += row.BytesProcessed

			}
			switch latest.Type {
			case TypeExecution:
				metrics.Executions++
			case TypeTransfer:
				metrics.Transfers++
				metrics.SuccessfulFiles += int64(latest.SuccessCount)
				metrics.CompletedBytes += latest.BytesCompleted
			case TypeAudit:
				metrics.ConfigurationChanges++
			}
			if !child {
				if b := bucket(latest.WorkStartedAt); b != nil {
					b.Started++
				}
			}
		}
		if !child && (started && latest.Type != TypeConnection || establishedInWindow) {
			for id, s := range seenResources {
				entry := servers[id]
				if entry == nil {
					entry = &ServerDistribution{ServerID: id, Name: s.Name}
					servers[id] = entry
				}
				entry.Works++
				if s.Name != "" && (entry.Name == "" || latest.CreatedAt.After(serverSeen[id]) || latest.CreatedAt.Equal(serverSeen[id]) && s.Name < entry.Name) {
					entry.Name = s.Name
					serverSeen[id] = latest.CreatedAt
				}
			}
		}

		include := (started || establishedInWindow || connectionOverlapsWindow) && !child
		switch req.View {
		case "carry_over":
			include = carry && !child
		case "results":
			include = inResults && !child
		case "targets":
			include = started && child
		}
		if include {
			snapshots := make([]Resource, 0, len(seenResources))
			for _, s := range seenResources {
				snapshots = append(snapshots, s)
			}
			sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].ServerID < snapshots[j].ServerID })
			selected = append(selected, Work{ID: latest.ID, WorkID: latest.WorkID, WorkStartedAt: latest.WorkStartedAt, ObservedAttempts: len(chain), Resources: snapshots, EverFailed: everFailed, Recovered: recovered})
		}
	}
	o.Volume.Servers = int64(len(servers))
	o.Targets.Servers = int64(len(targetServers))
	for _, entry := range servers {
		o.Servers = append(o.Servers, *entry)
	}
	sort.Slice(o.Servers, func(i, j int) bool {
		if o.Servers[i].Works != o.Servers[j].Works {
			return o.Servers[i].Works > o.Servers[j].Works
		}
		return o.Servers[i].ServerID < o.Servers[j].ServerID
	})
	for _, b := range buckets {
		o.Timeline = append(o.Timeline, *b)
	}
	sort.Slice(o.Timeline, func(i, j int) bool { return o.Timeline[i].Start.Before(o.Timeline[j].Start) })
	sort.Slice(selected, func(i, j int) bool {
		if !selected[i].WorkStartedAt.Equal(selected[j].WorkStartedAt) {
			return selected[i].WorkStartedAt.After(selected[j].WorkStartedAt)
		}
		return selected[i].WorkID < selected[j].WorkID
	})
	o.Total = len(selected)
	// Clamp before multiplying to avoid overflow from an untrusted page number.
	if req.Page <= (len(selected)+req.PageSize-1)/req.PageSize {
		offset := (req.Page - 1) * req.PageSize
		end := offset + req.PageSize
		if end > len(selected) {
			end = len(selected)
		}
		o.Records = selected[offset:end]
	}
}

func addResult(events *ResultEvents, row Fact) {
	if row.Type == TypeTransfer {
		if row.Status == StatusSuccess {
			events.CompletedTransfers++
		}
		events.SuccessfulFiles += int64(row.SuccessCount)
		events.CompletedBytes += row.BytesCompleted
	}
	switch row.Status {
	case StatusSuccess:
		events.Completed++
	case StatusFailure, StatusTimeout:
		events.Failed++
	case StatusPartial:
		events.Partial++
	case StatusCanceled:
		events.Canceled++
	case StatusUnknown:
		events.Unknown++
	}
}
