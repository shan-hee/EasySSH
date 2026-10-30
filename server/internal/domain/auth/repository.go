package auth

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInvalidInput         = errors.New("invalid owner input")
	ErrOwnerNotFound        = errors.New("owner is not initialized")
	ErrInitialized          = errors.New("owner is already initialized")
	ErrInvalidCredentials   = errors.New("invalid credentials")
	ErrSessionNotFound      = errors.New("session not found or revoked")
	ErrSessionExpired       = errors.New("session expired")
	ErrIPLocked             = errors.New("source address temporarily locked")
	ErrAccountLocked        = errors.New("owner login temporarily locked")
	ErrTwoFactorRequired    = errors.New("two-factor code required")
	ErrInvalidTwoFactorCode = errors.New("invalid two-factor code")
)

type Repository interface {
	Get(context.Context) (*Owner, error)
	Create(context.Context, *Owner) error
	FindByID(context.Context, uuid.UUID) (*Owner, error)
	FindByEmail(context.Context, string) (*Owner, error)
	Update(context.Context, *Owner) error
	ConsumeTwoFactorCounter(context.Context, uuid.UUID, int64) (bool, error)
	ClearTwoFactorCounters(context.Context, uuid.UUID) error
	ConsumeBackupCodes(context.Context, uuid.UUID, string, string) (bool, error)
}

type gormRepository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) Repository { return &gormRepository{db: db} }
func (r *gormRepository) Get(ctx context.Context) (*Owner, error) {
	var owner Owner
	err := r.db.WithContext(ctx).Where("slot = 1").First(&owner).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrOwnerNotFound
	}
	return &owner, err
}
func (r *gormRepository) FindByID(ctx context.Context, id uuid.UUID) (*Owner, error) {
	owner, err := r.Get(ctx)
	if err != nil {
		return nil, err
	}
	if owner.ID != id {
		return nil, ErrOwnerNotFound
	}
	return owner, nil
}
func (r *gormRepository) FindByEmail(ctx context.Context, email string) (*Owner, error) {
	owner, err := r.Get(ctx)
	if err != nil {
		return nil, err
	}
	if owner.Email != email {
		return nil, ErrOwnerNotFound
	}
	return owner, nil
}
func (r *gormRepository) Create(ctx context.Context, owner *Owner) error {
	owner.Slot = 1
	return r.db.WithContext(ctx).Create(owner).Error
}
func (r *gormRepository) Update(ctx context.Context, owner *Owner) error {
	// Callers use explicit updates for credentials and session state. This method
	// supports account-lock state only, avoiding stale profile writes to secrets.
	return r.db.WithContext(ctx).Model(&Owner{}).Where("id = ? AND slot = 1", owner.ID).Updates(map[string]any{
		"failed_login_attempts": owner.FailedLoginAttempts, "last_failed_login": owner.LastFailedLogin,
		"locked_until": owner.LockedUntil, "lock_reason": owner.LockReason,
	}).Error
}
func (r *gormRepository) ConsumeTwoFactorCounter(ctx context.Context, id uuid.UUID, counter int64) (bool, error) {
	result := r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&TOTPReplay{OwnerID: id, Counter: counter, UsedAt: time.Now().UTC()})
	return result.RowsAffected == 1, result.Error
}
func (r *gormRepository) ClearTwoFactorCounters(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Where("owner_id = ?", id).Delete(&TOTPReplay{}).Error
}
func (r *gormRepository) ConsumeBackupCodes(ctx context.Context, id uuid.UUID, current, updated string) (bool, error) {
	result := r.db.WithContext(ctx).Model(&Owner{}).Where("id = ? AND backup_codes = ?", id, current).Update("backup_codes", updated)
	return result.RowsAffected == 1, result.Error
}
