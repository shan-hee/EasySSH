package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func (s *Service) consumeTwoFactor(ctx context.Context, tx *gorm.DB, owner *Owner, code string) (bool, error) {
	secret, err := s.decryptOwnerSecret(owner.ID, "two_factor_secret", owner.TwoFactorSecret)
	if err != nil {
		return false, err
	}
	repo := NewRepository(tx)
	if counter, valid := s.totpService.ValidateCode(secret, code); valid {
		return repo.ConsumeTwoFactorCounter(ctx, owner.ID, counter)
	}
	if owner.BackupCodes == "" {
		return false, nil
	}
	valid, updated, err := s.totpService.VerifyBackupCode(owner.BackupCodes, code)
	if err != nil || !valid {
		return false, err
	}
	return repo.ConsumeBackupCodes(ctx, owner.ID, owner.BackupCodes, updated)
}
func (s *Service) Generate2FASecret(ctx context.Context, id uuid.UUID, password string) (string, string, error) {
	if err := s.requireOwner(ctx, id); err != nil {
		return "", "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	owner, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return "", "", err
	}
	if owner.TwoFactorEnabled {
		return "", "", fmt.Errorf("%w: two-factor authentication is already enabled", ErrInvalidInput)
	}
	if !owner.CheckPassword(password) {
		return "", "", ErrInvalidCredentials
	}
	secret, uri, err := s.totpService.GenerateSecret(owner.Email)
	if err != nil {
		return "", "", err
	}
	ciphertext, err := s.encryptOwnerSecret(id, "pending_two_factor_secret", secret)
	if err != nil {
		return "", "", err
	}
	err = s.db.WithContext(ctx).Model(&Owner{}).Where("id = ?", id).Updates(map[string]any{"pending_two_factor_secret": ciphertext, "pending_two_factor_expires_at": time.Now().UTC().Add(10 * time.Minute)}).Error
	if err != nil {
		return "", "", err
	}
	return secret, uri, nil
}
func (s *Service) Enable2FA(ctx context.Context, id uuid.UUID, code string) ([]string, error) {
	if err := s.requireOwner(ctx, id); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	current, err := uuid.Parse(access.Current(ctx).Actor().SessionID)
	if err != nil {
		return nil, err
	}
	var sessions []Session
	var codes []string
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var owner Owner
		if err := tx.Where("id = ? AND slot = 1", id).First(&owner).Error; err != nil {
			return err
		}
		if owner.TwoFactorEnabled || owner.PendingTwoFactorExpiresAt == nil || !time.Now().Before(*owner.PendingTwoFactorExpiresAt) {
			return ErrInvalidTwoFactorCode
		}
		secret, err := s.decryptOwnerSecret(id, "pending_two_factor_secret", owner.PendingTwoFactorSecret)
		if err != nil {
			return err
		}
		counter, valid := s.totpService.ValidateCode(secret, code)
		if !valid {
			return ErrInvalidTwoFactorCode
		}
		ciphertext, err := s.encryptOwnerSecret(id, "two_factor_secret", secret)
		if err != nil {
			return err
		}
		codes, err = s.totpService.GenerateBackupCodes()
		if err != nil {
			return err
		}
		hashed, err := HashBackupCodes(codes, s.backupCodeKey)
		if err != nil {
			return err
		}
		repo := NewRepository(tx)
		if err := repo.ClearTwoFactorCounters(ctx, id); err != nil {
			return err
		}
		consumed, err := repo.ConsumeTwoFactorCounter(ctx, id, counter)
		if err != nil {
			return err
		}
		if !consumed {
			return ErrInvalidTwoFactorCode
		}
		if err := tx.Model(&Owner{}).Where("id = ?", id).Updates(map[string]any{"two_factor_enabled": true, "two_factor_secret": ciphertext, "backup_codes": hashed, "pending_two_factor_secret": "", "pending_two_factor_expires_at": nil}).Error; err != nil {
			return err
		}
		sessions, err = revokeOtherSessions(tx, id, current)
		if err != nil {
			return err
		}
		return recordOwnerChange(tx, "security_update", "owner", id, []string{"two_factor_enabled", "backup_codes"})
	})
	if err != nil {
		return nil, err
	}
	for _, session := range sessions {
		s.runtime.Invalidate("", session.ID.String(), "", access.ErrRevoked)
	}
	return codes, nil
}
func (s *Service) Disable2FA(ctx context.Context, id uuid.UUID, code string) error {
	if err := s.requireOwner(ctx, id); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var owner Owner
		if err := tx.Where("id = ? AND slot = 1", id).First(&owner).Error; err != nil {
			return err
		}
		if !owner.TwoFactorEnabled {
			return fmt.Errorf("%w: two-factor authentication is not enabled", ErrInvalidInput)
		}
		valid, err := s.consumeTwoFactor(ctx, tx, &owner, code)
		if err != nil {
			return err
		}
		if !valid {
			return ErrInvalidTwoFactorCode
		}
		if err := tx.Model(&Owner{}).Where("id = ?", id).Updates(map[string]any{"two_factor_enabled": false, "two_factor_secret": "", "backup_codes": "", "pending_two_factor_secret": "", "pending_two_factor_expires_at": nil}).Error; err != nil {
			return err
		}
		if err := NewRepository(tx).ClearTwoFactorCounters(ctx, id); err != nil {
			return err
		}
		return recordOwnerChange(tx, "security_update", "owner", id, []string{"two_factor_enabled", "backup_codes"})
	})
}
