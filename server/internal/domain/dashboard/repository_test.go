package dashboard

import (
	"context"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/operationrecord"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/protocol"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestOverviewPresenceUsesEstablishedConnectionsNotLastOutcome(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	if err := db.AutoMigrate(&serverdomain.Server{}, &serverdomain.ServerAuth{}, &serverdomain.ServerTag{}, &serverdomain.ServerGroup{}, &operationrecord.OperationRecord{}); err != nil {
		t.Fatal(err)
	}
	historical := serverdomain.Server{ID: uuid.New(), Host: "historical.invalid", Port: 22, Username: "owner", Status: serverdomain.StatusOnline, CountryCode: "US"}
	current := serverdomain.Server{ID: uuid.New(), Host: "current.invalid", Port: 22, Username: "owner", Status: serverdomain.StatusOffline, CountryCode: "US"}
	deleted := serverdomain.Server{ID: uuid.New(), Host: "deleted.invalid", Port: 22, Username: "owner", Status: serverdomain.StatusOnline, CountryCode: "US", DeletedAt: gorm.DeletedAt{Time: time.Now(), Valid: true}}
	for _, row := range []serverdomain.Server{historical, current, deleted} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UTC()
	actor := protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString()}
	for _, data := range []struct {
		serverID              uuid.UUID
		kind                  operationrecord.RecordType
		status                operationrecord.Status
		established, finished *time.Time
	}{
		{current.ID, operationrecord.TypeConnection, operationrecord.StatusRunning, &now, nil},
		{current.ID, operationrecord.TypeConnection, operationrecord.StatusRunning, &now, nil},
		{historical.ID, operationrecord.TypeConnection, operationrecord.StatusSuccess, &now, &now},
		{historical.ID, operationrecord.TypeConnection, operationrecord.StatusRunning, nil, nil},
		{historical.ID, operationrecord.TypeConnection, operationrecord.StatusUnknown, &now, nil},
		{historical.ID, operationrecord.TypeExecution, operationrecord.StatusRunning, &now, nil},
	} {
		row := operationrecord.OperationRecord{Actor: actor, Type: data.kind, Action: "connect", Status: data.status,
			ServerID: &data.serverID, EstablishedAt: data.established, FinishedAt: data.finished, SourceTable: "connections", SourceID: uuid.NewString()}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := &repository{db: db}
	ctx := context.Background()
	total, connected, err := repo.CountServers(ctx)
	if err != nil || total != 2 || connected != 1 {
		t.Fatalf("server counts use stale outcome or duplicate connections: %d %d %v", total, connected, err)
	}
	active, err := repo.CountActiveSessions(ctx)
	if err != nil || active != 2 {
		t.Fatalf("active sessions include unestablished/finished records: %d %v", active, err)
	}
	regions, err := repo.GetServerDistribution(ctx)
	if err != nil || len(regions) != 1 || regions[0].Count != 2 {
		t.Fatalf("region projection: %+v %v", regions, err)
	}
	for _, row := range regions[0].Servers {
		if row.Connected != (row.ID == current.ID.String()) {
			t.Fatalf("region connection state disagrees with aggregate: %+v", row)
		}
	}
}
