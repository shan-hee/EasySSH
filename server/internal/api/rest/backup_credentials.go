package rest

import (
	"context"
	"fmt"

	crypto "github.com/easyssh/shared/secretcrypto"
)

// VerifyStoredCredentials checks that a restored root key actually decrypts the
// application's credentials. It does not return or log any plaintext.
func (h *BackupHandler) VerifyStoredCredentials(ctx context.Context) error {
	reader := &BackupHandler{db: h.db.WithContext(ctx), encryptor: h.encryptor}
	for _, section := range []backupSection{backupSectionConfig, backupSectionDatabase} {
		if _, err := reader.exportSensitiveSection(section); err != nil {
			return fmt.Errorf("stored credential verification failed: %w", err)
		}
	}
	rows, err := reader.db.Table("users").Select("id,two_factor_secret").Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var value *string
		if err := rows.Scan(&id, &value); err != nil {
			return err
		}
		if value != nil {
			if _, err := h.encryptor.DecryptSecret(*value, crypto.SecretAAD("users", id, "two_factor_secret")); err != nil {
				return fmt.Errorf("user MFA credential cannot be decrypted")
			}
		}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	rows.Close()
	signing, err := reader.db.Table("oauth_signing_keys").Select("id,encrypted_private_pem").Rows()
	if err != nil {
		return err
	}
	for signing.Next() {
		var id, value string
		if err = signing.Scan(&id, &value); err != nil {
			signing.Close()
			return err
		}
		if _, err = h.encryptor.DecryptSecret(value, []byte("oauth-signing-key:"+id)); err != nil {
			signing.Close()
			return fmt.Errorf("OAuth signing key cannot be decrypted")
		}
	}
	err = signing.Err()
	signing.Close()
	if err != nil {
		return err
	}
	vault, err := reader.db.Table("sync_vault_objects").Select("user_id,id,ciphertext").Rows()
	if err != nil {
		return err
	}
	for vault.Next() {
		var owner, id, value string
		if err = vault.Scan(&owner, &id, &value); err != nil {
			vault.Close()
			return err
		}
		if _, err = h.encryptor.DecryptSecret(value, []byte("easyssh:sync-vault:"+owner+":"+id)); err != nil {
			vault.Close()
			return fmt.Errorf("sync vault object cannot be decrypted")
		}
	}
	err = vault.Err()
	vault.Close()
	return err
}
