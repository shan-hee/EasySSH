package app

import (
	"context"
	"database/sql"
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

	database, err := openDesktopDatabase()
	if err != nil {
		return nil, err
	}

	s.db = database
	return s.db, nil
}
