package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"net/mail"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/security"
	secretcrypto "github.com/easyssh/shared/secretcrypto"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SessionInfo struct {
	DeviceType string
	DeviceName string
	IPAddress  string
	UserAgent  string
}
type LoginResult struct {
	Owner     *Owner   `json:"owner"`
	Session   *Session `json:"session"`
	Token     string   `json:"-"`
	CSRFToken string   `json:"csrf_token"`
}

// Service manages the single owner. Visitor and device credentials are issued
// by their own services and cannot be accepted as owner browser sessions.
type Service struct {
	db                    *gorm.DB
	repo                  Repository
	encryptor             *secretcrypto.Encryptor
	totpService           TOTPService
	backupCodeKey         []byte
	runtime               *access.Runtime
	mu                    sync.Mutex
	accountLockService    AccountLockService
	loginDetectionService LoginDetectionService
	security              security.Service
}

func NewService(db *gorm.DB, encryptor *secretcrypto.Encryptor, runtime *access.Runtime) (*Service, error) {
	if encryptor == nil || runtime == nil {
		return nil, errors.New("owner credentials and runtime are required")
	}
	key, err := encryptor.DeriveKey("backup-code-hmac", 32)
	if err != nil {
		return nil, err
	}
	return &Service{db: db, repo: NewRepository(db), encryptor: encryptor, totpService: NewTOTPService(key), backupCodeKey: key, runtime: runtime, security: security.NewService(security.NewRepository(db))}, nil
}
func (s *Service) SetAccountLockService(v AccountLockService)       { s.accountLockService = v }
func (s *Service) SetLoginDetectionService(v LoginDetectionService) { s.loginDetectionService = v }

func validOwnerProfile(name, email, timezone string) error {
	if strings.TrimSpace(name) == "" || len(name) > 50 {
		return fmt.Errorf("%w: owner name is required (maximum 50 bytes)", ErrInvalidInput)
	}
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email || len(email) > 100 {
		return fmt.Errorf("%w: invalid owner email", ErrInvalidInput)
	}
	if timezone != "" {
		if _, err := time.LoadLocation(timezone); err != nil {
			return fmt.Errorf("%w: invalid IANA timezone", ErrInvalidInput)
		}
	}
	return nil
}
func (s *Service) Initialized(ctx context.Context) (bool, error) {
	_, err := s.repo.Get(ctx)
	if errors.Is(err, ErrOwnerNotFound) {
		return false, nil
	}
	return err == nil, err
}
func (s *Service) Initialize(ctx context.Context, name, email, password string) (*Owner, error) {
	name, email = strings.TrimSpace(name), strings.ToLower(strings.TrimSpace(email))
	if err := validOwnerProfile(name, email, ""); err != nil {
		return nil, err
	}
	if err := ValidatePasswordWithDefault(password); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	exists, err := s.Initialized(ctx)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrInitialized
	}
	owner := &Owner{ID: uuid.New(), Slot: 1, Username: name, Email: email, MonitorDataSource: "easyssh"}
	if err := owner.SetPassword(password); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, owner); err != nil {
		return nil, err
	}
	return owner, nil
}
func ownerDigest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func ownerCSRF(token string) string { return ownerDigest("easyssh:owner:csrf:" + token) }
func newOwnerToken() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func (s *Service) Login(ctx context.Context, req protocol.OwnerLoginInput, info SessionInfo) (*LoginResult, error) {
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if len(req.Password) > 72 || len(req.Code) > 128 || len(req.Email) > 100 {
		return nil, ErrInvalidCredentials
	}
	if s.accountLockService != nil {
		locked, _, err := s.accountLockService.CheckIPLock(ctx, info.IPAddress)
		if err != nil {
			return nil, err
		}
		if locked {
			return nil, ErrIPLocked
		}
	}
	policy, err := s.security.Get(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	var result LoginResult
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var owner Owner
		if err := tx.Where("slot = 1").First(&owner).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInvalidCredentials
			}
			return err
		}
		if owner.IsLocked() {
			return ErrAccountLocked
		}
		if owner.Email != req.Email || !owner.CheckPassword(req.Password) {
			return ErrInvalidCredentials
		}
		if owner.TwoFactorEnabled {
			if req.Code == "" {
				return ErrTwoFactorRequired
			}
			ok, err := s.consumeTwoFactor(ctx, tx, &owner, req.Code)
			if err != nil {
				return err
			}
			if !ok {
				return ErrInvalidTwoFactorCode
			}
		}
		token, err := newOwnerToken()
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		expiry := now.Add(time.Duration(policy.SessionTimeout) * time.Minute)
		session := &Session{ID: uuid.New(), OwnerID: owner.ID, TokenHash: ownerDigest(token), CSRFHash: ownerDigest(ownerCSRF(token)),
			DeviceType: info.DeviceType, DeviceName: info.DeviceName, IPAddress: info.IPAddress, UserAgent: info.UserAgent,
			RememberLogin: req.Remember && policy.RememberLogin, LastActivity: now, CreatedAt: now, ExpiresAt: expiry}
		if err := tx.Create(session).Error; err != nil {
			return err
		}
		result = LoginResult{Owner: &owner, Session: session, Token: token, CSRFToken: ownerCSRF(token)}
		return nil
	})
	s.mu.Unlock()
	if err != nil {
		if s.accountLockService != nil && (errors.Is(err, ErrInvalidCredentials) || errors.Is(err, ErrInvalidTwoFactorCode)) {
			if _, _, recordErr := s.accountLockService.RecordFailedLogin(ctx, req.Email, info.IPAddress, info.UserAgent, "invalid_credentials"); recordErr != nil {
				return nil, recordErr
			}
		}
		return nil, err
	}
	if s.accountLockService != nil {
		_ = s.accountLockService.RecordSuccessLogin(ctx, req.Email, info.IPAddress, info.UserAgent)
	}
	if s.loginDetectionService != nil {
		fingerprint := GenerateDeviceFingerprint(info.UserAgent, "", "")
		if err := s.loginDetectionService.RecordLogin(ctx, result.Owner.ID, result.Session, fingerprint); err == nil {
			row := result.Session
			_ = s.db.WithContext(ctx).Model(&Session{}).Where("id = ? AND owner_id = ?", row.ID, row.OwnerID).Updates(map[string]any{"location": row.Location, "is_new_device": row.IsNewDevice, "is_new_location": row.IsNewLocation, "device_fingerprint": row.DeviceFingerprint}).Error
		}
	}
	return &result, nil
}

