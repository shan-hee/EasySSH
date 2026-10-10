package syncdata

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/easyssh/shared/aichatui"
)

const ValueKey = "value/00000000-0000-4000-8000-000000000001"
const AIConfigID = "00000000-0000-4000-8000-000000000002"

type SyncScopes struct {
	Credentials bool `json:"credentials"`
	AIConfig    bool `json:"ai_config"`
	Sessions    bool `json:"sessions"`
}

func (s SyncScopes) Allows(kind string) bool {
	switch kind {
	case "credential":
		return s.Credentials
	case "ai_config":
		return s.AIConfig
	case "ai_session":
		return s.Sessions
	}
	return false
}

type KeyMaterial struct {
	Name               string `json:"name"`
	PublicKey          string `json:"public_key"`
	PrivateKey         string `json:"private_key"`
	Fingerprint        string `json:"fingerprint"`
	Algorithm          string `json:"algorithm"`
	KeySize            int    `json:"key_size"`
	PassphraseRequired bool   `json:"passphrase_required"`
}
type Credential struct {
	Connection string       `json:"connection"`
	Password   string       `json:"password"`
	Key        *KeyMaterial `json:"key,omitempty"`
}
type AIConfig struct {
	Enabled  bool   `json:"enabled"`
	Provider string `json:"provider"`
	Endpoint string `json:"endpoint"`
	APIKey   string `json:"api_key"`
	Models   string `json:"models"`
}

// Conversation contains presentation history, not executable tool calls or grants.
// Parent relationships and unchanged message IDs preserve the selected branch.
type Conversation struct {
	Title     string                 `json:"title"`
	Model     string                 `json:"model"`
	CreatedAt time.Time              `json:"created_at"`
	Messages  []aichatui.MessageView `json:"messages"`
	Parents   map[string]string      `json:"parents"`
	Tasks     []aichatui.TaskView    `json:"tasks"`
}
type VaultPayload struct {
	Source       string        `json:"source"`
	UpdatedAt    time.Time     `json:"updated_at"`
	Kind         string        `json:"kind"`
	Deleted      bool          `json:"deleted,omitempty"`
	Credential   *Credential   `json:"credential,omitempty"`
	AIConfig     *AIConfig     `json:"ai_config,omitempty"`
	Conversation *Conversation `json:"conversation,omitempty"`
}

func (p VaultPayload) Validate(kind string) error {
	if p.Kind != kind {
		return errors.New("sync payload kind mismatch")
	}
	if p.Deleted {
		if kind != "ai_session" || p.Credential != nil || p.AIConfig != nil || p.Conversation != nil {
			return errors.New("invalid deletion")
		}
		return nil
	}
	switch kind {
	case "credential":
		if p.Credential == nil || p.AIConfig != nil || p.Conversation != nil {
			return errors.New("invalid credential payload")
		}
		if _, err := ParseConnection(p.Credential.Connection); err != nil {
			return err
		}
		if len(p.Credential.Password) > 65536 {
			return errors.New("password too large")
		}
		if k := p.Credential.Key; k != nil && (len(k.PrivateKey) > 1<<20 || k.Fingerprint == "" || k.PublicKey == "") {
			return errors.New("invalid key material")
		}
	case "ai_config":
		if p.AIConfig == nil || p.Credential != nil || p.Conversation != nil {
			return errors.New("invalid AI configuration")
		}
		c := p.AIConfig
		if c.Provider != "openai" && c.Provider != "openai-response" && c.Provider != "anthropic" && c.Provider != "gemini" {
			return errors.New("invalid AI provider")
		}
		if len(c.APIKey) > 65536 || len(c.Endpoint) > 4096 || len(c.Models) > 65536 {
			return errors.New("AI configuration too large")
		}
	case "ai_session":
		if p.Conversation == nil || p.Credential != nil || p.AIConfig != nil {
			return errors.New("invalid conversation")
		}
		c := p.Conversation
		if len(c.Messages) > 10000 || len(c.Tasks) > 10000 || len(c.Title) > 4096 {
			return errors.New("conversation too large")
		}
		ids := map[string]bool{}
		for _, m := range c.Messages {
			if m.ID == "" || len(m.ID) > 200 || ids[m.ID] || (m.Role != "user" && m.Role != "assistant") {
				return errors.New("invalid conversation message")
			}
			ids[m.ID] = true
			for _, a := range m.Attachments {
				if !strings.HasPrefix(a.Data, "sync-attachment:") || !ValidAttachmentID(strings.TrimPrefix(a.Data, "sync-attachment:")) {
					return errors.New("attachments must be transferred separately")
				}
			}
		}
	default:
		return errors.New("invalid sync document kind")
	}
	return nil
}
func NormalizeConversation(c *Conversation) {
	if c.Messages == nil {
		c.Messages = []aichatui.MessageView{}
	}
	if c.Tasks == nil {
		c.Tasks = []aichatui.TaskView{}
	}
	c.Parents = map[string]string{}
	parent := ""
	for i := range c.Messages {
		m := &c.Messages[i]
		c.Parents[m.ID] = parent
		parent = m.ID
		// Provider request/response IDs cannot continue a request with another API key.
		m.ProviderMetadata = nil
	}
	for i := range c.Tasks {
		t := &c.Tasks[i]
		t.RequiresConfirmation = false
		if t.Status != aichatui.TaskStatusSucceeded && t.Status != aichatui.TaskStatusFailed && t.Status != aichatui.TaskStatusCancelled {
			t.Status = aichatui.TaskStatusCancelled
			t.Error = "Execution remained on the originating device"
		}
	}
}

