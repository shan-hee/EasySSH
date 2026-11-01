// Package syncdata defines portable configuration and separately encrypted sync payloads.
package syncdata

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/easyssh/shared/scriptutil"
	"github.com/easyssh/shared/servergroup"
	"github.com/easyssh/shared/servertag"
	"github.com/easyssh/shared/sshutil"
	"io"
	"slices"
	"strings"
	"unicode/utf8"
)

type Record map[string]string
type Snapshot map[string]Record

type KeyReference struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	PublicKey   string `json:"public_key"`
	Fingerprint string `json:"fingerprint"`
	Algorithm   string `json:"algorithm"`
	KeySize     int    `json:"key_size"`
}

func (k KeyReference) Material() *KeyMaterial {
	return &KeyMaterial{ID: k.ID, Name: k.Name, PublicKey: k.PublicKey, Fingerprint: k.Fingerprint, Algorithm: k.Algorithm, KeySize: k.KeySize}
}

type Connection struct {
	JumpServerID string        `json:"jump_server_id,omitempty"`
	Key          *KeyReference `json:"key,omitempty"`
	Host         string        `json:"host"`
	Port         int           `json:"port"`
	Username     string        `json:"username"`
	AuthMethod   string        `json:"auth_method"`
}

func JSON(value any) string { b, _ := json.Marshal(value); return string(b) }
func Hash(value Snapshot) string {
	sum := sha256.Sum256([]byte(JSON(value)))
	return hex.EncodeToString(sum[:])
}
func Equal(a, b Record) bool { return JSON(a) == JSON(b) }
func Tags(value string) []string {
	var tags []string
	_ = json.Unmarshal([]byte(value), &tags)
	if tags == nil {
		return []string{}
	}
	return tags
}
func ParseConnection(value string) (Connection, error) {
	var c Connection
	decoder := json.NewDecoder(bytes.NewBufferString(value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&c); err != nil {
		return c, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return c, fmt.Errorf("invalid trailing connection data")
	}
	if c.Key != nil {
		if err := ValidateKey(c.Key.Material()); err != nil {
			return c, err
		}
	}
	if c.JumpServerID != "" && !servergroup.ValidID(c.JumpServerID) {
		return c, fmt.Errorf("invalid jump server ID")
	}
	if strings.TrimSpace(c.Host) == "" || len(c.Host) > 255 || strings.TrimSpace(c.Username) == "" || len(c.Username) > 50 || c.Port < 1 || c.Port > 65535 {
		return c, fmt.Errorf("invalid SSH connection")
	}
	switch c.AuthMethod {
	case "password", "key", "password_keyboard", "key_keyboard", "key_password", "key_password_keyboard", "password_key", "password_key_keyboard", "keyboard_interactive", "keyboard":
	default:
		return c, fmt.Errorf("invalid authentication method")
	}
	return c, nil
}
func Validate(snapshot Snapshot) error {
	count := len(snapshot)
	if _, hasOrder := snapshot[ServerOrderKey]; hasOrder {
		count--
	}
	if count > 10000 {
		return fmt.Errorf("sync supports at most 10000 records")
	}
	for key, r := range snapshot {
		parts := strings.Split(key, "/")
		if len(parts) != 2 || len(parts[1]) != 36 {
			return fmt.Errorf("invalid sync record ID")
		}
		identifier := parts[1]
		rawID := strings.ReplaceAll(identifier, "-", "")
		if len(rawID) != 32 || identifier[8] != '-' || identifier[13] != '-' || identifier[18] != '-' || identifier[23] != '-' {
			return fmt.Errorf("invalid sync record ID")
		}
		if _, err := hex.DecodeString(rawID); err != nil {
			return fmt.Errorf("invalid sync record ID")
		}
		allowed := map[string]bool{"name": true, "description": true, "tags": true}
		switch parts[0] {
		case "order":
			if key != ServerOrderKey || len(r) != 1 {
				return fmt.Errorf("invalid server order record")
			}
			if _, err := ParseServerOrder(r["ids"]); err != nil {
				return err
			}
			continue
		case "value":
			if key != ValueKey || len(r) != 1 || !ValidUUID(r["ref"]) {
				return fmt.Errorf("invalid vault reference")
			}
			continue
		case "group":
			if _, err := ParseGroup(identifier, r); err != nil {
				return err
			}
			continue
		case "server":
			allowed["connection"] = true
			allowed["group_id"] = true
			if r["group_id"] != "" && !servergroup.ValidID(r["group_id"]) {
				return servergroup.ErrInvalid
			}
			if _, err := ParseConnection(r["connection"]); err != nil {
				return err
			}
		case "script":
			allowed["content"] = true
			allowed["language"] = true
			if _, err := scriptutil.Command(r["language"], r["content"], nil); err != nil {
				return err
			}
		default:
			return fmt.Errorf("invalid sync record type")
		}
		for field, value := range r {
			if !allowed[field] || len(value) > 1<<20 {
				return fmt.Errorf("unsupported sync field or field too large")
			}
		}
		if utf8.RuneCountInString(r["name"]) > 100 {
			return fmt.Errorf("sync name too long")
		}
		var tags []string
		if err := json.Unmarshal([]byte(r["tags"]), &tags); err != nil || len(tags) > 100 {
			return fmt.Errorf("invalid tags")
		}
		if parts[0] == "server" {
			normalized, err := servertag.Normalize(tags)
			if err != nil || tags == nil || !slices.Equal(tags, normalized) {
				return servertag.ErrInvalid
			}
		}
		if parts[0] == "script" {
			if err := scriptutil.ValidateMetadata(r["name"], r["description"], tags); err != nil {
				return err
			}
		}
	}
	jumpLinks := map[string]string{}
	for key, record := range snapshot {
		if strings.HasPrefix(key, "server/") {
			conn, err := ParseConnection(record["connection"])
			if err != nil {
				return err
			}
			jumpLinks[strings.TrimPrefix(key, "server/")] = conn.JumpServerID
		}
		if strings.HasPrefix(key, "server/") && record["group_id"] != "" && snapshot["group/"+record["group_id"]] == nil {
			return fmt.Errorf("server references a missing group")
		}
	}
	return sshutil.ValidateJumpServers(jumpLinks)
}

func ValidUUID(id string) bool {
	if len(id) != 36 || id[8] != '-' || id[13] != '-' || id[18] != '-' || id[23] != '-' {
		return false
	}
	raw := strings.ReplaceAll(id, "-", "")
	_, err := hex.DecodeString(raw)
	return len(raw) == 32 && err == nil
}

// Display metadata and canonical UUIDs do not change the remote identity.
func SameConnection(a, b string) bool {
	left, err := ParseConnection(a)
	if err != nil {
		return false
	}
	right, err := ParseConnection(b)
	if err != nil {
		return false
	}
	if left.JumpServerID != right.JumpServerID || left.Host != right.Host || left.Port != right.Port || left.Username != right.Username || left.AuthMethod != right.AuthMethod {
		return false
	}
	if left.Key == nil || right.Key == nil {
		return left.Key == nil && right.Key == nil
	}
	return left.Key.Fingerprint == right.Key.Fingerprint
}
