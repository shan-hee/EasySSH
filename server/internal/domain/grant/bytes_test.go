package grant

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"io"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type quotaTestAuthority struct {
	testutil.AccessPolicy
	service *Service
}

func (a quotaTestAuthority) Authorize(ctx context.Context, _ protocol.Actor, _ access.Requirement) error {
	return ctx.Err()
}
func (a quotaTestAuthority) CheckBytes(ctx context.Context, scope access.Scope, req access.Requirement, amount int64) error {
	return a.service.CheckBytes(ctx, scope, req, amount)
}
func (a quotaTestAuthority) ReserveBytes(ctx context.Context, scope access.Scope, req access.Requirement, amount int) (int, func(int) error, error) {
	return a.service.ReserveBytes(ctx, scope, req, amount)
}

func TestDownloadAdmissionDoesNotSpendAndDeliverySettlesActualBytes(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&Grant{}); err != nil {
		t.Fatal(err)
	}
	limit := int64(10)
	grant := Grant{ID: uuid.New(), PublicID: uuid.NewString(), Name: "download", Version: 1, DownloadLimit: &limit}
	if err := db.Create(&grant).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{db: db}
	id := uuid.NewString()
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Visitor, ID: id, SessionID: id, GrantID: grant.ID.String()}, time.Now().Add(time.Hour), quotaTestAuthority{service: svc})
	if err != nil {
		t.Fatal(err)
	}
	ctx := access.WithScope(context.Background(), scope)
	req := access.Requirement{Action: protocol.FilesDownload, ServerID: uuid.NewString()}
	for i := 0; i < 2; i++ {
		if err := scope.CheckBytes(ctx, req, 10); err != nil {
			t.Fatal(err)
		}
	}
	var persisted Grant
	if err := db.First(&persisted, "id = ?", grant.ID).Error; err != nil || persisted.DownloadedBytes != 0 {
		t.Fatal("admission consumed quota", persisted.DownloadedBytes, err)
	}
	writer, finish := access.MeterWriter(ctx, req, io.Discard)
	if n, err := writer.Write([]byte("123456")); err != nil || n != 6 {
		t.Fatal("delivery failed", n, err)
	}
	if err := finish(); err != nil {
		t.Fatal(err)
	}
	if err := finish(); err != nil {
		t.Fatal("settlement is not idempotent", err)
	}
	if err := db.First(&persisted, "id = ?", grant.ID).Error; err != nil || persisted.DownloadedBytes != 6 {
		t.Fatal("unused reservation was not refunded", persisted.DownloadedBytes, err)
	}
	if err := scope.CheckBytes(ctx, req, 5); !errors.Is(err, ErrQuota) {
		t.Fatal("over-budget artifact admitted", err)
	}
	if err := scope.CheckBytes(ctx, req, 4); err != nil {
		t.Fatal(err)
	}
	// A second download is a new delivery, even when it uses the same artifact.
	writer, finish = access.MeterWriter(ctx, req, io.Discard)
	n, err := writer.Write([]byte("12345"))
	if n != 4 || !errors.Is(err, ErrQuota) {
		t.Fatal("repeated delivery escaped quota", n, err)
	}
	if err := finish(); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&persisted, "id = ?", grant.ID).Error; err != nil || persisted.DownloadedBytes != 10 {
		t.Fatal("incorrect delivery total", persisted.DownloadedBytes, err)
	}
}
