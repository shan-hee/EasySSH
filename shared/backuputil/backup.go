package backuputil

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	Format                    = "easyssh-unified-backup"
	Version                   = "3.0"
	SensitivePayloadVersion   = "3"
	MaxRestoreFileSizeBytes   = 32 << 20
	RestoreMultipartSizeBytes = MaxRestoreFileSizeBytes + (1 << 20)
)

type ContentSelection struct {
	Config    bool `json:"config"`
	Database  bool `json:"database"`
	Sensitive bool `json:"sensitive,omitempty"`
}

type UnifiedBackup struct {
	Format     string           `json:"format"`
	Version    string           `json:"version"`
	ExportTime string           `json:"export_time"`
	Contents   ContentSelection `json:"contents"`
	Config     *DataSection     `json:"config,omitempty"`
	Database   *DataSection     `json:"database,omitempty"`
	Sensitive  string           `json:"sensitive,omitempty"`
	Warnings   []string         `json:"warnings,omitempty"`
}

type DataSection struct {
	Driver string  `json:"driver"`
	Tables []Table `json:"tables"`
}

type Table struct {
	Name       string           `json:"name"`
	PrimaryKey []string         `json:"primary_key"`
	Columns    []string         `json:"columns"`
	Rows       []map[string]any `json:"rows"`
}

type SensitivePayload struct {
	Version    string           `json:"version"`
	ExportTime string           `json:"export_time"`
	Contents   ContentSelection `json:"contents"`
	BaseSHA256 string           `json:"base_sha256"`
	Config     *DataSection     `json:"config,omitempty"`
	Database   *DataSection     `json:"database,omitempty"`
	Warnings   []string         `json:"warnings,omitempty"`
}

type RestoreConflictStrategy string

const (
	RestoreConflictSkip      RestoreConflictStrategy = "skip"
	RestoreConflictOverwrite RestoreConflictStrategy = "overwrite"
	RestoreConflictError     RestoreConflictStrategy = "error"
)

func ParseRestoreConflictStrategy(value string) (RestoreConflictStrategy, error) {
	switch RestoreConflictStrategy(strings.ToLower(strings.TrimSpace(value))) {
	case "", RestoreConflictError:
		return RestoreConflictError, nil
	case RestoreConflictSkip:
		return RestoreConflictSkip, nil
	case RestoreConflictOverwrite:
		return RestoreConflictOverwrite, nil
	default:
		return "", fmt.Errorf("unsupported conflict strategy: %s", value)
	}
}

func ValidateUnifiedBackup(backup *UnifiedBackup) error {
	if strings.TrimSpace(backup.Format) != Format {
		return fmt.Errorf("unsupported backup format")
	}
	if strings.TrimSpace(backup.Version) == "" {
		return fmt.Errorf("missing backup version")
	}
	if strings.TrimSpace(backup.Version) != Version {
		return fmt.Errorf("unsupported backup version: %s", backup.Version)
	}
	if backup.Config == nil && backup.Database == nil {
		return fmt.Errorf("backup has no restorable content")
	}
	if backup.Contents.Config != (backup.Config != nil) || backup.Contents.Database != (backup.Database != nil) {
		return fmt.Errorf("backup content metadata is inconsistent")
	}
	if backup.Contents.Sensitive != (strings.TrimSpace(backup.Sensitive) != "") {
		return fmt.Errorf("backup sensitive metadata is inconsistent")
	}
	return nil
}

func BaseSHA256(backup *UnifiedBackup) (string, error) {
	base := struct {
		Format     string           `json:"format"`
		Version    string           `json:"version"`
		ExportTime string           `json:"export_time"`
		Contents   ContentSelection `json:"contents"`
		Config     *DataSection     `json:"config,omitempty"`
		Database   *DataSection     `json:"database,omitempty"`
	}{
		Format:     backup.Format,
		Version:    backup.Version,
		ExportTime: backup.ExportTime,
		Contents:   backup.Contents,
		Config:     backup.Config,
		Database:   backup.Database,
	}

	data, err := json.Marshal(base)
	if err != nil {
		return "", fmt.Errorf("failed to serialize backup base digest: %w", err)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

func VerifySensitiveBaseSHA256(backup *UnifiedBackup, payload *SensitivePayload) error {
	expected := strings.TrimSpace(payload.BaseSHA256)
	if expected == "" {
		return errors.New("sensitive backup base digest is missing")
	}
	actual, err := BaseSHA256(backup)
	if err != nil {
		return err
	}
	if subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) != 1 {
		return errors.New("backup base content does not match encrypted sensitive payload")
	}
	return nil
}
