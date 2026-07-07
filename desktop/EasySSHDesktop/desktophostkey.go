package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

const (
	desktopHostKeyTrustTrusted = "trusted"
	desktopHostKeyTrustChanged = "changed"
	desktopHostKeyTrustRevoked = "revoked"
)

var (
	errDesktopHostKeyRevoked = errors.New("host key trust has been revoked")

	desktopHostKeyStoreMu     sync.Mutex
	desktopHostKeyStoreLoaded bool
	desktopHostKeyStore       map[string]DesktopHostKeyRecord
)

type DesktopHostKeyRecord struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	KeyType     string `json:"key_type"`
	PublicKey   string `json:"public_key"`
	Fingerprint string `json:"fingerprint"`
	FirstSeen   string `json:"first_seen"`
	LastSeen    string `json:"last_seen"`
	TrustStatus string `json:"trust_status"`
}

type DesktopHostKeyVerificationError struct {
	Host            string `json:"host"`
	Port            int    `json:"port"`
	ExpectedKey     string `json:"expected_key"`
	ReceivedKey     string `json:"received_key"`
	ExpectedKeyType string `json:"expected_key_type"`
	ReceivedKeyType string `json:"received_key_type"`
	Message         string `json:"message"`
}

func (e *DesktopHostKeyVerificationError) Error() string {
	return e.Message
}

func desktopHostKeyCallback() ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		return verifyDesktopHostKey(hostname, key)
	}
}

func desktopHostKeyCallbackWithChangeApproval(
	approve func(*DesktopHostKeyVerificationError) (bool, error),
) ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := verifyDesktopHostKey(hostname, key)
		if err == nil {
			return nil
		}

		var hostKeyErr *DesktopHostKeyVerificationError
		if !errors.As(err, &hostKeyErr) {
			return err
		}

		approved, approveErr := approve(hostKeyErr)
		if approveErr != nil {
			return approveErr
		}
		if !approved {
			return err
		}

		return trustDesktopHostKey(hostKeyErr.Host, hostKeyErr.Port, key)
	}
}

func verifyDesktopHostKey(hostname string, key ssh.PublicKey) error {
	host, port := parseDesktopHostKeyAddress(hostname)
	fingerprint := desktopHostKeyFingerprint(key)
	keyType := key.Type()
	now := time.Now().UTC()
	nowString := now.Format(time.RFC3339Nano)

	desktopHostKeyStoreMu.Lock()
	defer desktopHostKeyStoreMu.Unlock()

	if err := ensureDesktopHostKeyStoreLocked(); err != nil {
		return err
	}

	storeKey := desktopHostKeyRecordKey(host, port)
	existing, ok := desktopHostKeyStore[storeKey]
	if !ok {
		desktopHostKeyStore[storeKey] = DesktopHostKeyRecord{
			Host:        host,
			Port:        port,
			KeyType:     keyType,
			PublicKey:   base64.StdEncoding.EncodeToString(key.Marshal()),
			Fingerprint: fingerprint,
			FirstSeen:   nowString,
			LastSeen:    nowString,
			TrustStatus: desktopHostKeyTrustTrusted,
		}
		return writeDesktopHostKeyStoreLocked()
	}

	if existing.TrustStatus == desktopHostKeyTrustRevoked {
		return fmt.Errorf("%w for %s:%d", errDesktopHostKeyRevoked, host, port)
	}

	if existing.Fingerprint != fingerprint {
		existing.TrustStatus = desktopHostKeyTrustChanged
		desktopHostKeyStore[storeKey] = existing
		if err := writeDesktopHostKeyStoreLocked(); err != nil {
			desktopLogPrintf("failed to persist changed desktop host key state: %v", err)
		}

		return &DesktopHostKeyVerificationError{
			Host:            host,
			Port:            port,
			ExpectedKey:     existing.Fingerprint,
			ReceivedKey:     fingerprint,
			ExpectedKeyType: existing.KeyType,
			ReceivedKeyType: keyType,
			Message: fmt.Sprintf(
				"SSH host key verification failed for %s:%d. Expected fingerprint %s (%s), but received %s (%s).",
				host,
				port,
				existing.Fingerprint,
				existing.KeyType,
				fingerprint,
				keyType,
			),
		}
	}

	existing.LastSeen = nowString
	existing.TrustStatus = desktopHostKeyTrustTrusted
	desktopHostKeyStore[storeKey] = existing
	return writeDesktopHostKeyStoreLocked()
}

