package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

const hashedBackupCodesPrefix = "hmac:"

// getEncryptionKey 从环境变量获取加密密钥（32字节）
// 使用现有的 ENCRYPTION_KEY 环境变量
func getEncryptionKey() ([]byte, error) {
	keyStr := os.Getenv("ENCRYPTION_KEY")
	if keyStr == "" {
		return nil, fmt.Errorf("ENCRYPTION_KEY environment variable not set")
	}

	// 将 ENCRYPTION_KEY 视为 Base64 编码的密钥
	key, err := base64.StdEncoding.DecodeString(keyStr)
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("invalid encryption key: must be 32 bytes")
	}

	return key, nil
}

func hashBackupCode(code string, key []byte) string {
	normalized := strings.ToUpper(strings.TrimSpace(code))
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(normalized))
	return hex.EncodeToString(mac.Sum(nil))
}

func encodeBackupCodeHashes(hashes []string) (string, error) {
	raw, err := json.Marshal(hashes)
	if err != nil {
		return "", fmt.Errorf("failed to marshal backup code hashes: %w", err)
	}
	return hashedBackupCodesPrefix + base64.StdEncoding.EncodeToString(raw), nil
}

func decodeBackupCodeHashes(stored string) ([]string, error) {
	if !strings.HasPrefix(stored, hashedBackupCodesPrefix) {
		return nil, fmt.Errorf("unsupported backup code hash format")
	}

	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, hashedBackupCodesPrefix))
	if err != nil {
		return nil, fmt.Errorf("failed to decode backup code hashes: %w", err)
	}

	var hashes []string
	if err := json.Unmarshal(raw, &hashes); err != nil {
		return nil, fmt.Errorf("failed to unmarshal backup code hashes: %w", err)
	}

	return hashes, nil
}

func verifyHashedBackupCode(storedHash, code string, key []byte) bool {
	computed := hashBackupCode(code, key)
	return subtle.ConstantTimeCompare([]byte(storedHash), []byte(computed)) == 1
}

// HashBackupCodes 对备份码做不可逆哈希存储。
func HashBackupCodes(codes []string) (string, error) {
	key, err := getEncryptionKey()
	if err != nil {
		return "", err
	}

	hashes := make([]string, 0, len(codes))
	for _, code := range codes {
		if strings.TrimSpace(code) == "" {
			continue
		}
		hashes = append(hashes, hashBackupCode(code, key))
	}

	return encodeBackupCodeHashes(hashes)
}
