package rest

import (
	"github.com/easyssh/server/internal/pkg/crypto"
	"gorm.io/gorm"
)

// BackupHandler handles unified JSON backup export and restore.
type BackupHandler struct {
	db        *gorm.DB
	encryptor *crypto.Encryptor
}

// NewBackupHandler creates a unified backup handler.
func NewBackupHandler(db *gorm.DB, encryptor *crypto.Encryptor) *BackupHandler {
	return &BackupHandler{db: db, encryptor: encryptor}
}
