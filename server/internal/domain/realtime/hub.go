package realtime

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
)

const subscriberBuffer = 32

type Event struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	CreatedAt time.Time       `json:"created_at"`
}

type Hub struct {
	mu          sync.RWMutex
	nextID      uint64
	subscribers map[uuid.UUID]map[uint64]chan Event
}

func NewHub() *Hub {
	return &Hub{subscribers: make(map[uuid.UUID]map[uint64]chan Event)}
}

func (h *Hub) Subscribe(userID uuid.UUID) (<-chan Event, func()) {
	channel := make(chan Event, subscriberBuffer)
	h.mu.Lock()
	h.nextID++
	subscriberID := h.nextID
	if h.subscribers[userID] == nil {
		h.subscribers[userID] = make(map[uint64]chan Event)
	}
	h.subscribers[userID][subscriberID] = channel
	h.mu.Unlock()

	var once sync.Once
	return channel, func() {
		once.Do(func() {
			h.mu.Lock()
			delete(h.subscribers[userID], subscriberID)
			if len(h.subscribers[userID]) == 0 {
				delete(h.subscribers, userID)
			}
			h.mu.Unlock()
		})
	}
}

func (h *Hub) Publish(userID uuid.UUID, eventType string, payload interface{}) {
	if h == nil || userID == uuid.Nil || eventType == "" {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	event := Event{ID: uuid.NewString(), Type: eventType, Data: data, CreatedAt: time.Now().UTC()}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, subscriber := range h.subscribers[userID] {
		select {
		case subscriber <- event:
		default:
		}
	}
}
