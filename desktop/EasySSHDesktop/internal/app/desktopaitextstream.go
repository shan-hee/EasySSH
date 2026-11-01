package app

import (
	"sync"
	"time"

	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/protocol"
)

// Batch provider tokens before crossing the native bridge, keeping the first
// token immediate and each event within the existing wire size limit.
type desktopAITextStream struct {
	mu      sync.Mutex
	timer   *time.Timer
	pending *protocol.AITextDelta
	closed  bool
	emit    func(protocol.AITextDelta)
}

const desktopAITextFrameInterval = 16 * time.Millisecond

func (s *desktopAITextStream) Push(delta protocol.AITextDelta) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if s.timer == nil {
		s.emit(delta)
		s.timer = time.AfterFunc(desktopAITextFrameInterval, s.tick)
		return
	}
	if previous := s.pending; previous != nil {
		if previous.MessageID == delta.MessageID && previous.Kind == delta.Kind &&
			previous.NextOffset == delta.Offset && len(previous.Text)+len(delta.Text) <= aiwire.MaxTextDeltaBytes {
			previous.Text += delta.Text
			previous.NextOffset = delta.NextOffset
			return
		}
		// Preserve reasoning/text boundaries and bounded event payloads.
		s.flushLocked()
	}
	s.pending = &delta
}

func (s *desktopAITextStream) tick() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if s.pending == nil {
		s.timer = nil
		return
	}
	s.flushLocked()
	s.timer = time.AfterFunc(desktopAITextFrameInterval, s.tick)
}

func (s *desktopAITextStream) flushLocked() {
	if s.pending != nil {
		s.emit(*s.pending)
		s.pending = nil
	}
}

// Close delivers the tail before the turn publishes its final history/status.
func (s *desktopAITextStream) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	s.flushLocked()
}
