package app

import (
	"context"
	"encoding/json"
	"errors"
	"log"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/resultstore"
)

var errDesktopAISnapshotConflict = errors.New("ai_snapshot_conflict")

const desktopAITimeLayout = "2006-01-02T15:04:05.000000000Z"

// The caller owns the active turn or sessionMu. Concurrent approvals reload the
// latest committed conversation under sessionMu before applying their own result.
// The writer retries only this immutable database value, never a remote tool.
func (s *DesktopAIService) saveSession(record desktopAISessionRecord) error {
	s.mu.Lock()
	request := s.activeRequests[record.ID]
	stopped := s.closed || s.stopping && request == nil
	var failure error
	if request != nil {
		failure = request.StorageErr
	}
	s.mu.Unlock()
	if stopped {
		return errors.New("AI service is stopping")
	}
	if failure != nil {
		return failure
	}
	owned, err := cloneDesktopAISession(record)
	if err != nil {
		return err
	}
	err = resultstore.Write(context.Background(), func(ctx context.Context) error {
		err := s.saveSessionRaw(ctx, owned)
		if errors.Is(err, errDesktopAISnapshotConflict) {
			return resultstore.Permanent(err)
		}
		return err
	})
	if err == nil {
		s.emitAISessionEvent(DesktopAISessionEvent{SessionID: record.ID, Type: "history.changed", History: &protocol.AIHistoryChange{SessionID: record.ID, UpdatedAt: parseDesktopAITime(record.UpdatedAt)}})
		return nil
	}
	log.Printf("[AI] desktop conversation persistence failed: session=%s error=%v", record.ID, err)
	failure = resultstore.ErrUnavailable
	if errors.Is(err, errDesktopAISnapshotConflict) {
		failure = errDesktopAISnapshotConflict
	}
	s.mu.Lock()
	if request != nil && s.activeRequests[record.ID] == request {
		request.StorageErr = failure
		request.Cancel()
	}
	s.mu.Unlock()
	return failure
}

func cloneDesktopAISession(record desktopAISessionRecord) (desktopAISessionRecord, error) {
	data, err := json.Marshal(record)
	if err != nil {
		return desktopAISessionRecord{}, err
	}
	var owned desktopAISessionRecord
	err = json.Unmarshal(data, &owned)
	return owned, err
}