// sessionDeadline also applies a shorter current timeout to an existing session.
// Increasing the setting never revives a session whose stored deadline passed.
func sessionDeadline(row *Session, timeoutMinutes int) time.Time {
	deadline := row.LastActivity.Add(time.Duration(timeoutMinutes) * time.Minute)
	if row.ExpiresAt.Before(deadline) {
		deadline = row.ExpiresAt
	}
	return deadline
}

// Persist an observed idle expiration so a later timeout increase cannot revive it.
// Compare the read values to avoid expiring a session renewed concurrently.
func (s *Service) expireIdleSession(ctx context.Context, row *Session, deadline time.Time) error {
	result := s.db.WithContext(ctx).Model(&Session{}).
		Where("id = ? AND revoked_at IS NULL AND last_activity = ? AND expires_at = ?", row.ID, row.LastActivity, row.ExpiresAt).
		UpdateColumn("expires_at", deadline)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		s.runtime.Invalidate("", row.ID.String(), "", access.ErrExpired)
	}
	return access.ErrExpired
}

func (s *Service) loadSession(ctx context.Context, id string) (*Session, error) {
	var row Session
	if err := s.db.WithContext(ctx).Where("id = ? AND revoked_at IS NULL AND expires_at > ?", id, time.Now().UTC()).First(&row).Error; err != nil {
		return nil, access.ErrUnauthenticated
	}
	policy, err := s.security.Get(ctx)
	if err != nil {
		return nil, err
	}
	deadline := sessionDeadline(&row, policy.SessionTimeout)
	if !time.Now().Before(deadline) {
		return nil, s.expireIdleSession(ctx, &row, deadline)
	}
	row.ExpiresAt = deadline
	if _, err := s.repo.FindByID(ctx, row.OwnerID); err != nil {
		return nil, access.ErrUnauthenticated
	}
	return &row, nil
}