// Attachment IDs are content-addressed; payload versions use random IDs so a
// reference never exposes a hash of a low-entropy password or API key.
func ExtractAttachments(c *Conversation) map[string]string {
	result := map[string]string{}
	for i := range c.Messages {
		for j := range c.Messages[i].Attachments {
			a := &c.Messages[i].Attachments[j]
			if strings.HasPrefix(a.Data, "sync-attachment:") {
				continue
			}
			sum := sha256.Sum256([]byte(a.Data))
			id := hex.EncodeToString(sum[:])
			result[id] = a.Data
			a.Data = "sync-attachment:" + id
		}
	}
	return result
}
func HydrateAttachments(c *Conversation, get func(string) (string, error)) error {
	total := 0
	for i := range c.Messages {
		for j := range c.Messages[i].Attachments {
			a := &c.Messages[i].Attachments[j]
			id := strings.TrimPrefix(a.Data, "sync-attachment:")
			if !ValidAttachmentID(id) {
				return errors.New("invalid attachment reference")
			}
			data, err := get(id)
			if err != nil {
				return err
			}
			if len(data) > 12<<20 {
				return errors.New("attachment too large")
			}
			sum := sha256.Sum256([]byte(data))
			if hex.EncodeToString(sum[:]) != id {
				return errors.New("attachment checksum mismatch")
			}
			decoded, err := base64.StdEncoding.DecodeString(data)
			if err != nil || len(decoded) > 8<<20 {
				return errors.New("invalid attachment")
			}
			total += len(decoded)
			if total > 32<<20 {
				return errors.New("conversation attachments exceed 32 MiB")
			}
			a.Data = data
			a.Size = int64(len(decoded))
		}
	}
	return nil
}
func DecodeVault(value, kind string) (VaultPayload, error) {
	var p VaultPayload
	err := json.Unmarshal([]byte(value), &p)
	if err == nil {
		err = p.Validate(kind)
	}
	return p, err
}

func ValidAttachmentID(id string) bool {
	if len(id) != 64 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil && strings.ToLower(id) == id
}

// Summaries deliberately exclude passwords, private material, API keys and message bodies.
type VaultSummary struct {
	Source        string     `json:"source,omitempty"`
	UpdatedAt     *time.Time `json:"updated_at,omitempty"`
	Deleted       bool       `json:"deleted,omitempty"`
	Title         string     `json:"title,omitempty"`
	Messages      int        `json:"messages,omitempty"`
	LastMessageAt *time.Time `json:"last_message_at,omitempty"`
	HasPassword   bool       `json:"has_password,omitempty"`
	Fingerprint   string     `json:"fingerprint,omitempty"`
	Provider      string     `json:"provider,omitempty"`
	HasAPIKey     bool       `json:"has_api_key,omitempty"`
}
type VaultConflict struct {
	Key      string                  `json:"key"`
	Field    string                  `json:"field"`
	Values   []string                `json:"values"`
	Previews map[string]VaultSummary `json:"previews"`
}

func Summarize(p VaultPayload) VaultSummary {
	result := VaultSummary{Deleted: p.Deleted, Source: p.Source}
	if !p.UpdatedAt.IsZero() {
		result.UpdatedAt = &p.UpdatedAt
	}
	if c := p.Credential; c != nil {
		result.HasPassword = c.Password != ""
		if c.Key != nil {
			result.Fingerprint = c.Key.Fingerprint
		}
	}
	if c := p.AIConfig; c != nil {
		result.Provider = c.Provider
		result.HasAPIKey = c.APIKey != ""
	}
	if c := p.Conversation; c != nil {
		result.Title = c.Title
		result.Messages = len(c.Messages)
		if len(c.Messages) > 0 {
			t := c.Messages[len(c.Messages)-1].CreatedAt
			result.LastMessageAt = &t
		}
	}
	return result
}

// Provenance describes a version; metadata-only timestamps must not create a
// new secret version (e.g. a server's last-connected timestamp changing).
func SameVaultValue(a, b string) bool {
	if a == b {
		return true
	}
	var left, right VaultPayload
	if json.Unmarshal([]byte(a), &left) != nil || json.Unmarshal([]byte(b), &right) != nil {
		return false
	}
	left.Source = ""
	right.Source = ""
	left.UpdatedAt = time.Time{}
	right.UpdatedAt = time.Time{}
	return JSON(left) == JSON(right)
}
