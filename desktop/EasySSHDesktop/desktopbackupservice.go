package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/easyssh/shared/instancebackup"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type DesktopBackupService struct {
	historyMu sync.Mutex
	history   *instancebackup.History
	mu        sync.Mutex
	db        *sql.DB
}

func NewDesktopBackupService() *DesktopBackupService { return &DesktopBackupService{} }

func (s *DesktopBackupService) ServiceName() string {
	return "DesktopBackupService"
}

func (s *DesktopBackupService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	_, err := s.database()
	return err
}

func (s *DesktopBackupService) ServiceShutdown() error {
	s.historyMu.Lock()
	if s.history != nil {
		s.history.Close()
	}
	s.historyMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return nil
	}

	err := s.db.Close()
	s.db = nil
	return err
}

func (s *DesktopBackupService) database() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db != nil {
		return s.db, nil
	}

	dataDir := desktopDataDir()
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create desktop data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "easyssh-desktop.sqlite")
	database, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}

	if err := configureDesktopDatabase(database); err != nil {
		database.Close()
		return nil, err
	}

	s.db = database
	return s.db, nil
}
