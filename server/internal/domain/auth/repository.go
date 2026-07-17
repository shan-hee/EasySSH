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
	ErrUserNotFound         = errors.New("user not found")
	ErrUserAlreadyExists    = errors.New("user already exists")
	ErrInvalidCredentials   = errors.New("invalid credentials")
	ErrSessionNotFound      = errors.New("session not found or has been revoked")
	ErrSessionExpired       = errors.New("session has expired")
	ErrIPLocked             = errors.New("IP address is temporarily locked due to too many failed attempts")
	ErrAccountLocked        = errors.New("account is temporarily locked due to too many failed attempts")
	ErrLastLoginMethod      = errors.New("cannot unlink the only login method")
	ErrInvalidTwoFactorCode = errors.New("invalid 2FA code")
)

// Repository 用户数据访问接口
type Repository interface {
	// Create 创建用户
	Create(ctx context.Context, user *User) error

	// FindByID 根据 ID 查找用户
	FindByID(ctx context.Context, id uuid.UUID) (*User, error)

	// FindByUsername 根据用户名查找用户
	FindByUsername(ctx context.Context, username string) (*User, error)

	// FindByEmail 根据邮箱查找用户
	FindByEmail(ctx context.Context, email string) (*User, error)

	// FindByGoogleSub 根据 Google OIDC subject 查找用户
	FindByGoogleSub(ctx context.Context, googleSub string) (*User, error)

	// Update 更新用户信息
	Update(ctx context.Context, user *User) error

	// ConsumeTwoFactorCounter 原子消费一个新的 TOTP 时间步。
	ConsumeTwoFactorCounter(ctx context.Context, userID uuid.UUID, counter int64) (bool, error)

	// ClearTwoFactorCounters 清除旧 TOTP 密钥对应的重放记录。
	ClearTwoFactorCounters(ctx context.Context, userID uuid.UUID) error

	// ConsumeBackupCodes 通过比较并交换原子更新备用码集合。
	ConsumeBackupCodes(ctx context.Context, userID uuid.UUID, currentCodes, updatedCodes string) (bool, error)

	// Delete 删除用户（软删除）
	Delete(ctx context.Context, id uuid.UUID) error

	// List 获取用户列表（分页）
	List(ctx context.Context, limit, offset int) ([]*User, int64, error)

	// HasAdmin 检查是否存在管理员用户
	HasAdmin(ctx context.Context) (bool, error)

	// CountAdmins 统计管理员数量
	CountAdmins(ctx context.Context) (int64, error)

	// Session management

	// CreateSession 创建会话
	CreateSession(ctx context.Context, session *Session) error

	FindSessionByOAuthRequestID(ctx context.Context, requestID string) (*Session, error)

	// ListUserSessions 获取用户的所有活跃会话
	ListUserSessions(ctx context.Context, userID uuid.UUID) ([]*Session, error)

	// UpdateSession 更新会话
	UpdateSession(ctx context.Context, session *Session) error

	// DeleteSession 删除会话（撤销）
	DeleteSession(ctx context.Context, sessionID uuid.UUID) error

	// DeleteAllUserSessions 删除用户的所有会话（登出所有设备）
	DeleteAllUserSessions(ctx context.Context, userID uuid.UUID) error

	// DeleteExpiredSessions 清理过期会话
	DeleteExpiredSessions(ctx context.Context) error
}

// gormRepository GORM 实现
type gormRepository struct {
	db *gorm.DB
}

// NewRepository 创建用户仓储
func NewRepository(db *gorm.DB) Repository {
	return &gormRepository{db: db}
}

func (r *gormRepository) Create(ctx context.Context, user *User) error {
	// 检查邮箱是否已存在（邮箱是唯一标识）
	var count int64
	if err := r.db.WithContext(ctx).Model(&User{}).
		Where("email = ?", user.Email).
		Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrUserAlreadyExists
	}

	if user.GoogleSub != nil && *user.GoogleSub != "" {
		if err := r.db.WithContext(ctx).Model(&User{}).
			Where("google_sub = ?", *user.GoogleSub).
			Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrUserAlreadyExists
		}
	}

	return r.db.WithContext(ctx).Create(user).Error
}

func (r *gormRepository) FindByID(ctx context.Context, id uuid.UUID) (*User, error) {
	var user User
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return &user, nil
}

func (r *gormRepository) FindByUsername(ctx context.Context, username string) (*User, error) {
	var user User
	if err := r.db.WithContext(ctx).Where("username = ?", username).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return &user, nil
}

