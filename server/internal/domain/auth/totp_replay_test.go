package auth

import (
	"context"
	"encoding/base64"
	"sync"
	"testing"
	"time"

	secretcrypto "github.com/easyssh/server/internal/pkg/crypto"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/pquerna/otp/totp"
	"gorm.io/gorm"
)

func TestVerify2FACodeConsumesTOTPOnce(t *testing.T) {
	service, database, user, secret, _ := newTwoFactorTestService(t)
	code, err := totp.GenerateCode(secret, time.Now().UTC())
	if err != nil {
		t.Fatalf("generate TOTP code: %v", err)
	}

	validCount := verifyCodeConcurrently(t, service, user.ID, code, 8)
	if validCount != 1 {
		t.Fatalf("expected exactly one successful TOTP consumption, got %d", validCount)
	}

	valid, err := service.Verify2FACode(context.Background(), user.ID, code)
	if err != nil {
		t.Fatalf("verify consumed TOTP: %v", err)
	}
	if valid {
		t.Fatal("expected consumed TOTP to be rejected")
	}
	if err := service.Disable2FA(context.Background(), user.ID, code); err == nil {
		t.Fatal("expected consumed TOTP to be rejected when disabling 2FA")
	}

	var replayCount int64
	if err := database.Model(&TOTPReplay{}).Where("user_id = ?", user.ID).Count(&replayCount).Error; err != nil {
		t.Fatalf("count TOTP replay records: %v", err)
	}
	if replayCount != 1 {
		t.Fatalf("expected one replay record, got %d", replayCount)
	}
}

func TestVerify2FACodeConsumesBackupCodeOnce(t *testing.T) {
	service, _, user, _, backupCodes := newTwoFactorTestService(t)

	validCount := verifyCodeConcurrently(t, service, user.ID, backupCodes[0], 8)
	if validCount != 1 {
		t.Fatalf("expected exactly one successful backup-code consumption, got %d", validCount)
	}

	valid, err := service.Verify2FACode(context.Background(), user.ID, backupCodes[0])
	if err != nil {
		t.Fatalf("verify consumed backup code: %v", err)
	}
	if valid {
		t.Fatal("expected consumed backup code to be rejected")
	}
}

func newTwoFactorTestService(t *testing.T) (*authService, *gorm.DB, *User, string, []string) {
	t.Helper()

	database, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatalf("get database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.AutoMigrate(&User{}, &TOTPReplay{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}

	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	encodedKey := base64.StdEncoding.EncodeToString(key)
	t.Setenv("ENCRYPTION_KEY", encodedKey)
	encryptor, err := secretcrypto.NewEncryptor(encodedKey)
	if err != nil {
		t.Fatalf("create encryptor: %v", err)
	}

	repository := NewRepository(database)
	service := NewService(repository, nil, encryptor).(*authService)
	user := &User{
		ID:               uuid.New(),
		Username:         "totp-replay-test",
		Email:            uuid.NewString() + "@example.com",
		Role:             RoleUser,
		TwoFactorEnabled: true,
	}
	if err := user.SetPassword("Acceptance-2026-Only9"); err != nil {
		t.Fatalf("set password: %v", err)
	}
	secret, _, err := service.totpService.GenerateSecret(user.Username)
	if err != nil {
		t.Fatalf("generate TOTP secret: %v", err)
	}
	user.TwoFactorSecret, err = service.encryptUserSecret(user.ID, "two_factor_secret", secret)
	if err != nil {
		t.Fatalf("encrypt TOTP secret: %v", err)
	}
	backupCodes, err := service.totpService.GenerateBackupCodes()
	if err != nil {
		t.Fatalf("generate backup codes: %v", err)
	}
	user.BackupCodes, err = HashBackupCodes(backupCodes)
	if err != nil {
		t.Fatalf("hash backup codes: %v", err)
	}
	if err := repository.Create(context.Background(), user); err != nil {
		t.Fatalf("create user: %v", err)
	}
	return service, database, user, secret, backupCodes
}

func verifyCodeConcurrently(t *testing.T, service *authService, userID uuid.UUID, code string, workers int) int {
	t.Helper()

	start := make(chan struct{})
	results := make(chan bool, workers)
	errors := make(chan error, workers)
	var waitGroup sync.WaitGroup
	for range workers {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-start
			valid, err := service.Verify2FACode(context.Background(), userID, code)
			if err != nil {
				errors <- err
				return
			}
			results <- valid
		}()
	}
	close(start)
	waitGroup.Wait()
	close(results)
	close(errors)
	for err := range errors {
		t.Errorf("verify code: %v", err)
	}
	validCount := 0
	for valid := range results {
		if valid {
			validCount++
		}
	}
	return validCount
}
