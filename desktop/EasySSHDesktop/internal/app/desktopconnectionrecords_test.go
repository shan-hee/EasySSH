package app

import (
	"context"
	"github.com/easyssh/shared/protocol"
	"testing"
	"time"

	"github.com/easyssh/shared/activitystats"
)

func TestConnectionOutcomeAndProjectionCommitTogether(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	s := &ActivityLogService{db: tasks.db}
	observation, err := s.beginConnection(context.Background(), DesktopServer{ID: "server", Name: "original name"})
	if err != nil {
		t.Fatal(err)
	}
	if err = observation.established(); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`CREATE TRIGGER reject_connection_finish BEFORE UPDATE ON desktop_connections WHEN NEW.finished_at<>'' BEGIN SELECT RAISE(ABORT,'connection storage unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	record := observation.record
	record.Item.Status = "success"
	record.Item.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	// Exercise the failing transaction once, without exhausting the writer's
	// backoff. Losing this result must not create an alternate receipt history.
	if err = s.persistConnection(context.Background(), record); err == nil {
		t.Fatal("storage failure was ignored")
	}
	var status, finished string
	if err = s.db.QueryRow(`SELECT status,finished_at FROM activity_logs WHERE source_id=?`, record.Item.SourceID).Scan(&status, &finished); err != nil || status != "running" || finished != "" {
		t.Fatalf("projection escaped transaction: %s %s %v", status, finished, err)
	}
	if _, err = s.db.Exec(`DROP TRIGGER reject_connection_finish`); err != nil {
		t.Fatal(err)
	}
	second, err := s.beginConnection(context.Background(), DesktopServer{ID: "second"})
	if err != nil {
		t.Fatal(err)
	}
	// Simulate the first transport ending with no durable outcome. The second
	// transport is still dialing and must be excluded from reconciliation.
	delete(s.liveConnections, record.Item.SourceID)
	if err = s.reconcileConnections(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = s.db.QueryRow(`SELECT status,finished_at FROM activity_logs WHERE source_id=?`, record.Item.SourceID).Scan(&status, &finished); err != nil || status != "unknown" || finished != observation.record.LastObservedAt {
		t.Fatalf("lost outcome became a fabricated success: %s %s %v", status, finished, err)
	}
	if err = s.db.QueryRow(`SELECT status,finished_at FROM desktop_connections WHERE id=?`, second.record.Item.SourceID).Scan(&status, &finished); err != nil || status != "pending" || finished != "" {
		t.Fatalf("active admission was reconciled: %s %s %v", status, finished, err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM desktop_connections`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("reconciliation replayed a connection: %d %v", count, err)
	}
}

func TestInterruptedConnectionStopsAtLastObservation(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	s := &ActivityLogService{db: tasks.db}
	observation, err := s.beginConnection(context.Background(), DesktopServer{ID: "server", Name: "name"})
	if err != nil {
		t.Fatal(err)
	}
	day := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	record := observation.record
	record.Item.CreatedAt, record.Item.StartedAt, record.Item.WorkStartedAt = day.Format(time.RFC3339Nano), day.Format(time.RFC3339Nano), day.Format(time.RFC3339Nano)
	record.Item.EstablishedAt = day.Add(time.Minute).Format(time.RFC3339Nano)
	record.LastObservedAt = day.Add(3 * time.Minute).Format(time.RFC3339Nano)
	record.Item.Status = "running"
	if err = s.saveConnection(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	// The projection preserves creation identity on conflict; use its original
	// timestamp consistently for this fixed-time fixture.
	if _, err = s.db.Exec(`UPDATE activity_logs SET created_at=? WHERE source_id=?`, record.Item.CreatedAt, record.Item.SourceID); err != nil {
		t.Fatal(err)
	}
	if err = recoverDesktopConnections(context.Background(), s.db); err != nil {
		t.Fatal(err)
	}
	if err = recoverDesktopConnections(context.Background(), s.db); err != nil {
		t.Fatal(err)
	}
	overview, err := s.getOverview(context.Background(), DesktopActivityOverviewRequest{Type: activitystats.TypeConnection}, day.Add(12*time.Hour))
	if err != nil || overview.ConnectionDurationMs != (2*time.Minute).Milliseconds() || !overview.ConnectionDurationIsLowerBound || overview.Volume.Connections != 1 || overview.Volume.ConnectionFailures != 0 || overview.Volume.ByStatus[activitystats.StatusUnknown] != 1 {
		t.Fatalf("interruption became uptime or definite failure: %+v %v", overview, err)
	}
	if _, err = pruneDesktopActivity(context.Background(), s.db, day.Add(24*time.Hour), false); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM desktop_connections`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("connection facts outlived cleared history: %d %v", count, err)
	}
}

func TestConnectionStartCannotEscapeProjectionFailure(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	s := &ActivityLogService{db: tasks.db}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_connection_projection BEFORE INSERT ON activity_logs WHEN NEW.source_table='desktop_connections' BEGIN SELECT RAISE(ABORT,'projection unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.beginConnection(context.Background(), DesktopServer{ID: "server"}); err == nil {
		t.Fatal("terminal admitted without a durable source")
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM desktop_connections`).Scan(&count); err != nil || count != 0 || len(s.liveConnections) != 0 {
		t.Fatalf("failed admission leaked: %d %d %v", count, len(s.liveConnections), err)
	}
}

