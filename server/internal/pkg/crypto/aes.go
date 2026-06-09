package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
)

var (
	ErrInvalidKey        = errors.New("invalid encryption key")
	ErrInvalidCiphertext = errors.New("invalid ciphertext")
)

const encryptedValuePrefix = "enc:v1:"

// Encryptor AES 加密器
type Encryptor struct {
	key []byte
}

// NewEncryptor 创建加密器
// key 必须是 Base64 编码的 32 字节密钥（与 ENCRYPTION_KEY 语义保持一致）
func NewEncryptor(key string) (*Encryptor, error) {
	if key == "" {
		return nil, ErrInvalidKey
	}

	keyBytes, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(keyBytes) != 32 {
		return nil, ErrInvalidKey
	}

	return &Encryptor{key: keyBytes}, nil
}

// Encrypt 加密数据
func (e *Encryptor) Encrypt(plaintext string) (string, error) {
	return e.EncryptWithAAD(plaintext, nil)
}

// EncryptWithAAD 加密数据，并将上下文信息加入 GCM 认证数据。
func (e *Encryptor) EncryptWithAAD(plaintext string, aad []byte) (string, error) {
	if plaintext == "" {
		return "", nil
	}

	// 创建 AES cipher
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", err
	}

	// 使用 GCM 模式
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	// 生成随机 nonce
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	// 加密
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), aad)

	// Base64 编码并加版本前缀
	return encryptedValuePrefix + base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt 解密数据
func (e *Encryptor) Decrypt(ciphertext string) (string, error) {
	return e.DecryptWithAAD(ciphertext, nil)
}

// DecryptWithAAD 解密数据，并要求上下文信息与加密时一致。
func (e *Encryptor) DecryptWithAAD(ciphertext string, aad []byte) (string, error) {
	if ciphertext == "" {
		return "", nil
	}
	if len(ciphertext) <= len(encryptedValuePrefix) || ciphertext[:len(encryptedValuePrefix)] != encryptedValuePrefix {
		return "", ErrInvalidCiphertext
	}

	// Base64 解码
	data, err := base64.StdEncoding.DecodeString(ciphertext[len(encryptedValuePrefix):])
	if err != nil {
		return "", ErrInvalidCiphertext
	}

	// 创建 AES cipher
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", err
	}

	// 使用 GCM 模式
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	// 验证数据长度
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", ErrInvalidCiphertext
	}

	// 提取 nonce 和 ciphertext
	nonce, cipherBytes := data[:nonceSize], data[nonceSize:]

	// 解密
	plaintext, err := gcm.Open(nil, nonce, cipherBytes, aad)
	if err != nil {
		return "", ErrInvalidCiphertext
	}

	return string(plaintext), nil
}
