package content

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/domain/auditlog"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func TestActivityDetailRetentionIsolationAndReplacement(t *testing.T) {
	bodies, db, _, actor, authority := contentFixture(t)
	ctx := contentContext(t, actor, authority)
	repo := operationrecord.NewRepository(db, bodies)
	raw := strings.Repeat("操作结果\n", 10000)
	record := operationrecord.OperationRecord{Actor: actor, Type: operationrecord.TypeConnection, Status: operationrecord.StatusRunning, SourceTable: "terminal_sessions", SourceID: uuid.NewString(), DetailJSON: raw}
	if err := repo.Upsert(ctx, &record); err != nil {
		t.Fatal(err)
	}
	detail, err := repo.GetByID(ctx, record.ID)
	if err != nil || detail.DetailJSON != "" || detail.DetailContent == nil || detail.TaskContent != nil {
		t.Fatal("missing standalone body", detail, err)
	}
	ref := *detail.DetailContent
	if ref.Size != int64(len(raw)) || ref.MediaType != "text/plain; charset=utf-8" {
		t.Fatal("wrong raw body descriptor", ref)
	}
	metadata := *detail
	metadata.Title = "updated title"
	if err := repo.Upsert(ctx, &metadata); err != nil {
		t.Fatal(err)
	}
	unchanged, err := repo.GetByID(ctx, record.ID)
	if err != nil || unchanged.DetailContent == nil || *unchanged.DetailContent != ref {
		t.Fatal("metadata update discarded body", unchanged, err)
	}
	var decoded []byte
	for offset := int64(0); offset < ref.Size; {
		chunk, err := bodies.Read(ctx, ref.ID, protocol.ContentReadInput{Offset: offset, Limit: 4096, Sha256: ref.Sha256})
		if err != nil {
			t.Fatal(err)
		}
		data, err := base64.StdEncoding.DecodeString(chunk.Data)
		if err != nil {
			t.Fatal(err)
		}
		decoded = append(decoded, data...)
		offset = chunk.NextOffset
	}
	if string(decoded) != raw {
		t.Fatal("byte offsets corrupted UTF-8 detail")
	}
	list, err := repo.List(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(list)
	if strings.Contains(string(encoded), "detail_content") || strings.Contains(string(encoded), "操作结果") {
		t.Fatal("list included full detail")
	}
	foreign := actor
	foreign.ID = uuid.NewString()
	foreign.SessionID = foreign.ID
	if _, err := bodies.Reference(contentContext(t, foreign, &contentAuthority{}), ref.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("body crossed actor boundary", err)
	}
	if err := repo.RecoverInterrupted(ctx); err != nil {
		t.Fatal(err)
	}
	recovered, err := repo.GetByID(ctx, record.ID)
	if err != nil || recovered.Status != operationrecord.StatusUnknown || recovered.DetailJSON != "" || recovered.DetailContent == nil || *recovered.DetailContent != ref {
		t.Fatal("recovery overwrote the original body", recovered, err)
	}
	record.DetailJSON, record.Status = "small replacement", operationrecord.StatusSuccess
	if err := repo.Upsert(ctx, &record); err != nil {
		t.Fatal(err)
	}
	if _, err := bodies.Reference(ctx, ref.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("replaced body remained readable", err)
	}
	if err := bodies.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&Record{}).Where("id=?", ref.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("unreferenced body retained", count, err)
	}
}

func TestAuditDetailRollbackDoesNotLoseObservedText(t *testing.T) {
	bodies, db, _, actor, authority := contentFixture(t)
	ctx := contentContext(t, actor, authority)
	repo := auditlog.NewRepository(db, bodies)
	log := auditlog.AuditLog{Actor: actor, Action: "configuration_updated", Status: auditlog.StatusSuccess, Details: strings.Repeat("observed detail ", 5000)}
	if err := db.Exec(`CREATE TRIGGER reject_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.Create(ctx, &log); err == nil {
		t.Fatal("accepted failed transaction")
	}
	var count int64
	if err := db.Model(&Record{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("body metadata escaped rollback", count, err)
	}
	if err := bodies.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`DROP TRIGGER reject_activity`).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.Create(ctx, &log); err != nil {
		t.Fatal(err)
	}
	detail, err := repo.GetByID(ctx, log.ID)
	if err != nil || detail.DetailContent == nil || detail.Details != "" {
		t.Fatal("audit mapper discarded body reference", detail, err)
	}
	if err := bodies.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := bodies.Reference(ctx, detail.DetailContent.ID); err != nil {
		t.Fatal("cleanup removed retained detail", err)
	}
	if err := db.Unscoped().Delete(&operationrecord.OperationRecord{}, "id=?", log.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := bodies.Reference(ctx, detail.DetailContent.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("deleted activity remained readable", err)
	}
	if err := bodies.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
}
