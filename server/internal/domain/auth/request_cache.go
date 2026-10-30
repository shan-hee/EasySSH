package auth

import (
	"context"
	"sync"
	"time"

	"github.com/easyssh/server/internal/access"
)

type ownerRequestCacheKey struct{}

type ownerRequestCache struct {
	mu       sync.Mutex
	service  *Service
	closed   bool
	sessions map[string]*Session
}

// RequestContext reuses successful session validation within one HTTP request.
// Closing it also disables reuse by goroutines retaining a derived context.
func (s *Service) RequestContext(ctx context.Context) (context.Context, func()) {
	cache := &ownerRequestCache{service: s, sessions: make(map[string]*Session)}
	return context.WithValue(ctx, ownerRequestCacheKey{}, cache), func() {
		cache.mu.Lock()
		cache.closed = true
		cache.sessions = nil
		cache.mu.Unlock()
	}
}

func withoutSessionCache(ctx context.Context) context.Context {
	return context.WithValue(ctx, ownerRequestCacheKey{}, (*ownerRequestCache)(nil))
}

func (s *Service) session(ctx context.Context, id string) (*Session, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	cache, _ := ctx.Value(ownerRequestCacheKey{}).(*ownerRequestCache)
	if cache == nil || cache.service != s {
		return s.loadSession(ctx, id)
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if cache.closed {
		return s.loadSession(ctx, id)
	}
	if row := cache.sessions[id]; row != nil {
		if !time.Now().Before(row.ExpiresAt) {
			return nil, access.ErrExpired
		}
		return row, nil
	}
	row, err := s.loadSession(ctx, id)
	if err == nil {
		cache.sessions[id] = row
	}
	return row, err
}

func (s *Service) rememberSession(ctx context.Context, row *Session) {
	cache, _ := ctx.Value(ownerRequestCacheKey{}).(*ownerRequestCache)
	if cache == nil || cache.service != s {
		return
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if !cache.closed {
		copy := *row
		cache.sessions[row.ID.String()] = &copy
	}
}
