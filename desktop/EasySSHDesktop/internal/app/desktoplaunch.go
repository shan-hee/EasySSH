package app

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/easyssh/easyssh-desktop/internal/accesslink"
	"github.com/easyssh/shared/instanceactivation"
	"github.com/google/uuid"
)

// The OS launch mechanism has no local-owner authority. Store its validated
// public hint until the local owner renderer chooses to bind the receiver.
type DesktopIncomingLaunch struct {
	ID        string    `json:"id"`
	Origin    string    `json:"origin"`
	HandoffID string    `json:"handoff_id"`
	ExpiresAt time.Time `json:"expires_at"`
}

type desktopIncomingLaunch struct {
	DesktopIncomingLaunch
	dismissed bool
}

func desktopLaunchArgument(args []string) (string, error) {
	var result string
	for _, arg := range args {
		if !strings.HasPrefix(strings.ToLower(arg), "easyssh:") {
			continue
		}
		if result != "" {
			return "", errors.New("multiple desktop launch URLs")
		}
		if _, err := accesslink.ParseDesktopLaunch(arg); err != nil {
			return "", err
		}
		result = arg
	}
	return result, nil
}

func validateDesktopLaunch(raw string) error {
	if raw == "" {
		return nil
	}
	_, err := accesslink.ParseDesktopLaunch(raw)
	return err
}

func (s *DesktopRemoteWorkspaceService) receiveLaunch(raw string, expires time.Time) error {
	if err := s.ctx.Err(); err != nil {
		return err
	}
	if raw == "" {
		return nil
	}
	launch, err := accesslink.ParseDesktopLaunch(raw)
	if err != nil {
		return err
	}
	now := time.Now()
	if expires.IsZero() || expires.After(now.Add(2*time.Minute)) {
		expires = now.Add(2 * time.Minute)
	}
	if !expires.After(now) {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("desktop shutting down")
	}
	s.pruneIncomingLocked(now)
	for _, existing := range s.incoming {
		if existing.Origin == launch.Origin && existing.HandoffID == launch.HandoffID {
			return nil
		}
	}
	if len(s.incoming) >= 16 {
		return remoteError("launch_capacity_reached")
	}
	value := desktopIncomingLaunch{DesktopIncomingLaunch: DesktopIncomingLaunch{uuid.NewString(), launch.Origin, launch.HandoffID, expires}}
	s.incoming[value.ID] = value
	return nil
}

func (s *DesktopRemoteWorkspaceService) pruneIncomingLocked(now time.Time) {
	for id, value := range s.incoming {
		if !value.ExpiresAt.After(now) {
			delete(s.incoming, id)
		}
	}
}

// PendingLaunches is a pull API so requests arriving before the UI subscribes
// are not lost. Only the registered local owner window may read the inbox.
func (s *DesktopRemoteWorkspaceService) PendingLaunches(ctx context.Context) ([]DesktopIncomingLaunch, error) {
	if err := s.requireOwner(ctx); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneIncomingLocked(time.Now())
	result := make([]DesktopIncomingLaunch, 0, len(s.incoming))
	for _, value := range s.incoming {
		if !value.dismissed {
			result = append(result, value.DesktopIncomingLaunch)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ExpiresAt.Before(result[j].ExpiresAt) })
	return result, nil
}

func (s *DesktopRemoteWorkspaceService) DismissLaunch(ctx context.Context, id string) error {
	if err := s.requireOwner(ctx); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if value, ok := s.incoming[id]; ok {
		value.dismissed = true
		s.incoming[id] = value
	}
	return nil
}

// PendingHandoffs lets a reloaded owner UI recover the confirmation display.
// The verifier remains in Go memory and is never included in this response.
func (s *DesktopRemoteWorkspaceService) PendingHandoffs(ctx context.Context) ([]DesktopHandoffPending, error) {
	if err := s.requireOwner(ctx); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]DesktopHandoffPending, 0, len(s.handoffs))
	for id, value := range s.handoffs {
		if !value.expires.After(time.Now()) {
			delete(s.handoffs, id)
			continue
		}
		result = append(result, DesktopHandoffPending{id, value.origin, value.confirmation, value.expires})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ExpiresAt.Before(result[j].ExpiresAt) })
	return result, nil
}

// Polling acknowledges only requests retained by the child. The next request
// repeats acknowledgements after a lost response; the launcher keeps tombstones.
func (s *DesktopRemoteWorkspaceService) receiveLauncherRequests(ctx context.Context, launcher *instanceactivation.Client, show func()) {
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(s.ctx, cancel)
	defer func() { stop(); cancel() }()
	if !waitForDesktopActivation(ctx) {
		return
	}
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	var acknowledged []string
	for {
		messages, err := launcher.Launches(ctx, acknowledged)
		if err == nil {
			acknowledged = acknowledged[:0]
			for _, message := range messages {
				if !message.ExpiresAt.After(time.Now()) {
					acknowledged = append(acknowledged, message.ID)
					continue
				}
				if s.receiveLaunch(message.URL, message.ExpiresAt) == nil {
					acknowledged = append(acknowledged, message.ID)
					show()
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
