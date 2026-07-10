package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type DesktopNotification struct {
	ID         string `json:"id"`
	EventType  string `json:"event_type"`
	Severity   string `json:"severity"`
	Title      string `json:"title"`
	Message    string `json:"message"`
	SourceType string `json:"source_type,omitempty"`
	SourceID   string `json:"source_id,omitempty"`
	ActionURL  string `json:"action_url,omitempty"`
	ReadAt     string `json:"read_at,omitempty"`
	CreatedAt  string `json:"created_at"`
}

type DesktopNotificationList struct {
	Notifications []DesktopNotification `json:"notifications"`
	UnreadCount   int                   `json:"unread_count"`
}

type DesktopNotificationService struct {
	mu   sync.Mutex
	tray *application.SystemTray
}

func NewDesktopNotificationService() *DesktopNotificationService {
	return &DesktopNotificationService{}
}

func (s *DesktopNotificationService) List(limit int) (DesktopNotificationList, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := readDesktopNotifications()
	if err != nil {
		return DesktopNotificationList{}, err
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt > items[j].CreatedAt })
	unread := 0
	for _, item := range items {
		if item.ReadAt == "" {
			unread++
		}
	}
	if len(items) > limit {
		items = items[:limit]
	}
	return DesktopNotificationList{Notifications: items, UnreadCount: unread}, nil
}

func (s *DesktopNotificationService) MarkRead(id string) error {
	return s.update(func(items []DesktopNotification) []DesktopNotification {
		for index := range items {
			if items[index].ID == id && items[index].ReadAt == "" {
				items[index].ReadAt = time.Now().UTC().Format(time.RFC3339Nano)
			}
		}
		return items
	})
}

func (s *DesktopNotificationService) MarkAllRead() error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	return s.update(func(items []DesktopNotification) []DesktopNotification {
		for index := range items {
			if items[index].ReadAt == "" {
				items[index].ReadAt = now
			}
		}
		return items
	})
}

func (s *DesktopNotificationService) Delete(id string) error {
	return s.update(func(items []DesktopNotification) []DesktopNotification {
		filtered := items[:0]
		for _, item := range items {
			if item.ID != id {
				filtered = append(filtered, item)
			}
		}
		return filtered
	})
}

func (s *DesktopNotificationService) Publish(eventType, severity, title, message, actionURL string) error {
	return s.publishLinked(eventType, severity, title, message, actionURL, "", "")
}

func (s *DesktopNotificationService) publishLinked(eventType, severity, title, message, actionURL, sourceType, sourceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := readDesktopNotifications()
	if err != nil {
		return err
	}
	if strings.TrimSpace(severity) == "" {
		severity = "info"
	}
	items = append(items, DesktopNotification{
		ID: uuid.NewString(), EventType: eventType, Severity: severity, Title: title, Message: message,
		SourceType: sourceType, SourceID: sourceID, ActionURL: actionURL, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if len(items) > 500 {
		items = items[len(items)-500:]
	}
	if err := writeDesktopNotifications(items); err != nil {
		return err
	}
	s.updateTrayTooltipLocked(items)
	return nil
}

func (s *DesktopNotificationService) deleteBySourceIDs(sourceType string, sourceIDs []string) (int64, error) {
	sourceType = strings.TrimSpace(sourceType)
	if sourceType == "" || len(sourceIDs) == 0 {
		return 0, nil
	}
	targets := make(map[string]struct{}, len(sourceIDs))
	for _, sourceID := range sourceIDs {
		if sourceID = strings.TrimSpace(sourceID); sourceID != "" {
			targets[sourceID] = struct{}{}
		}
	}
	var deleted int64
	err := s.update(func(items []DesktopNotification) []DesktopNotification {
		filtered := items[:0]
		for _, item := range items {
			_, matchesID := targets[item.SourceID]
			if item.SourceType == sourceType && matchesID {
				deleted++
				continue
			}
			filtered = append(filtered, item)
		}
		return filtered
	})
	return deleted, err
}

func (s *DesktopNotificationService) attachTray(tray *application.SystemTray) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tray = tray
	items, _ := readDesktopNotifications()
	s.updateTrayTooltipLocked(items)
}

func (s *DesktopNotificationService) update(transform func([]DesktopNotification) []DesktopNotification) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := readDesktopNotifications()
	if err != nil {
		return err
	}
	items = transform(items)
	if err := writeDesktopNotifications(items); err != nil {
		return err
	}
	s.updateTrayTooltipLocked(items)
	return nil
}

func (s *DesktopNotificationService) updateTrayTooltipLocked(items []DesktopNotification) {
	if s.tray == nil {
		return
	}
	unread := 0
	for _, item := range items {
		if item.ReadAt == "" {
			unread++
		}
	}
	tooltip := "EasySSH"
	if unread > 0 {
		tooltip += " · " + desktopNotificationCount(unread)
	}
	s.tray.SetTooltip(tooltip)
}

func desktopNotificationCount(count int) string {
	return "未读通知 " + strconv.Itoa(count)
}

func desktopNotificationsPath() string { return filepath.Join(desktopDataDir(), "notifications.json") }

func readDesktopNotifications() ([]DesktopNotification, error) {
	data, err := os.ReadFile(desktopNotificationsPath())
	if errors.Is(err, os.ErrNotExist) {
		return []DesktopNotification{}, nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return []DesktopNotification{}, nil
	}
	var items []DesktopNotification
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func writeDesktopNotifications(items []DesktopNotification) error {
	data, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return err
	}
	path := desktopNotificationsPath()
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err == nil {
		return nil
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}
