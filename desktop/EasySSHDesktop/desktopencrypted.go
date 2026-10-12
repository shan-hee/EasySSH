package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"strings"

	"github.com/easyssh/shared/synccrypto"
)

func (s *DesktopSyncService) encryptedBinding(owner string) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	var current string
	if err = db.QueryRow(`SELECT space_id FROM desktop_sync_state WHERE id=1 AND token<>''`).Scan(&current); err != nil {
		return err
	}
	if current != owner || owner == "" {
		return errors.New("sync account changed")
	}
	return nil
}

// Private workspace keys remain in the native process. JavaScript sees public
// views, encrypted envelopes, and the business records it needs to display.
func (s *DesktopSyncService) EncryptedCrypto(owner, input string) (string, error) {
	s.cryptoMu.Lock()
	defer s.cryptoMu.Unlock()
	if err := s.encryptedBinding(owner); err != nil {
		if s.cryptoVault != nil {
			s.cryptoVault.Lock()
		}
		return "", err
	}
	if s.cryptoOwner != owner || s.cryptoVault == nil {
		if s.cryptoVault != nil {
			s.cryptoVault.Lock()
		}
		s.cryptoOwner = owner
		s.cryptoVault = &synccrypto.Vault{}
	}
	return s.cryptoVault.Dispatch(input)
}

func (s *DesktopSyncService) EncryptedRead(owner string) (string, error) {
	if err := s.encryptedBinding(owner); err != nil {
		return "", err
	}
	db, err := s.database()
	if err != nil {
		return "", err
	}
	var value string
	err = db.QueryRow(`SELECT state_blob FROM desktop_encrypted_state WHERE space_id=?`, owner).Scan(&value)
	if err == sql.ErrNoRows || (err == nil && value == "") {
		return "{}", nil
	}
	return value, err
}

func (s *DesktopSyncService) EncryptedWrite(owner, changes string) error {
	if len(changes) > 48<<20 {
		return errors.New("encrypted local transaction too large")
	}
	if err := s.encryptedBinding(owner); err != nil {
		return err
	}
	var patch map[string]json.RawMessage
	if err := json.Unmarshal([]byte(changes), &patch); err != nil {
		return err
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Lock the account binding and recheck it in the same write transaction.
	updated, err := tx.Exec(`UPDATE desktop_sync_state SET revision=revision WHERE id=1 AND space_id=? AND token<>''`, owner)
	if err != nil {
		return err
	}
	count, _ := updated.RowsAffected()
	if count != 1 {
		return errors.New("sync account changed")
	}
	var existing string
	err = tx.QueryRow(`SELECT state_blob FROM desktop_encrypted_state WHERE space_id=?`, owner).Scan(&existing)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	values := map[string]json.RawMessage{}
	if existing != "" {
		if err = json.Unmarshal([]byte(existing), &values); err != nil {
			return err
		}
	}
	for key, value := range patch {
		if len(key) > 200 {
			return errors.New("invalid encrypted storage key")
		}
		if string(value) == "null" {
			delete(values, key)
		} else {
			values[key] = value
		}
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return err
	}
	if len(encoded) > 128<<20 {
		return errors.New("encrypted local state exceeds 128 MiB")
	}
	if _, err = tx.Exec(`INSERT INTO desktop_encrypted_state(space_id,state_blob) VALUES(?,?) ON CONFLICT(space_id) DO UPDATE SET state_blob=excluded.state_blob`, owner, string(encoded)); err != nil {
		return err
	}
	return tx.Commit()
}

// This is the only business-data transport exposed to the desktop UI. Its
// allowlist deliberately excludes the former plaintext exchange/vault routes.
func (s *DesktopSyncService) EncryptedTransport(owner, path, body string) (string, error) {
	if err := s.encryptedBinding(owner); err != nil {
		return "", err
	}
	parsed, err := url.Parse(path)
	if err != nil || parsed.Host != "" || parsed.Fragment != "" {
		return "", errors.New("invalid encrypted sync path")
	}
	allowed := parsed.Path == "/manifests" || parsed.Path == "/heads" || parsed.Path == "/objects" || (strings.HasPrefix(parsed.Path, "/objects/") && len(strings.TrimPrefix(parsed.Path, "/objects/")) == 64)
	if !allowed || (body != "" && parsed.Path != "/manifests" && parsed.Path != "/objects") {
		return "", errors.New("unsupported encrypted sync operation")
	}
	if len(body) > 12<<20 {
		return "", errors.New("encrypted sync envelope too large")
	}
	db, err := s.database()
	if err != nil {
		return "", err
	}
	var address, encrypted string
	if err = db.QueryRow(`SELECT p.server_url,s.token FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1 AND s.space_id=? AND s.token<>''`, owner).Scan(&address, &encrypted); err != nil {
		return "", err
	}
	token, err := decryptDesktopCredential(encrypted, "desktop_sync_state", "1", "token")
	if err != nil {
		return "", err
	}
	var payload []byte
	if body != "" {
		payload = []byte(body)
	}
	result, err := syncRequest(address, token, "/device"+path, payload)
	if err == nil {
		err = s.encryptedBinding(owner)
	}
	return string(result), err
}