// Authenticate renews an unexpired owner session after checking its token and
// (for mutations) CSRF. Internal authorization checks never count as activity.
func (s *Service) Authenticate(ctx context.Context, token, csrf string, mutation bool) (access.Scope, *Session, error) {
	if token == "" || len(token) > 128 {
		return access.Scope{}, nil, access.ErrUnauthenticated
	}
	// Serialize owner renewals with owner revocations, including runtime updates.
	s.mu.Lock()
	defer s.mu.Unlock()
	policy, err := s.security.Get(ctx)
	if err != nil {
		return access.Scope{}, nil, err
	}
	var row Session
	if err := s.db.WithContext(ctx).Where("token_hash = ? AND revoked_at IS NULL AND expires_at > ?", ownerDigest(token), time.Now().UTC()).First(&row).Error; err != nil {
		return access.Scope{}, nil, access.ErrUnauthenticated
	}
	if mutation && subtle.ConstantTimeCompare([]byte(ownerDigest(csrf)), []byte(row.CSRFHash)) != 1 {
		return access.Scope{}, nil, access.ErrForbidden
	}
	if _, err := s.repo.FindByID(ctx, row.OwnerID); err != nil {
		return access.Scope{}, nil, access.ErrUnauthenticated
	}
	now := time.Now().UTC()
	if deadline := sessionDeadline(&row, policy.SessionTimeout); !now.Before(deadline) {
		return access.Scope{}, nil, s.expireIdleSession(ctx, &row, deadline)
	}
	expiry := now.Add(time.Duration(policy.SessionTimeout) * time.Minute)
	remember := row.RememberLogin && policy.RememberLogin
	updated := s.db.WithContext(ctx).Model(&Session{}).
		Where("id = ? AND revoked_at IS NULL AND expires_at > ? AND last_activity > ?", row.ID, now, now.Add(-time.Duration(policy.SessionTimeout)*time.Minute)).
		Updates(map[string]any{"last_activity": now, "expires_at": expiry, "remember_login": remember})
	if updated.Error != nil {
		return access.Scope{}, nil, updated.Error
	}
	if updated.RowsAffected != 1 {
		// MySQL may report zero changed rows for requests in the same millisecond.
		current, err := s.loadSession(ctx, row.ID.String())
		if err != nil {
			return access.Scope{}, nil, err
		}
		row = *current
	} else {
		row.LastActivity, row.ExpiresAt, row.RememberLogin = now, expiry, remember
	}
	actor := protocol.Actor{Kind: protocol.Owner, ID: row.OwnerID.String(), SessionID: row.ID.String()}
	scope, err := access.NewScope(actor, row.ExpiresAt, s)
	if err != nil {
		return access.Scope{}, nil, err
	}
	s.runtime.RefreshOwnerSession(row.ID.String(), row.ExpiresAt)
	s.rememberSession(ctx, &row)
	return scope, &row, nil
}

