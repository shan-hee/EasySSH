package sshhostkey

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"net"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrHostKeyRecordNotFound = errors.New("host key record not found")
	ErrHostKeyRevoked        = errors.New("host key trust has been revoked")
)

type Service struct {
	db      *gorm.DB
	runtime *access.Runtime
}

func NewService(db *gorm.DB, runtime *access.Runtime) *Service {
	return &Service{db: db, runtime: runtime}
}

// VerifyHostKey never creates trust. The callback that can ask an owner is a
// separate policy and is not supplied to visitor, task, or monitoring execution.
func (s *Service) VerifyHostKey(hostname string, _ net.Addr, key ssh.PublicKey) error {
	host, port, err := sshutil.ParseHostAddress(hostname)
	if err != nil {
		return err
	}
	fingerprint := ssh.FingerprintSHA256(key)
	var existing SSHHostKey
	err = s.db.Where("host = ? AND port = ? AND key_type = ?", host, port, key.Type()).First(&existing).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if err == nil && existing.TrustStatus == "revoked" {
		return ErrHostKeyRevoked
	}
	publicKey := base64.StdEncoding.EncodeToString(key.Marshal())
	if err != nil || existing.PublicKey != publicKey || existing.Fingerprint != fingerprint || existing.TrustStatus != "trusted" {
		return &HostKeyVerificationError{Host: host, Port: port, ExpectedKey: existing.Fingerprint,
			ExpectedKeyType: existing.KeyType, ReceivedKey: fingerprint, ReceivedKeyType: key.Type(),
			Message: fmt.Sprintf("Owner confirmation required for SSH host %s:%d (%s, %s)", host, port, key.Type(), fingerprint)}
	}
	return s.db.Model(&existing).UpdateColumn("last_seen", time.Now().UTC()).Error
}

func (s *Service) GetHostKeyPolicy() sshutil.HostKeyPolicy {
	return s.policy(context.Background(), access.Scope{}, nil)
}

// GetOwnerApprovalPolicy checks the initiating owner before and after the
// handshake prompt. Visitors can only use previously trusted host keys.
func (s *Service) GetOwnerApprovalPolicy(ctx context.Context, scope access.Scope, approve func(*HostKeyVerificationError) (bool, error)) sshutil.HostKeyPolicy {
	if !scope.IsOwner() {
		return s.GetHostKeyPolicy()
	}
	return s.policy(ctx, scope, approve)
}

func (s *Service) policy(ctx context.Context, scope access.Scope, approve func(*HostKeyVerificationError) (bool, error)) sshutil.HostKeyPolicy {
	return func(host string, port int) (ssh.HostKeyCallback, []string, error) {
		host = sshutil.NormalizeHost(host)
		var records []SSHHostKey
		if err := s.db.Where("host = ? AND port = ?", host, port).Find(&records).Error; err != nil {
			return nil, nil, err
		}
		var keyTypes []string
		for _, record := range records {
			if record.TrustStatus == "trusted" {
				keyTypes = append(keyTypes, record.KeyType)
			}
		}
		if len(records) != 0 && len(keyTypes) == 0 {
			return nil, nil, ErrHostKeyRevoked
		}
		algorithms, err := sshutil.HostKeyAlgorithms(keyTypes)
		if err != nil {
			return nil, nil, err
		}
		callback := s.VerifyHostKey
		if approve != nil {
			callback = func(address string, remote net.Addr, key ssh.PublicKey) error {
				err := s.VerifyHostKey(address, remote, key)
				if err == nil {
					return nil
				}
				var details *HostKeyVerificationError
				if !errors.As(err, &details) {
					return err
				}
				if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
					return err
				}
				confirmed, approvalErr := approve(details)
				if approvalErr != nil {
					return approvalErr
				}
				if !confirmed {
					return err
				}
				if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
					return err
				}
				return s.trustVerifiedHostKey(ctx, details.Host, details.Port, key)
			}
		}
		return callback, algorithms, nil
	}
}

