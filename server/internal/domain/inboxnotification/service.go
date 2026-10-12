package inboxnotification

import (
	"context"
	"github.com/easyssh/server/internal/domain/realtime"
	"github.com/google/uuid"
)

type Service interface {
	Create(context.Context, *Notification) error
	List(context.Context, *ListRequest) (*ListResponse, error)
	MarkRead(context.Context, uuid.UUID, uuid.UUID) error
	MarkAllRead(context.Context, uuid.UUID) error
	Delete(context.Context, uuid.UUID, uuid.UUID) error
	ClearRead(context.Context, uuid.UUID) error
}
type service struct {
	repo   Repository
	events *realtime.Hub
}

func NewService(repo Repository, events *realtime.Hub) Service {
	return &service{repo: repo, events: events}
}
func (s *service) Create(ctx context.Context, item *Notification) error {
	if err := s.repo.Create(ctx, item); err != nil {
		return err
	}
	s.publish("notification.created", item.UserID, map[string]interface{}{"notification_id": item.ID})
	return nil
}
func (s *service) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	return s.repo.List(ctx, req)
}
func (s *service) MarkRead(ctx context.Context, userID, id uuid.UUID) error {
	if err := s.repo.MarkRead(ctx, userID, id); err != nil {
		return err
	}
	s.publish("notification.changed", userID, map[string]interface{}{"notification_id": id, "action": "read"})
	return nil
}
func (s *service) MarkAllRead(ctx context.Context, userID uuid.UUID) error {
	if err := s.repo.MarkAllRead(ctx, userID); err != nil {
		return err
	}
	s.publish("notification.changed", userID, map[string]interface{}{"action": "read_all"})
	return nil
}
func (s *service) Delete(ctx context.Context, userID, id uuid.UUID) error {
	if err := s.repo.Delete(ctx, userID, id); err != nil {
		return err
	}
	s.publish("notification.changed", userID, map[string]interface{}{"notification_id": id, "action": "delete"})
	return nil
}
func (s *service) ClearRead(ctx context.Context, userID uuid.UUID) error {
	if err := s.repo.ClearRead(ctx, userID); err != nil {
		return err
	}
	s.publish("notification.changed", userID, map[string]interface{}{"action": "clear_read"})
	return nil
}

func (s *service) publish(eventType string, userID uuid.UUID, payload interface{}) {
	if s.events != nil {
		s.events.Publish(userID, eventType, payload)
	}
}
