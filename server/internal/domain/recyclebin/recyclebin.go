// Package recyclebin keeps a copy of deleted servers, scripts and AI sessions
// until the retention period for deleted data passes. Deleting still removes
// the record from its own tables; the copy here is what restoring writes back.
//
// A payload holds exactly what the deleted rows held, so secrets in it are the
// same ciphertext the live tables stored.
package recyclebin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	KindServer    = "server"
	KindScript    = "script"
	KindAISession = "ai_session"
)

var ErrNotFound = errors.New("recycle bin entry not found")

// ErrExists reports that a record with the entry's ID is present again.
var ErrExists = errors.New("a record with this ID already exists")

type Entry struct {
	ID         uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	Kind       string    `gorm:"size:20;not null;index:idx_recycle_bin_resource,priority:1" json:"kind"`
	ResourceID string    `gorm:"size:36;not null;index:idx_recycle_bin_resource,priority:2" json:"resource_id"`
	Name       string    `gorm:"size:255;not null" json:"name"`
	Payload    string    `gorm:"type:text;not null" json:"-"`
	RemovedAt  time.Time `gorm:"not null;index" json:"removed_at"`
}

func (Entry) TableName() string { return "recycle_bin" }

// Put records a deletion inside the transaction that performs it. A record
// deleted again after being restored replaces its earlier copy.
func Put(tx *gorm.DB, kind, resourceID, name string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if err = tx.Where("kind = ? AND resource_id = ?", kind, resourceID).Delete(&Entry{}).Error; err != nil {
		return err
	}
	if len(name) > 255 {
		name = name[:255]
	}
	return tx.Create(&Entry{ID: uuid.New(), Kind: kind, ResourceID: resourceID, Name: name, Payload: string(data), RemovedAt: time.Now().UTC()}).Error
}

// Decode reads an entry's payload into the type its kind stores.
func Decode(entry Entry, payload any) error {
	if err := json.Unmarshal([]byte(entry.Payload), payload); err != nil {
		return fmt.Errorf("recycle bin entry is unreadable: %w", err)
	}
	return nil
}

// Restorer writes one kind of record back from its entry.
type Restorer func(tx *gorm.DB, entry Entry) error

type Service struct {
	DB        *gorm.DB
	Restorers map[string]Restorer
	// Wrap runs a restore under whatever lock the kind needs outside the transaction.
	Wrap func(kind string, run func() error) error
}

func (s *Service) List(ctx context.Context) ([]Entry, error) {
	entries := []Entry{}
	err := s.DB.WithContext(ctx).Select("id", "kind", "resource_id", "name", "removed_at").Order("removed_at DESC").Find(&entries).Error
	return entries, err
}

// Restore writes the record back under its original ID and removes the entry.
func (s *Service) Restore(ctx context.Context, id uuid.UUID) (Entry, error) {
	var entry Entry
	if err := s.DB.WithContext(ctx).First(&entry, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return entry, ErrNotFound
		}
		return entry, err
	}
	restore := s.Restorers[entry.Kind]
	if restore == nil {
		return entry, fmt.Errorf("recycle bin cannot restore %q", entry.Kind)
	}
	run := func() error {
		return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := restore(tx, entry); err != nil {
				return err
			}
			result := tx.Delete(&Entry{}, "id = ?", entry.ID)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrNotFound
			}
			return nil
		})
	}
	if s.Wrap != nil {
		return entry, s.Wrap(entry.Kind, run)
	}
	return entry, run()
}

// Delete discards an entry for good.
func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	result := s.DB.WithContext(ctx).Delete(&Entry{}, "id = ?", id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// Purge discards entries removed before the retention cutoff.
func (s *Service) Purge(ctx context.Context, before time.Time) (int64, error) {
	result := s.DB.WithContext(ctx).Where("removed_at < ?", before).Delete(&Entry{})
	return result.RowsAffected, result.Error
}
