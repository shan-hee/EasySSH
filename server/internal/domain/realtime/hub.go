package realtime

import (
	"context"
	"encoding/json"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"sync"
	"time"
)

const subscriberBuffer = 32

type Event struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	CreatedAt time.Time       `json:"created_at"`
}
type subscriber struct {
	actor   protocol.Actor
	owner   bool
	channel chan Event
}
type Hub struct {
	mu          sync.RWMutex
	nextID      uint64
	subscribers map[uint64]subscriber
}

func NewHub() *Hub { return &Hub{subscribers: make(map[uint64]subscriber)} }

type Subscription struct {
	Events      <-chan Event
	lease       *access.Lease
	unsubscribe func()
}

func (s *Subscription) Context() context.Context { return s.lease.Context() }
func (s *Subscription) Close()                   { s.unsubscribe(); s.lease.Close(nil) }

func (h *Hub) Subscribe(ctx context.Context) (*Subscription, error) {
	scope := access.Current(ctx)
	lease, err := scope.OpenWork(ctx, access.Task, access.Requirement{Action: protocol.WorkspaceRead})
	if err != nil {
		return nil, err
	}
	channel := make(chan Event, subscriberBuffer)
	h.mu.Lock()
	h.nextID++
	id := h.nextID
	h.subscribers[id] = subscriber{actor: scope.Actor(), owner: scope.RequireOwner(ctx, protocol.ActivityRead) == nil, channel: channel}
	h.mu.Unlock()
	var once sync.Once
	unsubscribe := func() { once.Do(func() { h.mu.Lock(); delete(h.subscribers, id); h.mu.Unlock() }) }
	context.AfterFunc(lease.Context(), unsubscribe)
	return &Subscription{Events: channel, lease: lease, unsubscribe: unsubscribe}, nil
}

// Publish sends work changes to their exact actor and the workspace owner.
// Owner preferences/notifications use PublishOwner; no guessed owner ID is needed.
func (h *Hub) Publish(actor protocol.Actor, eventType string, payload any) {
	if !actor.Valid() {
		return
	}
	h.publish(actor, eventType, payload)
}
func (h *Hub) PublishOwner(eventType string, payload any) {
	h.publish(protocol.Actor{}, eventType, payload)
}
func (h *Hub) publish(actor protocol.Actor, eventType string, payload any) {
	if h == nil || eventType == "" {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	event := Event{ID: uuid.NewString(), Type: eventType, Data: data, CreatedAt: time.Now().UTC()}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, sub := range h.subscribers {
		if !sub.owner && (!actor.Valid() || sub.actor != actor) {
			continue
		}
		select {
		case sub.channel <- event:
		default:
		}
	}
}
