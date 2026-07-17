package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	ErrInvalidTicket = errors.New("invalid ticket")
	ErrExpiredTicket = errors.New("expired ticket")
	ErrTicketUsed    = errors.New("ticket already used")
)

type TicketType string

const (
	TicketTypeWSTerminal        TicketType = "ws_terminal"
	TicketTypeWSMonitor         TicketType = "ws_monitor"
	TicketTypeWSSFTPAuth        TicketType = "ws_sftp_auth"
	TicketTypeWSSFTPUpload      TicketType = "ws_sftp_upload"
	TicketTypeWSSFTPTransfer    TicketType = "ws_sftp_transfer"
	TicketTypeSFTPDownload      TicketType = "sftp_download"
	TicketTypeSFTPBatchDownload TicketType = "sftp_batch_download"
)

func (t TicketType) IsValid() bool {
	switch t {
	case TicketTypeWSTerminal, TicketTypeWSMonitor, TicketTypeWSSFTPAuth,
		TicketTypeWSSFTPUpload, TicketTypeWSSFTPTransfer,
		TicketTypeSFTPDownload, TicketTypeSFTPBatchDownload:
		return true
	default:
		return false
	}
}

type SFTPBatchDownloadPayload struct {
	Paths           []string
	Mode            string
	ExcludePatterns []string
}

type Ticket struct {
	Value                  string
	Type                   TicketType
	Ref                    string
	UserID                 uuid.UUID
	Username               string
	Email                  string
	Role                   UserRole
	SessionID              uuid.UUID
	SFTPDownloadPath       string
	SFTPBatchDownloadInput *SFTPBatchDownloadPayload
	CreatedAt              time.Time
	ExpiresAt              time.Time
	UsedAt                 *time.Time
}

type TicketRecord struct {
	ID          uuid.UUID  `gorm:"type:char(36);primaryKey"`
	TokenHash   string     `gorm:"not null;uniqueIndex;size:64"`
	Type        TicketType `gorm:"not null;size:40;index"`
	Ref         string     `gorm:"size:255;index"`
	UserID      uuid.UUID  `gorm:"type:char(36);not null;index"`
	Username    string     `gorm:"size:100"`
	Email       string     `gorm:"size:255"`
	Role        UserRole   `gorm:"size:40"`
	SessionID   uuid.UUID  `gorm:"type:char(36);index"`
	PayloadJSON string     `gorm:"type:text"`
	CreatedAt   time.Time
	ExpiresAt   time.Time  `gorm:"not null;index"`
	UsedAt      *time.Time `gorm:"index"`
}

func (TicketRecord) TableName() string { return "auth_tickets" }

func (r *TicketRecord) BeforeCreate(*gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

type CreateTicketRequest struct {
	Type                   TicketType
	Ref                    string
	UserID                 uuid.UUID
	Username               string
	Email                  string
	Role                   UserRole
	SessionID              uuid.UUID
	SFTPDownloadPath       string
	SFTPBatchDownloadInput *SFTPBatchDownloadPayload
}

type TicketExpectation struct {
	Type TicketType
	Ref  string
}

type TicketService interface {
	Create(ctx context.Context, req CreateTicketRequest) (ticket string, expiresInSeconds int, err error)
	Consume(ctx context.Context, ticket string, expect TicketExpectation) (*Ticket, error)
}

type TicketConfig struct{ TTL time.Duration }

type ticketService struct {
	db  *gorm.DB
	ttl time.Duration
}

func NewTicketService(db *gorm.DB, cfg TicketConfig) TicketService {
	if cfg.TTL <= 0 {
		cfg.TTL = 30 * time.Second
	}
	return &ticketService{db: db, ttl: cfg.TTL}
}

func (s *ticketService) Create(ctx context.Context, req CreateTicketRequest) (string, int, error) {
	if !req.Type.IsValid() || req.UserID == uuid.Nil {
		return "", 0, ErrInvalidTicket
	}
	value, err := newRandomTicketValue(32)
	if err != nil {
		return "", 0, err
	}
	payload, err := json.Marshal(struct {
		DownloadPath string                    `json:"download_path,omitempty"`
		Batch        *SFTPBatchDownloadPayload `json:"batch,omitempty"`
	}{req.SFTPDownloadPath, req.SFTPBatchDownloadInput})
	if err != nil {
		return "", 0, err
	}
	now := time.Now()
	record := &TicketRecord{
		TokenHash: ticketHash(value), Type: req.Type, Ref: req.Ref,
		UserID: req.UserID, Username: req.Username, Email: req.Email, Role: req.Role, SessionID: req.SessionID,
		PayloadJSON: string(payload), CreatedAt: now, ExpiresAt: now.Add(s.ttl),
	}
	if err := s.db.WithContext(ctx).Create(record).Error; err != nil {
		return "", 0, err
	}
	return value, int(s.ttl.Seconds()), nil
}

func (s *ticketService) Consume(ctx context.Context, value string, expect TicketExpectation) (*Ticket, error) {
	if value == "" || !expect.Type.IsValid() {
		return nil, ErrInvalidTicket
	}
	var record TicketRecord
	if err := s.db.WithContext(ctx).Where("token_hash = ?", ticketHash(value)).First(&record).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidTicket
		}
		return nil, err
	}
	if record.UsedAt != nil {
		return nil, ErrTicketUsed
	}
	if time.Now().After(record.ExpiresAt) {
		return nil, ErrExpiredTicket
	}
	if record.Type != expect.Type || expect.Ref != "" && record.Ref != expect.Ref {
		return nil, ErrInvalidTicket
	}
	now := time.Now()
	result := s.db.WithContext(ctx).Model(&TicketRecord{}).
		Where("id = ? AND used_at IS NULL AND expires_at > ?", record.ID, now).Update("used_at", now)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrTicketUsed
	}
	var payload struct {
		DownloadPath string                    `json:"download_path"`
		Batch        *SFTPBatchDownloadPayload `json:"batch"`
	}
	if err := json.Unmarshal([]byte(record.PayloadJSON), &payload); err != nil {
		return nil, err
	}
	return &Ticket{
		Value: value, Type: record.Type, Ref: record.Ref,
		UserID: record.UserID, Username: record.Username, Email: record.Email, Role: record.Role, SessionID: record.SessionID,
		SFTPDownloadPath: payload.DownloadPath, SFTPBatchDownloadInput: payload.Batch,
		CreatedAt: record.CreatedAt, ExpiresAt: record.ExpiresAt, UsedAt: &now,
	}, nil
}

func newRandomTicketValue(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func ticketHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}