func (r *gormRepository) FindByEmail(ctx context.Context, email string) (*User, error) {
	var user User
	if err := r.db.WithContext(ctx).Where("email = ?", email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return &user, nil
}

func (r *gormRepository) FindByGoogleSub(ctx context.Context, googleSub string) (*User, error) {
	var user User
	if err := r.db.WithContext(ctx).Where("google_sub = ?", googleSub).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return &user, nil
}

func (r *gormRepository) Update(ctx context.Context, user *User) error {
	return r.db.WithContext(ctx).Save(user).Error
}

func (r *gormRepository) ConsumeTwoFactorCounter(ctx context.Context, userID uuid.UUID, counter int64) (bool, error) {
	replay := TOTPReplay{UserID: userID, Counter: counter}
	result := r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&replay)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected != 1 {
		return false, nil
	}
	// 只保留当前时间步附近的记录；严格小于 counter-2，避免删除仍在容差窗口内的验证码。
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND counter < ?", userID, counter-2).
		Delete(&TOTPReplay{}).Error; err != nil {
		return false, err
	}
	return true, nil
}

func (r *gormRepository) ClearTwoFactorCounters(ctx context.Context, userID uuid.UUID) error {
	return r.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&TOTPReplay{}).Error
}

func (r *gormRepository) ConsumeBackupCodes(ctx context.Context, userID uuid.UUID, currentCodes, updatedCodes string) (bool, error) {
	result := r.db.WithContext(ctx).Model(&User{}).
		Where("id = ? AND two_factor_enabled = ? AND backup_codes = ?", userID, true, currentCodes).
		Update("backup_codes", updatedCodes)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *gormRepository) Delete(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).Delete(&User{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (r *gormRepository) List(ctx context.Context, limit, offset int) ([]*User, int64, error) {
	var users []*User
	var total int64

	// 获取总数
	if err := r.db.WithContext(ctx).Model(&User{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 获取分页数据
	if err := r.db.WithContext(ctx).
		Limit(limit).
		Offset(offset).
		Order("created_at DESC").
		Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

// HasAdmin 检查是否存在管理员用户
func (r *gormRepository) HasAdmin(ctx context.Context) (bool, error) {
	var count int64
	if err := r.db.WithContext(ctx).Model(&User{}).Where("role = ?", RoleAdmin).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// CountAdmins 统计管理员数量
func (r *gormRepository) CountAdmins(ctx context.Context) (int64, error) {
	var count int64
	if err := r.db.WithContext(ctx).Model(&User{}).Where("role = ?", RoleAdmin).Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

// === Session Management ===

// CreateSession 创建会话
func (r *gormRepository) CreateSession(ctx context.Context, session *Session) error {
	return r.db.WithContext(ctx).Create(session).Error
}

func (r *gormRepository) FindSessionByOAuthRequestID(ctx context.Context, requestID string) (*Session, error) {
	var session Session
	if err := r.db.WithContext(ctx).Where("oauth_request_id = ?", requestID).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSessionNotFound
		}
		return nil, err
	}
	return &session, nil
}

// ListUserSessions 获取用户的所有活跃会话（未过期）
func (r *gormRepository) ListUserSessions(ctx context.Context, userID uuid.UUID) ([]*Session, error) {
	var sessions []*Session
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND expires_at > ?", userID, time.Now()).
		Order("last_activity DESC").
		Find(&sessions).Error; err != nil {
		return nil, err
	}
	return sessions, nil
}

// UpdateSession 更新会话
func (r *gormRepository) UpdateSession(ctx context.Context, session *Session) error {
	return r.db.WithContext(ctx).Save(session).Error
}

// DeleteSession 删除会话（撤销）
func (r *gormRepository) DeleteSession(ctx context.Context, sessionID uuid.UUID) error {
	result := r.db.WithContext(ctx).Delete(&Session{}, sessionID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrSessionNotFound
	}
	return nil
}

// DeleteAllUserSessions 删除用户的所有会话（登出所有设备）
func (r *gormRepository) DeleteAllUserSessions(ctx context.Context, userID uuid.UUID) error {
	return r.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&Session{}).Error
}

// DeleteExpiredSessions 清理过期会话
func (r *gormRepository) DeleteExpiredSessions(ctx context.Context) error {
	return r.db.WithContext(ctx).Where("expires_at < ?", time.Now()).Delete(&Session{}).Error
}