func trustDesktopHostKey(host string, port int, key ssh.PublicKey) error {
	host = strings.TrimSpace(host)
	if host == "" {
		return errors.New("host is required")
	}
	if port <= 0 {
		port = 22
	}

	nowString := time.Now().UTC().Format(time.RFC3339Nano)

	desktopHostKeyStoreMu.Lock()
	defer desktopHostKeyStoreMu.Unlock()

	if err := ensureDesktopHostKeyStoreLocked(); err != nil {
		return err
	}

	storeKey := desktopHostKeyRecordKey(host, port)
	existing := desktopHostKeyStore[storeKey]
	if existing.FirstSeen == "" {
		existing.FirstSeen = nowString
	}
	existing.Host = host
	existing.Port = port
	existing.KeyType = key.Type()
	existing.PublicKey = base64.StdEncoding.EncodeToString(key.Marshal())
	existing.Fingerprint = desktopHostKeyFingerprint(key)
	existing.LastSeen = nowString
	existing.TrustStatus = desktopHostKeyTrustTrusted
	desktopHostKeyStore[storeKey] = existing

	return writeDesktopHostKeyStoreLocked()
}

func ensureDesktopHostKeyStoreLocked() error {
	if desktopHostKeyStoreLoaded {
		return nil
	}

	content, err := os.ReadFile(desktopHostKeyStorePath())
	if errors.Is(err, os.ErrNotExist) {
		desktopHostKeyStoreLoaded = true
		desktopHostKeyStore = map[string]DesktopHostKeyRecord{}
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to read desktop SSH host key store: %w", err)
	}

	var records []DesktopHostKeyRecord
	if err := json.Unmarshal(content, &records); err != nil {
		return fmt.Errorf("failed to parse desktop SSH host key store: %w", err)
	}

	desktopHostKeyStore = map[string]DesktopHostKeyRecord{}
	for _, record := range records {
		record.Host = strings.TrimSpace(record.Host)
		if record.Host == "" {
			continue
		}
		if record.Port <= 0 {
			record.Port = 22
		}
		if record.TrustStatus == "" {
			record.TrustStatus = desktopHostKeyTrustTrusted
		}
		desktopHostKeyStore[desktopHostKeyRecordKey(record.Host, record.Port)] = record
	}

	desktopHostKeyStoreLoaded = true
	return nil
}

func writeDesktopHostKeyStoreLocked() error {
	if desktopHostKeyStore == nil {
		return nil
	}

	records := make([]DesktopHostKeyRecord, 0, len(desktopHostKeyStore))
	for _, record := range desktopHostKeyStore {
		records = append(records, record)
	}

	content, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}

	path := desktopHostKeyStorePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, content, 0o600)
}

func desktopHostKeyStorePath() string {
	return filepath.Join(desktopDataDir(), "ssh-host-keys.json")
}

func desktopHostKeyRecordKey(host string, port int) string {
	return net.JoinHostPort(strings.ToLower(strings.TrimSpace(host)), strconv.Itoa(port))
}

func parseDesktopHostKeyAddress(hostname string) (string, int) {
	host, portText, err := net.SplitHostPort(strings.TrimSpace(hostname))
	if err != nil {
		host = strings.Trim(strings.TrimSpace(hostname), "[]")
		portText = "22"
	}
	if host == "" {
		host = strings.Trim(strings.TrimSpace(hostname), "[]")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port <= 0 {
		port = 22
	}
	return host, port
}

func desktopHostKeyFingerprint(key ssh.PublicKey) string {
	hash := sha256.Sum256(key.Marshal())
	return fmt.Sprintf("SHA256:%s", base64.RawStdEncoding.EncodeToString(hash[:]))
}