func TestOnlineStateUsesLiveConnectionsNotLastSuccessfulConnection(t *testing.T) {
	servers := newSSHKeyTestService(t)
	activity := &ActivityLogService{db: servers.db}
	servers.activity = activity
	server, err := servers.Create(protocol.ServerCreate{Name: "server", Host: "example.test", Username: "owner", AuthMethod: protocol.ServerAuthMethod("password")})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := servers.getByIDStored(server.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	observation, err := activity.beginConnection(context.Background(), stored)
	if err != nil {
		t.Fatal(err)
	}
	if err = observation.established(); err != nil {
		t.Fatal(err)
	}
	connected, err := servers.GetById(server.ID.String())
	if err != nil || connected.Status != nil || connected.Connected == nil || !*connected.Connected || connected.LastConnected == nil || connected.UpdatedAt == nil || !connected.UpdatedAt.Equal(*server.UpdatedAt) {
		t.Fatalf("connection snapshot changed configuration or missed live status: %+v %v", connected, err)
	}
	observation.finish("success", "closed", time.Time{})
	disconnected, err := servers.GetById(server.ID.String())
	if err != nil || disconnected.Status != nil || disconnected.Connected == nil || *disconnected.Connected || disconnected.LastConnected == nil || !disconnected.LastConnected.Equal(*connected.LastConnected) || len(activity.liveConnections) != 0 {
		t.Fatalf("closed connection retained false online state: %+v %v", disconnected, err)
	}
	// A newly started process has no live transports, regardless of old history.
	servers.activity = &ActivityLogService{db: servers.db}
	restarted, err := servers.GetById(server.ID.String())
	if err != nil || restarted.Status != nil || restarted.Connected == nil || *restarted.Connected {
		t.Fatalf("persisted history became live state: %+v %v", restarted, err)
	}
}

func TestDesktopOverviewIncludesConnectionInterruptionGap(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	activity := &ActivityLogService{db: tasks.db}
	day := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	started, observed, recovered := day.Add(-2*time.Hour), day.Add(-time.Hour), day.Add(2*time.Hour)
	insertDesktopActivityFixture(t, tasks, DesktopActivityLogItem{ID: "gap", Actor: desktopLocalActor(), WorkID: "gap", Attempt: 1, WorkStartedAt: started.Format(time.RFC3339Nano), CreatedAt: started.Format(time.RFC3339Nano), StartedAt: started.Format(time.RFC3339Nano), EstablishedAt: started.Format(time.RFC3339Nano), FinishedAt: observed.Format(time.RFC3339Nano), ConnectionUncertainUntil: recovered.Format(time.RFC3339Nano), Kind: activitystats.TypeConnection, Source: "manual", Action: "ssh_connect", Status: "unknown", SourceTable: "fixture", SourceID: "gap"})
	result, err := activity.getOverview(context.Background(), DesktopActivityOverviewRequest{Type: activitystats.TypeConnection}, day.Add(12*time.Hour))
	if err != nil || result.Total != 1 || result.ConnectionDurationMs != 0 || !result.ConnectionDurationIsLowerBound || result.Coverage.CompleteWindow || result.Volume.Works != 0 || result.Volume.Connections != 0 {
		t.Fatalf("desktop SQL omitted interruption uncertainty: %+v %v", result, err)
	}
}

func TestCommandAndDockerConnectionsShareObservationAndShutdown(t *testing.T) {
	for _, action := range []string{"command_connect", "docker_connect"} {
		t.Run(action, func(t *testing.T) {
			tasks, _ := desktopTaskFixture(t)
			activity := &ActivityLogService{db: tasks.db}
			server, config, _ := desktopFileSSHPeer(t)
			service := NewDesktopServerService(activity, tasks)
			_, closeClient, err := dialDesktopObservedSSH(context.Background(), &service.desktopOperationRegistry, activity, server, config, time.Second, action, "manual")
			if err != nil {
				t.Fatal(err)
			}
			defer closeClient()
			if err = service.ServiceShutdown(); err != nil {
				t.Fatal(err)
			}
			var status, finished string
			if err = tasks.db.QueryRow(`SELECT status,finished_at FROM desktop_connections WHERE action=?`, action).Scan(&status, &finished); err != nil || status != "success" || finished == "" {
				t.Fatalf("shutdown lost connection outcome: %s %s %v", status, finished, err)
			}
			if _, err = service.database(); err == nil {
				t.Fatal("closed service reopened database")
			}
		})
	}
}
