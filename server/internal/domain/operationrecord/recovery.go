package operationrecord

import (
	"context"
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

// RecoverInterrupted runs before listeners/workers start. Only process-local
// work is closed here; durable queued jobs recover through their own facts.
func (r *repository) RecoverInterrupted(ctx context.Context) error {
	recoveredAt := time.Now().UTC()
	for {
		var count int
		err := r.transaction(ctx, func(tx *gorm.DB) error {
			var records []OperationRecord
			if err := tx.Where("source_table = ? AND status IN ?", "terminal_sessions", []Status{StatusPending, StatusRunning}).Order("id").Limit(500).Find(&records).Error; err != nil {
				return err
			}
			count = len(records)
			for _, record := range records {
				// The restart time includes downtime. Use the last confirmed update
				// and label the boundary as estimated instead of inventing duration.
				finished := record.UpdatedAt
				if finished.Before(record.CreatedAt) {
					finished = record.CreatedAt
				}
				if finished.After(recoveredAt) {
					finished = recoveredAt
				}
				var duration int64
				started := record.StartedAt
				var uncertainUntil *time.Time
				if record.Type == TypeConnection {
					started = record.EstablishedAt
					if started != nil {
						uncertainUntil = &recoveredAt
					}
				}
				if started != nil {
					duration = max(0, finished.Sub(*started).Milliseconds())
				}
				updates := map[string]interface{}{
					"status": StatusUnknown, "finished_at": finished, "duration_ms": duration, "updated_at": recoveredAt,
					"connection_uncertain_until": uncertainUntil,
					"error_message":              "process interrupted before a final result was recorded",
					"speed_bps":                  0,
				}
				// Keep an immutable body intact. Status and uncertainty are separate
				// columns, so recovery never needs to load or rewrite a large body.
				if record.DetailContentID == nil && record.TaskContentID == nil {
					detail := map[string]interface{}{}
					if record.DetailJSON == "" || json.Unmarshal([]byte(record.DetailJSON), &detail) == nil && detail != nil {
						detail["interrupted"], detail["end_time_estimated"], detail["recovered_at"] = true, true, recoveredAt
						encoded, err := json.Marshal(detail)
						if err != nil {
							return err
						}
						record.DetailJSON = string(encoded)
						if err := r.storeDetail(tx, &record); err != nil {
							return err
						}
						updates["detail_json"] = record.DetailJSON
						updates["detail_content_id"], updates["detail_content_size"], updates["detail_content_sha256"] = record.DetailContentID, record.DetailContentSize, record.DetailContentSHA256
					}
				}
				if err := tx.Model(&OperationRecord{}).Where("id = ? AND status IN ?", record.ID, []Status{StatusPending, StatusRunning}).Updates(updates).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		if count < 500 {
			return nil
		}
	}
}

func (s *service) RecoverInterrupted(ctx context.Context) error {
	return s.repo.RecoverInterrupted(ctx)
}
