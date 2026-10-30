package app

import (
	"context"
	"errors"
	"sync"
)

// Each service owns a registry. Persistent transports and in-flight calls both
// hold registrations until their workers and final result persistence finish.
type desktopOperationRegistry struct {
	operationMu sync.Mutex
	operationWG sync.WaitGroup
	operations  map[uint64]context.CancelFunc
	operationID uint64
	stopping    bool
}

// Registration and shutdown share a lock: Wait cannot race a new Add. The
// operation ends after its result has been handed to the task persistence layer.
func (s *desktopOperationRegistry) beginOperation(parent context.Context) (context.Context, func(), error) {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	if s.stopping {
		return nil, nil, errors.New("service is stopping")
	}
	if len(s.operations) >= 128 {
		return nil, nil, errors.New("operation capacity reached")
	}
	ctx, cancel := context.WithCancel(desktopNonNilContext(parent))
	if s.operations == nil {
		s.operations = make(map[uint64]context.CancelFunc)
	}
	s.operationID++
	id := s.operationID
	s.operations[id] = cancel
	s.operationWG.Add(1)
	var once sync.Once
	return ctx, func() {
		once.Do(func() {
			cancel()
			s.operationMu.Lock()
			delete(s.operations, id)
			s.operationMu.Unlock()
			s.operationWG.Done()
		})
	}, nil
}

func (s *desktopOperationRegistry) stopOperations() {
	s.operationMu.Lock()
	s.stopping = true
	cancels := make([]context.CancelFunc, 0, len(s.operations))
	for _, cancel := range s.operations {
		cancels = append(cancels, cancel)
	}
	s.operationMu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}
