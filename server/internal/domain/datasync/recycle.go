package datasync

import (
	"errors"

	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/server/internal/domain/recyclebin"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"gorm.io/gorm"
)

func init() { runtime.ArchiveDeletedSession = archiveSession }

// archivedSession is a deleted conversation in the format sync uses to carry
// conversations between devices, with its attachments beside it.
type archivedSession struct {
	Actor        protocol.Actor         `json:"actor"`
	Conversation *syncdata.Conversation `json:"conversation"`
	Attachments  map[string]string      `json:"attachments,omitempty"`
}

func archiveSession(tx *gorm.DB, row runtime.AISessionRecord, bodies *content.Service) error {
	snapshot, err := runtime.LoadSessionSnapshot(tx, row, bodies)
	if err != nil {
		return err
	}
	c := &syncdata.Conversation{Title: row.Title, Model: row.Model, CreatedAt: row.CreatedAt, Messages: snapshot.MessageViews}
	for _, task := range snapshot.Tasks {
		c.Tasks = append(c.Tasks, task.View)
	}
	syncdata.NormalizeConversation(c)
	name := row.ListTitle
	if name == "" {
		name = row.Title
	}
	return recyclebin.Put(tx, recyclebin.KindAISession, row.ID, name, archivedSession{Actor: row.Actor, Conversation: c, Attachments: syncdata.ExtractAttachments(c)})
}

// RestoreSession brings a deleted conversation back as read-only history under
// its original ID. Tasks that were running when it was deleted are not resumed.
func (s *Service) RestoreSession(tx *gorm.DB, entry recyclebin.Entry) error {
	var archived archivedSession
	if err := recyclebin.Decode(entry, &archived); err != nil {
		return err
	}
	if archived.Conversation == nil || !archived.Actor.Valid() {
		return errors.New("archived conversation is incomplete")
	}
	var live int64
	if err := tx.Model(&runtime.AISessionRecord{}).Where("id=?", entry.ResourceID).Count(&live).Error; err != nil {
		return err
	}
	if live > 0 {
		return recyclebin.ErrExists
	}
	if err := syncdata.HydrateAttachments(archived.Conversation, func(id string) (string, error) {
		data, ok := archived.Attachments[id]
		if !ok {
			return "", errors.New("archived conversation is missing an attachment")
		}
		return data, nil
	}); err != nil {
		return err
	}
	return s.importConversation(tx, entry.ResourceID, archived.Actor, archived.Conversation)
}
