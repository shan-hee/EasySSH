package app

import (
	"context"
	"errors"

	"github.com/easyssh/shared/protocol"
)

func (s *DesktopSFTPService) GetTransferLimits() (protocol.TransferLimits, error) {
	var limits protocol.TransferLimits
	if s.taskCenter == nil {
		return limits, errors.New("task center unavailable")
	}
	db, err := s.taskCenter.database()
	if err != nil {
		return limits, err
	}
	err = db.QueryRow(`SELECT max_entries,max_depth FROM transfer_settings WHERE id=1`).Scan(&limits.MaxEntries, &limits.MaxDepth)
	return limits, err
}

func (s *DesktopSFTPService) SaveTransferLimits(input protocol.TransferLimits) error {
	ctx, done, err := s.beginOperation(context.Background())
	if err != nil {
		return err
	}
	defer done()
	if input.MaxEntries < 1 || input.MaxEntries > 1000000 || input.MaxDepth < 1 || input.MaxDepth > 256 {
		return errors.New("transfer limits out of range")
	}
	if s.taskCenter == nil {
		return errors.New("task center unavailable")
	}
	db, err := s.taskCenter.database()
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var current protocol.TransferLimits
	if err = tx.QueryRowContext(ctx, `SELECT max_entries,max_depth FROM transfer_settings WHERE id=1`).Scan(&current.MaxEntries, &current.MaxDepth); err != nil {
		return err
	}
	fields := []string{}
	if current.MaxEntries != input.MaxEntries {
		fields = append(fields, "max_entries")
	}
	if current.MaxDepth != input.MaxDepth {
		fields = append(fields, "max_depth")
	}
	if len(fields) == 0 {
		return tx.Commit()
	}
	if _, err = tx.ExecContext(ctx, `UPDATE transfer_settings SET max_entries=?,max_depth=? WHERE id=1`, input.MaxEntries, input.MaxDepth); err != nil {
		return err
	}
	if err = recordDesktopConfiguration(tx, "transfer_settings_updated", "transfer_settings", "1", "文件传输设置", "manual", fields, nil); err != nil {
		return err
	}
	return tx.Commit()
}
