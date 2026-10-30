package auth

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// KnownLoginDevice is a browser fingerprint observed after a successful login.
// It is a notification baseline, not a credential or a trusted authorization device.
type KnownLoginDevice struct {
	ID                uuid.UUID `gorm:"type:char(36);primary_key" json:"id"`
	OwnerID           uuid.UUID `gorm:"type:char(36);not null;uniqueIndex:idx_known_login_owner_fp,priority:1" json:"owner_id"`
	DeviceFingerprint string    `gorm:"size:64;not null;uniqueIndex:idx_known_login_owner_fp,priority:2" json:"device_fingerprint"` // 设备指纹（哈希）
	DeviceType        string    `gorm:"size:50" json:"device_type"`                                                                 // desktop, mobile, tablet
	DeviceName        string    `gorm:"size:200" json:"device_name"`                                                                // 浏览器/设备名称
	LastIPAddress     string    `gorm:"size:45" json:"last_ip_address"`                                                             // 最后使用的 IP
	LastLocation      string    `gorm:"size:200" json:"last_location"`                                                              // 最后使用的位置
	LastUsed          time.Time `json:"last_used"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// TableName 指定表名
func (KnownLoginDevice) TableName() string {
	return "known_login_devices"
}

// BeforeCreate GORM 钩子
func (t *KnownLoginDevice) BeforeCreate(tx *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	if t.LastUsed.IsZero() {
		t.LastUsed = time.Now()
	}
	return nil
}

// KnownLoginDeviceRepository stores login observations, never authentication authority.
type KnownLoginDeviceRepository interface {
	FindByOwnerAndFingerprint(context.Context, uuid.UUID, string) (*KnownLoginDevice, error)
	ListByOwner(context.Context, uuid.UUID) ([]*KnownLoginDevice, error)
	Upsert(context.Context, *KnownLoginDevice) error
}

type gormKnownLoginDeviceRepository struct{ db *gorm.DB }

func NewKnownLoginDeviceRepository(db *gorm.DB) KnownLoginDeviceRepository {
	return &gormKnownLoginDeviceRepository{db: db}
}

func (r *gormKnownLoginDeviceRepository) FindByOwnerAndFingerprint(ctx context.Context, ownerID uuid.UUID, fingerprint string) (*KnownLoginDevice, error) {
	var device KnownLoginDevice
	err := r.db.WithContext(ctx).Where("owner_id = ? AND device_fingerprint = ?", ownerID, fingerprint).First(&device).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &device, nil
}

func (r *gormKnownLoginDeviceRepository) ListByOwner(ctx context.Context, ownerID uuid.UUID) ([]*KnownLoginDevice, error) {
	var devices []*KnownLoginDevice
	err := r.db.WithContext(ctx).Where("owner_id = ?", ownerID).Find(&devices).Error
	return devices, err
}

func (r *gormKnownLoginDeviceRepository) Upsert(ctx context.Context, device *KnownLoginDevice) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "owner_id"}, {Name: "device_fingerprint"}},
		DoUpdates: clause.AssignmentColumns([]string{"device_type", "device_name", "last_ip_address", "last_location", "last_used", "updated_at"}),
	}).Create(device).Error
}