func (s *Service) trustVerifiedHostKey(ctx context.Context, host string, port int, key ssh.PublicKey) error {
	host = sshutil.NormalizeHost(host)
	now := time.Now().UTC()
	publicKey := base64.StdEncoding.EncodeToString(key.Marshal())
	var affected []uuid.UUID
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing SSHHostKey
		err := tx.Where("host = ? AND port = ? AND key_type = ?", host, port, key.Type()).First(&existing).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil && existing.PublicKey == publicKey && existing.TrustStatus == "trusted" {
			return nil
		}
		record := SSHHostKey{Host: host, Port: port, KeyType: key.Type(), PublicKey: publicKey,
			Fingerprint: ssh.FingerprintSHA256(key), FirstSeen: now, LastSeen: now, ConfirmedAt: now, TrustStatus: "trusted"}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "host"}, {Name: "port"}, {Name: "key_type"}},
			DoUpdates: clause.AssignmentColumns([]string{"public_key", "fingerprint", "last_seen", "confirmed_at", "trust_status", "updated_at"}),
		}).Create(&record).Error; err != nil {
			return err
		}
		return bumpEndpoint(tx, host, port, &affected)
	})
	if err == nil {
		s.invalidate(affected)
	}
	return err
}

func bumpEndpoint(tx *gorm.DB, host string, port int, affected *[]uuid.UUID) error {
	if err := tx.Table("servers").Where("host = ? AND port = ? AND deleted_at IS NULL", host, port).Pluck("id", affected).Error; err != nil {
		return err
	}
	return tx.Table("servers").Where("host = ? AND port = ? AND deleted_at IS NULL", host, port).
		Updates(map[string]any{"connection_revision": gorm.Expr("connection_revision + 1"), "updated_at": time.Now().UTC()}).Error
}

func (s *Service) invalidate(ids []uuid.UUID) {
	for _, id := range ids {
		s.runtime.InvalidateVisitors(id.String(), access.ErrResourceChanged)
	}
}

func (s *Service) RevokeHostKey(ctx context.Context, scope access.Scope, host string, port int) error {
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	host = sshutil.NormalizeHost(host)
	var affected []uuid.UUID
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&SSHHostKey{}).Where("host = ? AND port = ?", host, port).Update("trust_status", "revoked")
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrHostKeyRecordNotFound
		}
		return bumpEndpoint(tx, host, port, &affected)
	})
	if err == nil {
		s.invalidate(affected)
	}
	return err
}

func (s *Service) DeleteHostKey(ctx context.Context, scope access.Scope, id uint) error {
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	var affected []uuid.UUID
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var record SSHHostKey
		if err := tx.First(&record, id).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Delete(&record).Error; err != nil {
			return err
		}
		return bumpEndpoint(tx, record.Host, record.Port, &affected)
	})
	if err == nil {
		s.invalidate(affected)
	}
	return err
}

func hostKeyInfo(key SSHHostKey) HostKeyInfo {
	return HostKeyInfo{ID: key.ID, Host: key.Host, Port: key.Port, KeyType: key.KeyType,
		Fingerprint: key.Fingerprint, FirstSeen: key.FirstSeen, LastSeen: key.LastSeen,
		ConfirmedAt: key.ConfirmedAt, TrustStatus: key.TrustStatus}
}

func (s *Service) ListHostKeys(ctx context.Context, scope access.Scope) ([]HostKeyInfo, error) {
	if err := scope.RequireOwner(ctx, protocol.WorkspaceRead); err != nil {
		return nil, err
	}
	var keys []SSHHostKey
	if err := s.db.WithContext(ctx).Order("host, port, key_type").Find(&keys).Error; err != nil {
		return nil, err
	}
	result := make([]HostKeyInfo, 0, len(keys))
	for _, key := range keys {
		result = append(result, hostKeyInfo(key))
	}
	return result, nil
}

func (s *Service) GetHostKey(ctx context.Context, scope access.Scope, id uint) (*HostKeyInfo, error) {
	var key SSHHostKey
	if err := s.db.WithContext(ctx).First(&key, id).Error; err != nil {
		return nil, err
	}
	result := hostKeyInfo(key)
	return &result, nil
}
