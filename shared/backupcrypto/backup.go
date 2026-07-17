package backupcrypto

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"filippo.io/age"
	"filippo.io/age/armor"
)

const armoredHeader = "-----BEGIN AGE ENCRYPTED FILE-----"

func EncryptJSONWithPassphrase(payload any, passphrase string) (string, error) {
	if strings.TrimSpace(passphrase) == "" {
		return "", errors.New("age passphrase is required")
	}

	recipient, err := age.NewScryptRecipient(passphrase)
	if err != nil {
		return "", fmt.Errorf("failed to create age scrypt recipient: %w", err)
	}
	return encryptJSON(payload, []age.Recipient{recipient})
}

func EncryptJSONWithRecipients(payload any, encodedRecipients []string) (string, error) {
	recipients, err := parseX25519Recipients(encodedRecipients)
	if err != nil {
		return "", err
	}
	return encryptJSON(payload, recipients)
}

// ValidateX25519Recipients validates recipient syntax before backup data is assembled and encrypted.
func ValidateX25519Recipients(encodedRecipients []string) error {
	_, err := parseX25519Recipients(encodedRecipients)
	return err
}

func parseX25519Recipients(encodedRecipients []string) ([]age.Recipient, error) {
	recipients := make([]age.Recipient, 0, len(encodedRecipients))
	for index, encoded := range encodedRecipients {
		encoded = strings.TrimSpace(encoded)
		if encoded == "" {
			return nil, fmt.Errorf("age recipient %d is empty", index+1)
		}
		recipient, err := age.ParseX25519Recipient(encoded)
		if err != nil {
			return nil, fmt.Errorf("invalid age X25519 recipient %d: %w", index+1, err)
		}
		recipients = append(recipients, recipient)
	}
	if len(recipients) == 0 {
		return nil, errors.New("at least one age X25519 recipient is required")
	}
	return recipients, nil
}

// ValidateX25519Identities validates identity syntax before decrypting an uploaded backup.
func ValidateX25519Identities(encodedIdentities []string) error {
	_, err := parseX25519Identities(encodedIdentities)
	return err
}

func parseX25519Identities(encodedIdentities []string) ([]age.Identity, error) {
	identities := make([]age.Identity, 0, len(encodedIdentities))
	for index, encoded := range encodedIdentities {
		encoded = strings.TrimSpace(encoded)
		if encoded == "" {
			return nil, fmt.Errorf("age identity %d is empty", index+1)
		}
		identity, err := age.ParseX25519Identity(encoded)
		if err != nil {
			return nil, fmt.Errorf("invalid age X25519 identity %d: %w", index+1, err)
		}
		identities = append(identities, identity)
	}
	if len(identities) == 0 {
		return nil, errors.New("at least one age X25519 identity is required")
	}
	return identities, nil
}

func DecryptJSON(ciphertext string, passphrase string, encodedIdentities []string, target any) error {
	if strings.TrimSpace(ciphertext) == "" {
		return errors.New("age encrypted payload is missing")
	}
	if !strings.HasPrefix(strings.TrimSpace(ciphertext), armoredHeader) {
		return errors.New("invalid age armored payload")
	}

	if strings.TrimSpace(passphrase) != "" && len(encodedIdentities) != 0 {
		return errors.New("age passphrase and identities are mutually exclusive")
	}

	identities := make([]age.Identity, 0, len(encodedIdentities))
	if strings.TrimSpace(passphrase) != "" {
		identity, err := age.NewScryptIdentity(passphrase)
		if err != nil {
			return fmt.Errorf("failed to create age scrypt identity: %w", err)
		}
		identities = append(identities, identity)
	} else {
		parsed, err := parseX25519Identities(encodedIdentities)
		if err != nil {
			return err
		}
		identities = append(identities, parsed...)
	}
	if len(identities) == 0 {
		return errors.New("age passphrase or X25519 identity is required")
	}

	reader, err := age.Decrypt(armor.NewReader(strings.NewReader(ciphertext)), identities...)
	if err != nil {
		return errors.New("failed to decrypt age payload")
	}
	decoder := json.NewDecoder(reader)
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("failed to decode decrypted backup payload: %w", err)
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("decrypted backup payload contains trailing data")
	}
	return nil
}

func encryptJSON(payload any, recipients []age.Recipient) (string, error) {
	plaintext, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("failed to serialize backup payload: %w", err)
	}

	var output bytes.Buffer
	armoredWriter := armor.NewWriter(&output)
	encryptedWriter, err := age.Encrypt(armoredWriter, recipients...)
	if err != nil {
		_ = armoredWriter.Close()
		return "", fmt.Errorf("failed to initialize age encryption: %w", err)
	}
	if _, err := encryptedWriter.Write(plaintext); err != nil {
		return "", fmt.Errorf("failed to encrypt backup payload: %w", err)
	}
	if err := encryptedWriter.Close(); err != nil {
		return "", fmt.Errorf("failed to finalize age encryption: %w", err)
	}
	if err := armoredWriter.Close(); err != nil {
		return "", fmt.Errorf("failed to finalize age armor: %w", err)
	}
	return output.String(), nil
}
