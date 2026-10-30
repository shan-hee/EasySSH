package operationrecord

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type RequestMetadata struct {
	Username  string
	IP        string
	UserAgent string
}

type requestMetadataKey struct{}

// WithRequestMetadata preserves request audit attribution when a mutation
// writes its successful fact inside the database transaction.
func WithRequestMetadata(ctx context.Context, metadata RequestMetadata) context.Context {
	return context.WithValue(ctx, requestMetadataKey{}, metadata)
}

// ConfigurationChange contains metadata only. Callers supply changed field
// names, never before/after values, passwords or private keys.
type ConfigurationChange struct {
	Action       string
	ResourceKind string
	ResourceID   string
	Name         string
	Source       string
	Fields       []string
	Resources    []ResourceSnapshot
}

// RecordConfiguration belongs to the caller's mutation transaction. A failed
// projection must roll back the configuration as well; it is not an async event.
func RecordConfiguration(tx *gorm.DB, actor protocol.Actor, change ConfigurationChange) error {
	if !actor.Valid() || change.Action == "" || change.ResourceKind == "" || change.ResourceID == "" || (change.Source != "manual" && change.Source != "automation") {
		return errors.New("invalid configuration activity")
	}
	detail, err := json.Marshal(struct {
		ResourceKind  string   `json:"resource_kind"`
		ResourceID    string   `json:"resource_id"`
		ChangedFields []string `json:"changed_fields"`
	}{change.ResourceKind, change.ResourceID, change.Fields})
	if err != nil {
		return err
	}
	id, now := uuid.New(), time.Now().UTC()
	metadata, _ := tx.Statement.Context.Value(requestMetadataKey{}).(RequestMetadata)
	record := &OperationRecord{
		ID: id, Actor: actor, Type: TypeAudit, Category: CategoryAudit,
		Username: metadata.Username, IP: metadata.IP, UserAgent: metadata.UserAgent,
		WorkID: id, WorkStartedAt: now, Attempt: 1, Action: change.Action,
		Status: StatusSuccess, Resource: change.Name, Source: change.Source,
		SourceTable: "configuration_changes", SourceID: id.String(),
		StartedAt: &now, FinishedAt: &now, CreatedAt: now,
		TotalCount: 1, SuccessCount: 1, DetailJSON: string(detail), Resources: change.Resources,
	}
	if change.ResourceKind == "server" && len(change.Resources) == 1 {
		resource := change.Resources[0]
		record.ServerID, record.ServerName = &resource.ServerID, resource.Name
	}
	return NewRepository(tx, nil).Upsert(tx.Statement.Context, record)
}