func (s *Service) CSRFToken(ctx context.Context, token string) (string, *Session, error) {
	_, session, err := s.Authenticate(ctx, token, "", false)
	if err != nil {
		return "", nil, err
	}
	return ownerCSRF(token), session, nil
}
func (s *Service) Authorize(ctx context.Context, actor protocol.Actor, req access.Requirement) error {
	if actor.Kind != protocol.Owner || !actor.Valid() || actor.SessionID == "" || !req.Action.Valid() {
		return access.ErrForbidden
	}
	session, err := s.session(ctx, actor.SessionID)
	if err != nil {
		return err
	}
	if session.OwnerID.String() != actor.ID {
		return access.ErrForbidden
	}
	return nil
}
func (s *Service) Restore(ctx context.Context, actor protocol.Actor) (access.Scope, error) {
	if actor.Kind != protocol.Owner || !actor.Valid() || actor.SessionID == "" {
		return access.Scope{}, access.ErrForbidden
	}
	session, err := s.session(ctx, actor.SessionID)
	if err != nil {
		return access.Scope{}, err
	}
	if session.OwnerID.String() != actor.ID {
		return access.Scope{}, access.ErrForbidden
	}
	return access.NewScope(actor, session.ExpiresAt, s)
}
func (s *Service) requireOwner(ctx context.Context, id uuid.UUID) error {
	scope, err := access.FromContext(ctx)
	if err != nil {
		return err
	}
	if scope.Actor().ID != id.String() {
		return access.ErrForbidden
	}
	return scope.RequireOwner(ctx, protocol.OwnerManage)
}
func (s *Service) GetOwnerByID(ctx context.Context, id uuid.UUID) (*Owner, error) {
	if err := s.requireOwner(ctx, id); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, id)
}
func (s *Service) UpdateProfile(ctx context.Context, id uuid.UUID, name, email, avatar, language, timezone string) error {
	if err := s.requireOwner(ctx, id); err != nil {
		return err
	}
	name, email = strings.TrimSpace(name), strings.ToLower(strings.TrimSpace(email))
	if err := validOwnerProfile(name, email, timezone); err != nil {
		return err
	}
	if len(avatar) > 1<<20 || len(language) > 20 {
		return fmt.Errorf("%w: profile value is too large", ErrInvalidInput)
	}
	return s.updateOwnerPreferences(ctx, id, func(Owner) (map[string]any, error) {
		return map[string]any{"username": name, "email": email, "avatar": avatar, "language": language, "timezone": timezone}, nil
	})
}
func (s *Service) ChangePassword(ctx context.Context, id uuid.UUID, oldPassword, newPassword string) error {
	if err := s.requireOwner(ctx, id); err != nil {
		return err
	}
	if err := ValidatePasswordWithDefault(newPassword); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	owner, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if !owner.CheckPassword(oldPassword) {
		return ErrInvalidCredentials
	}
	if err := owner.SetPassword(newPassword); err != nil {
		return err
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Owner{}).Where("id = ?", id).Update("password", owner.Password).Error; err != nil {
			return err
		}
		if err := tx.Model(&Session{}).Where("owner_id = ? AND revoked_at IS NULL", id).Update("revoked_at", time.Now().UTC()).Error; err != nil {
			return err
		}
		return recordOwnerChange(tx, "security_update", "owner", id, []string{"password", "sessions"})
	})
	if err == nil {
		s.runtime.InvalidateOwner(id.String(), access.ErrRevoked)
	}
	return err
}
func (s *Service) ListSessions(ctx context.Context, id uuid.UUID) ([]Session, error) {
	if err := s.requireOwner(ctx, id); err != nil {
		return nil, err
	}
	var rows []Session
	err := s.db.WithContext(ctx).Where("owner_id = ? AND revoked_at IS NULL AND expires_at > ?", id, time.Now().UTC()).Order("last_activity DESC").Find(&rows).Error
	return rows, err
}
func (s *Service) Logout(ctx context.Context, ownerID uuid.UUID) error {
	sessionID, err := uuid.Parse(access.Current(ctx).Actor().SessionID)
	if err != nil {
		return access.ErrUnauthenticated
	}
	return s.revokeSession(ctx, ownerID, sessionID, false)
}
func (s *Service) RevokeSession(ctx context.Context, ownerID, sessionID uuid.UUID) error {
	return s.revokeSession(ctx, ownerID, sessionID, true)
}
func (s *Service) revokeSession(ctx context.Context, ownerID, sessionID uuid.UUID, recordChange bool) error {
	if err := s.requireOwner(ctx, ownerID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&Session{}).Where("id = ? AND owner_id = ? AND revoked_at IS NULL", sessionID, ownerID).Update("revoked_at", time.Now().UTC())
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 || !recordChange {
			return nil
		}
		return recordOwnerChange(tx, "security_update", "owner_session", sessionID, []string{"revoked_at"})
	})
	if err == nil {
		s.runtime.Invalidate("", sessionID.String(), "", access.ErrRevoked)
	}
	return err
}
func (s *Service) RevokeAllOtherSessions(ctx context.Context, id, current uuid.UUID) error {
	if err := s.requireOwner(ctx, id); err != nil {
		return err
	}
	scope, _ := access.FromContext(ctx)
	if current.String() != scope.Actor().SessionID {
		return access.ErrForbidden
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var sessions []Session
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		sessions, err = revokeOtherSessions(tx, id, current)
		if err != nil || len(sessions) == 0 {
			return err
		}
		return recordOwnerChange(tx, "security_update", "owner", id, []string{"other_sessions"})
	})
	if err != nil {
		return err
	}
	for _, session := range sessions {
		s.runtime.Invalidate("", session.ID.String(), "", access.ErrRevoked)
	}
	return nil
}

