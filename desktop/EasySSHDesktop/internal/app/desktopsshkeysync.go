package app

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/easyssh/shared/syncdata"
)

// The caller owns the transaction, including server references and sync state.
func mergeDesktopSyncKey(tx *sql.Tx, input *syncdata.KeyMaterial) (string, error) {
	if err := syncdata.ValidateKey(input); err != nil {
		return "", err
	}
	incoming := strings.ToLower(input.ID)
	for _, table := range []string{"desktop_ssh_keys", "desktop_ssh_key_aliases"} {
		column := "id"
		if table == "desktop_ssh_key_aliases" {
			column = "alias_id"
		}
		var fp string
		err := tx.QueryRow("SELECT fingerprint FROM "+table+" WHERE "+column+"=?", incoming).Scan(&fp)
		if err != nil && err != sql.ErrNoRows {
			return "", err
		}
		if err == nil && fp != input.Fingerprint {
			return "", errors.New("key ID identifies another public key")
		}
	}
	var id, material, phrase string
	var required bool
	err := tx.QueryRow("SELECT id,private_key,saved_passphrase,passphrase_required FROM desktop_ssh_keys WHERE fingerprint=?", input.Fingerprint).Scan(&id, &material, &phrase, &required)
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err == sql.ErrNoRows {
		material, err = encryptDesktopCredential(input.PrivateKey, "desktop_ssh_keys", incoming, "private_key")
		if err != nil {
			return "", err
		}
		phrase, err = encryptDesktopCredential(input.SavedPassphrase, "desktop_ssh_keys", incoming, "saved_passphrase")
		if err != nil {
			return "", err
		}
		_, err = tx.Exec(`INSERT INTO desktop_ssh_keys(id,name,public_key,fingerprint,algorithm,key_size,passphrase_required,private_key,saved_passphrase,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, incoming, input.Name, input.PublicKey, input.Fingerprint, input.Algorithm, input.KeySize, input.PassphraseRequired, material, phrase, now, now)
		if err != nil {
			return "", err
		}
		if err = recordDesktopConfiguration(tx, "ssh_key_imported", "ssh_key", incoming, input.Name, "automation", []string{"created"}, nil); err != nil {
			return "", err
		}
		return incoming, nil
	}
	original := id
	if incoming < id {
		id = incoming
	}
	if id != original || material == "" && input.PrivateKey != "" {
		fields := []string{}
		if id != original {
			fields = append(fields, "canonical_id")
		}
		if material == "" && input.PrivateKey != "" {
			fields = append(fields, "private_key", "saved_passphrase")
		}
		material, err = decryptDesktopCredential(material, "desktop_ssh_keys", original, "private_key")
		if err != nil {
			return "", err
		}
		phrase, err = decryptDesktopCredential(phrase, "desktop_ssh_keys", original, "saved_passphrase")
		if err != nil {
			return "", err
		}
		if material == "" && input.PrivateKey != "" {
			material, phrase, required = input.PrivateKey, input.SavedPassphrase, input.PassphraseRequired
		}
		material, err = encryptDesktopCredential(material, "desktop_ssh_keys", id, "private_key")
		if err != nil {
			return "", err
		}
		phrase, err = encryptDesktopCredential(phrase, "desktop_ssh_keys", id, "saved_passphrase")
		if err != nil {
			return "", err
		}
		if _, err = tx.Exec("UPDATE desktop_ssh_keys SET id=?,private_key=?,saved_passphrase=?,passphrase_required=?,updated_at=? WHERE id=?", id, material, phrase, required, now, original); err != nil {
			return "", err
		}
		var name string
		if err = tx.QueryRow("SELECT name FROM desktop_ssh_keys WHERE id=?", id).Scan(&name); err != nil {
			return "", err
		}
		resources, err := desktopKeyResources(tx, id)
		if err != nil {
			return "", err
		}
		if err = recordDesktopConfiguration(tx, "ssh_key_merged", "ssh_key", id, name, "automation", fields, resources); err != nil {
			return "", err
		}
	}

	for _, alias := range []string{original, incoming} {
		if alias == id {
			continue
		}
		if _, err = tx.Exec("INSERT INTO desktop_ssh_key_aliases(alias_id,canonical_id,fingerprint) VALUES(?,?,?) ON CONFLICT(alias_id) DO UPDATE SET canonical_id=excluded.canonical_id", alias, id, input.Fingerprint); err != nil {
			return "", err
		}
	}
	return id, nil
}
