package app

import (
	"context"
	"testing"
	"time"
)

func TestMonitorSamplesBorrowOneTransportAndRejectConcurrentSample(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	activity := &ActivityLogService{db: tasks.db}
	server, config, accepted := desktopFileSSHPeer(t)
	server.connectionRevision = 1
	monitor := NewDesktopMonitorService(nil, activity)
	t.Cleanup(func() { _ = monitor.ServiceShutdown() })
	client, closeClient, err := dialDesktopObservedSSH(context.Background(), &monitor.desktopOperationRegistry, activity, server, config, time.Second, "monitor_connect", "automation")
	if err != nil {
		t.Fatal(err)
	}
	monitor.connections = map[string]*desktopMonitorConnection{server.ID: {client: client, close: closeClient, revision: 1}}
	for i := 0; i < 3; i++ {
		borrowed, release, err := monitor.acquireConnection(context.Background(), server)
		if err != nil || borrowed != client {
			t.Fatalf("sample did not reuse its transport: %v", err)
		}
		if _, _, err = monitor.acquireConnection(context.Background(), server); err == nil {
			t.Fatal("overlapping sample admitted")
		}
		release()
	}
	var count int
	if err = tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_connections WHERE action='monitor_connect' AND source='automation'`).Scan(&count); err != nil || count != 1 || accepted.Load() != 1 {
		t.Fatalf("sampling manufactured connections: %d %d %v", count, accepted.Load(), err)
	}
	if err = monitor.ServiceShutdown(); err != nil {
		t.Fatal(err)
	}
	if err = tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_connections WHERE finished_at=''`).Scan(&count); err != nil || count != 0 || len(monitor.operations) != 0 {
		t.Fatalf("monitor shutdown escaped observation: %d %v", count, err)
	}
	if _, _, err = monitor.acquireConnection(context.Background(), server); err == nil {
		t.Fatal("stopped monitor admitted work")
	}
}
