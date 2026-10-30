package grant

import (
	"context"
	"sync"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"gorm.io/gorm"
)

func (s *Service) CheckBytes(ctx context.Context, scope access.Scope, req access.Requirement, amount int64) error {
	if scope.Actor().Kind != protocol.Visitor || amount < 0 {
		return access.ErrForbidden
	}
	usedColumn, limitColumn, err := quotaColumns(req.Action)
	if err != nil {
		return err
	}
	var row struct {
		Used  int64  `gorm:"column:used"`
		Limit *int64 `gorm:"column:quota_limit"`
	}
	err = s.db.WithContext(ctx).Model(&Grant{}).
		Where("id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", scope.Actor().GrantID, time.Now().UTC()).
		Select(usedColumn + " AS used, " + limitColumn + " AS quota_limit").Take(&row).Error
	if err != nil {
		return err
	}
	if row.Limit != nil && (amount > *row.Limit || row.Used > *row.Limit-amount) {
		return ErrQuota
	}
	return nil
}

// ReserveBytes uses a compare-and-swap update on one grant's counter. There is
// no process-wide issuance mutex or read/write transaction on the transfer path.
// Admission and lease cancellation own authorization; this method owns quota.
func (s *Service) ReserveBytes(ctx context.Context, scope access.Scope, req access.Requirement, requested int) (int, func(int) error, error) {
	if scope.Actor().Kind != protocol.Visitor {
		return 0, nil, access.ErrForbidden
	}
	switch req.Action {
	case protocol.FilesRead, protocol.FilesDownload, protocol.FilesWrite, protocol.FilesUpload:
	default:
		return 0, nil, access.ErrForbidden
	}
	if requested <= 0 || requested > access.ByteReservationSize {
		return 0, nil, ErrInvalidRequest
	}
	usedColumn, limitColumn, err := quotaColumns(req.Action)
	if err != nil {
		return 0, nil, err
	}
	var amount int64
	for {
		if err := ctx.Err(); err != nil {
			return 0, nil, err
		}
		var row struct {
			Used    int64  `gorm:"column:used"`
			Limit   *int64 `gorm:"column:quota_limit"`
			Version int64
		}
		active := s.db.WithContext(ctx).Model(&Grant{}).Where("id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", scope.Actor().GrantID, time.Now().UTC())
		if err := active.Select(usedColumn + " AS used, " + limitColumn + " AS quota_limit, version").Take(&row).Error; err != nil {
			return 0, nil, err
		}
		// Unlimited grants use transfer task statistics, not a quota counter.
		if row.Limit == nil {
			return requested, nil, nil
		}
		amount = min(int64(requested), *row.Limit-row.Used)
		if amount <= 0 {
			return 0, nil, ErrQuota
		}
		result := s.db.WithContext(ctx).Model(&Grant{}).
			Where("id = ? AND revoked_at IS NULL AND version = ? AND (expires_at IS NULL OR expires_at > ?)", scope.Actor().GrantID, row.Version, time.Now().UTC()).
			Where(usedColumn+" = ? AND "+limitColumn+" = ?", row.Used, *row.Limit).
			UpdateColumn(usedColumn, gorm.Expr(usedColumn+" + ?", amount))
		if result.Error != nil {
			return 0, nil, result.Error
		}
		if result.RowsAffected == 1 {
			break
		}
		// Another stream reserved concurrently, or policy changed. Reload the
		// current counter; only the winning conditional update consumes quota.
	}
	var once sync.Once
	var settled error
	settle := func(consumed int) error {
		if consumed < 0 || int64(consumed) > amount {
			return ErrInvalidRequest
		}
		once.Do(func() {
			unused := amount - int64(consumed)
			if unused == 0 {
				return
			}
			// Revocation must not prevent refunding unused preallocated bytes.
			refundCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			result := s.db.WithContext(refundCtx).Model(&Grant{}).
				Where("id = ? AND "+usedColumn+" >= ?", scope.Actor().GrantID, unused).
				UpdateColumn(usedColumn, gorm.Expr(usedColumn+" - ?", unused))
			settled = result.Error
			if settled == nil && result.RowsAffected != 1 {
				settled = ErrConflict
			}
		})
		return settled
	}
	return int(amount), settle, nil
}