// Called with the service mutation mutex held and inside the source transaction.
func revokeOtherSessions(tx *gorm.DB, id, current uuid.UUID) ([]Session, error) {
	var sessions []Session
	if err := tx.Where("owner_id = ? AND id <> ? AND revoked_at IS NULL", id, current).Find(&sessions).Error; err != nil {
		return nil, err
	}
	if len(sessions) == 0 {
		return sessions, nil
	}
	ids := make([]uuid.UUID, 0, len(sessions))
	for _, session := range sessions {
		ids = append(ids, session.ID)
	}
	err := tx.Model(&Session{}).Where("id IN ?", ids).Update("revoked_at", time.Now().UTC()).Error
	return sessions, err
}

// RecoverFromHost is only called by the maintenance command after acquiring the
// instance lock. It has no HTTP or Wails binding and cannot be invoked by visitors.
func (s *Service) RecoverFromHost(ctx context.Context, password string, resetTwoFactor bool) error {
	if err := ValidatePasswordWithDefault(password); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	owner, err := s.repo.Get(ctx)
	if err != nil {
		return err
	}
	if err := owner.SetPassword(password); err != nil {
		return err
	}
	values := map[string]any{"password": owner.Password, "locked_until": nil, "lock_reason": "", "failed_login_attempts": 0, "last_failed_login": nil}
	if resetTwoFactor {
		values["two_factor_enabled"] = false
		values["two_factor_secret"] = ""
		values["backup_codes"] = ""
		values["pending_two_factor_secret"] = ""
		values["pending_two_factor_expires_at"] = nil
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Owner{}).Where("id = ?", owner.ID).Updates(values).Error; err != nil {
			return err
		}
		if resetTwoFactor {
			if err := tx.Where("owner_id = ?", owner.ID).Delete(&TOTPReplay{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&Session{}).Where("owner_id = ? AND revoked_at IS NULL", owner.ID).Update("revoked_at", time.Now().UTC()).Error; err != nil {
			return err
		}
		if err := tx.Table("owner_devices").Where("owner_id = ?", owner.ID).Update("revoked", true).Error; err != nil {
			return err
		}
		fields := []string{"password", "account_lock", "sessions", "devices"}
		if resetTwoFactor {
			fields = append(fields, "two_factor_enabled", "backup_codes")
		}
		return operationrecord.RecordConfiguration(tx, protocol.Actor{Kind: protocol.Owner, ID: owner.ID.String()}, operationrecord.ConfigurationChange{
			Action: "security_update", ResourceKind: "owner", ResourceID: owner.ID.String(), Name: "宿主恢复",
			Source: "manual", Fields: fields,
		})
	})
	if err == nil {
		s.runtime.InvalidateOwner(owner.ID.String(), access.ErrRevoked)
	}
	return err
}
func (s *Service) encryptOwnerSecret(id uuid.UUID, column, plaintext string) (string, error) {
	return s.encryptor.EncryptSecret(plaintext, secretcrypto.SecretAAD("owners", id.String(), column))
}
func (s *Service) decryptOwnerSecret(id uuid.UUID, column, ciphertext string) (string, error) {
	return s.encryptor.DecryptSecret(ciphertext, secretcrypto.SecretAAD("owners", id.String(), column))
}

func (s *Service) UpdateNotificationSettings(ctx context.Context, id uuid.UUID, values map[string]bool) error {
	if err := s.requireOwner(ctx, id); err != nil {
		return err
	}
	allowed := map[string]bool{"notify_email_login": true, "notify_email_alert": true, "notify_browser": true, "notify_new_device": true, "notify_new_location": true, "notify_suspicious": true, "notify_task_in_app": true, "notify_task_success": true, "notify_task_failure": true, "notify_task_partial": true, "notify_task_external": true}
	updates := map[string]any{}
	for k, v := range values {
		if !allowed[k] {
			return fmt.Errorf("unknown notification setting %q", k)
		}
		updates[k] = v
	}
	return s.updateOwnerPreferences(ctx, id, func(Owner) (map[string]any, error) { return updates, nil })
}

func (s *Service) OpenWork(ctx context.Context, scope access.Scope, kind access.WorkKind, requirements ...access.Requirement) (*access.Lease, error) {
	// Reserve rechecks persisted authority before and after registration. Never
	// carry an HTTP request's cached session into a long-lived lease.
	fresh, err := access.NewScope(scope.Actor(), scope.ExpiresAt(), s)
	if err != nil {
		return nil, err
	}
	return s.runtime.Reserve(withoutSessionCache(ctx), fresh, kind, 0, requirements...)
}
