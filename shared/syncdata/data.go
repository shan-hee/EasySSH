// Package syncdata defines portable configuration and separately encrypted sync payloads.
package syncdata

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

type Record map[string]string
type Snapshot map[string]Record

type Connection struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	AuthMethod string `json:"auth_method"`
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
	if err := json.Unmarshal([]byte(value), &c); err != nil {
		return c, err
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
	if len(snapshot) > 10000 {
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
		case "value":
			if key != ValueKey || len(r) != 1 || !ValidUUID(r["ref"]) {
				return fmt.Errorf("invalid vault reference")
			}
			continue
		case "server":
			allowed["connection"] = true
			allowed["group"] = true
			if _, err := ParseConnection(r["connection"]); err != nil {
				return err
			}
		case "script":
			allowed["content"] = true
			allowed["language"] = true
			if strings.TrimSpace(r["name"]) == "" || r["content"] == "" || len(r["language"]) > 20 {
				return fmt.Errorf("invalid script")
			}
		default:
			return fmt.Errorf("invalid sync record type")
		}
		for field, value := range r {
			if !allowed[field] || len(value) > 1<<20 {
				return fmt.Errorf("unsupported sync field or field too large")
			}
		}
		if utf8.RuneCountInString(r["name"]) > 100 || utf8.RuneCountInString(r["group"]) > 50 {
			return fmt.Errorf("sync name or group too long")
		}
		var tags []string
		if err := json.Unmarshal([]byte(r["tags"]), &tags); err != nil || len(tags) > 100 {
			return fmt.Errorf("invalid tags")
		}
	}
	return nil
}

func ValidUUID(id string) bool {
	if len(id) != 36 || id[8] != '-' || id[13] != '-' || id[18] != '-' || id[23] != '-' {
		return false
	}
	raw := strings.ReplaceAll(id, "-", "")
	_, err := hex.DecodeString(raw)
	return len(raw) == 32 && err == nil
}
