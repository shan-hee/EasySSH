package app

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"sync/atomic"
	"time"

	"github.com/easyssh/shared/activitystats"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

var desktopHostTrustDB atomic.Pointer[sql.DB]

var errDesktopHostKeyRevoked = errors.New("host key trust has been revoked")

type DesktopHostKeyVerificationError struct {
	Host            string `json:"host"`
	Port            int    `json:"port"`
	ExpectedKey     string `json:"expected_key"`
	ReceivedKey     string `json:"received_key"`
	ExpectedKeyType string `json:"expected_key_type"`
	ReceivedKeyType string `json:"received_key_type"`
	Message         string `json:"message"`
}

func (e *DesktopHostKeyVerificationError) Error() string { return e.Message }

func desktopHostKeyCallback() ssh.HostKeyCallback {
	return func(hostname string, _ net.Addr, key ssh.PublicKey) error {
		return verifyDesktopHostKey(hostname, key)
	}
}

func desktopHostKeyCallbackWithChangeApproval(approve func(*DesktopHostKeyVerificationError) (bool, error)) ssh.HostKeyCallback {
	return func(hostname string, _ net.Addr, key ssh.PublicKey) error {
		err := verifyDesktopHostKey(hostname, key)
		if err == nil {
			return nil
		}
		var details *DesktopHostKeyVerificationError
		if !errors.As(err, &details) || approve == nil {
			return err
		}
		confirmed, approvalErr := approve(details)
		if approvalErr != nil {
			return approvalErr
		}
		if !confirmed {
			return err
		}
		return trustDesktopHostKey(details.Host, details.Port, key)
	}
}

func verifyDesktopHostKey(address string, key ssh.PublicKey) error {
	db := desktopHostTrustDB.Load()
	if db == nil {
		return errors.New("desktop host trust database is unavailable")
	}
	host, port, err := sshutil.ParseHostAddress(address)
	if err != nil {
		return err
	}
	var publicKey, fingerprint, status string
	err = db.QueryRow(`SELECT public_key, fingerprint, trust_status FROM ssh_host_keys WHERE host = ? AND port = ? AND key_type = ?`, host, port, key.Type()).Scan(&publicKey, &fingerprint, &status)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if status == "revoked" {
		return errDesktopHostKeyRevoked
	}
	received := ssh.FingerprintSHA256(key)
	if err != nil || status != "trusted" || publicKey != base64.StdEncoding.EncodeToString(key.Marshal()) || fingerprint != received {
		return &DesktopHostKeyVerificationError{Host: host, Port: port, ExpectedKey: fingerprint,
			ExpectedKeyType: key.Type(), ReceivedKey: received, ReceivedKeyType: key.Type(),
			Message: fmt.Sprintf("Owner confirmation required for SSH host %s:%d (%s, %s)", host, port, key.Type(), received)}
	}
	_, err = db.Exec(`UPDATE ssh_host_keys SET last_seen = ? WHERE host = ? AND port = ? AND key_type = ?`, time.Now().UTC().Format(time.RFC3339Nano), host, port, key.Type())
	return err
}

func trustDesktopHostKey(host string, port int, key ssh.PublicKey) error {
	db := desktopHostTrustDB.Load()
	if db == nil {
		return errors.New("desktop host trust database is unavailable")
	}
	host = sshutil.NormalizeHost(host)
	if host == "" || port < 1 || port > 65535 {
		return errors.New("invalid host trust endpoint")
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var oldKey, oldStatus string
	err = tx.QueryRow(`SELECT public_key, trust_status FROM ssh_host_keys WHERE host = ? AND port = ? AND key_type = ?`, host, port, key.Type()).Scan(&oldKey, &oldStatus)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	publicKey := base64.StdEncoding.EncodeToString(key.Marshal())
	if err == nil && publicKey == oldKey && oldStatus == "trusted" {
		return tx.Commit()
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = tx.Exec(`INSERT INTO ssh_host_keys(host, port, key_type, public_key, fingerprint, confirmed_at, first_seen, last_seen, trust_status)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'trusted')
		ON CONFLICT(host, port, key_type) DO UPDATE SET public_key=excluded.public_key, fingerprint=excluded.fingerprint,
		confirmed_at=excluded.confirmed_at, last_seen=excluded.last_seen, trust_status='trusted'`,
		host, port, key.Type(), publicKey, ssh.FingerprintSHA256(key), now, now, now)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE desktop_servers SET connection_revision = connection_revision + 1, updated_at = ? WHERE host = ? AND port = ?`, now, host, port); err != nil {
		return err
	}
	resources := []activitystats.Resource{}
	rows, err := tx.Query("SELECT id,COALESCE(NULLIF(name,''),host) FROM desktop_servers WHERE host=? AND port=? ORDER BY id", host, port)
	if err != nil {
		return err
	}
	for rows.Next() {
		var resource activitystats.Resource
		if err = rows.Scan(&resource.ServerID, &resource.Name); err != nil {
			rows.Close()
			return err
		}
		resources = append(resources, resource)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	endpoint := fmt.Sprintf("%s:%d", host, port)
	eventResource := uuid.NewSHA1(uuid.NameSpaceDNS, []byte(endpoint+":"+key.Type())).String()
	if err = recordDesktopConfiguration(tx, "host_key_confirmed", "host_key", eventResource, endpoint, "manual", []string{"public_key", "trust_status"}, resources); err != nil {
		return err
	}
	return tx.Commit()
}

// Every local SSH entry calls this before dialing. A remembered RSA public key
// permits RSA SHA-2 signatures; it does not turn on SHA-1 negotiation.
func configureDesktopHostKeyAlgorithms(config *ssh.ClientConfig, host string, port int) error {
	db := desktopHostTrustDB.Load()
	if db == nil {
		return errors.New("desktop host trust database is unavailable")
	}
	rows, err := db.Query(`SELECT key_type, trust_status FROM ssh_host_keys WHERE host = ? AND port = ?`, sshutil.NormalizeHost(host), port)
	if err != nil {
		return err
	}
	var types []string
	count := 0
	for rows.Next() {
		var keyType, status string
		if err := rows.Scan(&keyType, &status); err != nil {
			rows.Close()
			return err
		}
		count++
		if status == "trusted" {
			types = append(types, keyType)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if count > 0 && len(types) == 0 {
		return errDesktopHostKeyRevoked
	}
	config.HostKeyAlgorithms, err = sshutil.HostKeyAlgorithms(types)
	return err
}
