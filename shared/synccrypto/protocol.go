// Package synccrypto defines the client-owned encrypted synchronization protocol.
// Server callers may validate signatures, but never receive any private material.
package synccrypto

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"filippo.io/age"
)

const Version = 5
const MaxObjectBytes = 8 << 20
const MaxDevices = 32

type Scope string

const (
	Config      Scope = "config"
	Credentials Scope = "credentials"
	AIConfig    Scope = "ai_config"
	Sessions    Scope = "sessions"
)

var Scopes = []Scope{Config, Credentials, AIConfig, Sessions}

type PublicDevice struct {
	ID         string `json:"id"`
	SigningKey string `json:"signing_key"`
	Recipient  string `json:"recipient"`
	Name       string `json:"name"`
}

type Grant struct {
	Device   PublicDevice `json:"device"`
	Scopes   []Scope      `json:"scopes"`
	Admin    bool         `json:"admin"`
	Envelope string       `json:"envelope"`
}

type ManifestBody struct {
	Version           int              `json:"version"`
	Space             string           `json:"space"`
	GenesisRoot       string           `json:"genesis_root"`
	Root              string           `json:"root"`
	Revision          uint32           `json:"revision"`
	Previous          string           `json:"previous"`
	Epochs            map[Scope]uint32 `json:"epochs"`
	Devices           []Grant          `json:"devices"`
	RecoveryRecipient string           `json:"recovery_recipient"`
	Recovery          string           `json:"recovery"`
}

type Manifest struct {
	ManifestBody
	Signature         string `json:"signature"`
	PreviousSignature string `json:"previous_signature"`
}

type ObjectHeader struct {
	Version  int      `json:"version"`
	Space    string   `json:"space"`
	Manifest string   `json:"manifest"`
	Scope    Scope    `json:"scope"`
	Epoch    uint32   `json:"epoch"`
	Document string   `json:"document"`
	ID       string   `json:"id"`
	Parents  []string `json:"parents"`
	Author   string   `json:"author"`
}

type Object struct {
	ObjectHeader
	Ciphertext string `json:"ciphertext"`
	Signature  string `json:"signature"`
}

var ErrInvalid = errors.New("invalid encrypted sync envelope")
var ErrLocked = errors.New("encrypted workspace is locked")
var ErrUnauthorized = errors.New("device is not authorized for this scope")
var ErrStale = errors.New("encrypted workspace version changed; refresh before retrying")

func digest(b []byte) string          { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }
func encode(b []byte) string          { return base64.StdEncoding.EncodeToString(b) }
func decode(s string) ([]byte, error) { return base64.StdEncoding.Strict().DecodeString(s) }
func validID(s string) bool {
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == 32 && s == strings.ToLower(s)
}
func NewID() string               { b := make([]byte, 32); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func ValidScope(scope Scope) bool { return slices.Contains(Scopes, scope) }

// Encoding is UTF-8 Go JSON of these fixed structs, prefixed by the operation's
// domain. Both browser WASM and desktop use this package, never a JS serializer.
func manifestBytes(body ManifestBody) []byte {
	b, _ := json.Marshal(body)
	return append([]byte("easyssh/manifest/v5\x00"), b...)
}
func (m Manifest) Hash() string {
	return digest(append(append(manifestBytes(m.ManifestBody), []byte(m.Signature)...), []byte(m.PreviousSignature)...))
}
func (m Manifest) Grant(id string) (Grant, bool) {
	for _, grant := range m.Devices {
		if grant.Device.ID == id {
			return grant, true
		}
	}
	return Grant{}, false
}

func (d PublicDevice) Validate() error {
	key, err := decode(d.SigningKey)
	if err != nil || len(key) != ed25519.PublicKeySize || len(d.Name) > 200 {
		return ErrInvalid
	}
	if _, err := age.ParseX25519Recipient(d.Recipient); err != nil {
		return ErrInvalid
	}
	if d.ID != digest(append(append([]byte("easyssh/device/v5\x00"), key...), []byte(d.Recipient)...)) {
		return ErrInvalid
	}
	return nil
}

func (m Manifest) Verify() error {
	encoded, err := json.Marshal(m)
	if err != nil || len(encoded) > 512<<10 {
		return ErrInvalid
	}
	root, err := decode(m.Root)
	if err != nil || len(root) != ed25519.PublicKeySize || m.Version != Version || m.Revision == 0 {
		return ErrInvalid
	}
	genesis, err := decode(m.GenesisRoot)
	if err != nil || len(genesis) != ed25519.PublicKeySize || m.Space != digest(genesis) {
		return ErrInvalid
	}
	if m.Revision == 1 && (m.Root != m.GenesisRoot || m.PreviousSignature != "") {
		return ErrInvalid
	}
	if (m.Revision == 1 && m.Previous != "") || (m.Revision > 1 && !validID(m.Previous)) {
		return ErrInvalid
	}
	if len(m.Epochs) != len(Scopes) || len(m.Devices) == 0 || len(m.Devices) > MaxDevices {
		return ErrInvalid
	}
	for _, scope := range Scopes {
		if m.Epochs[scope] == 0 {
			return ErrInvalid
		}
	}
	if len(m.Recovery) > 1<<20 {
		return ErrInvalid
	}
	if _, err := age.ParseX25519Recipient(m.RecoveryRecipient); err != nil {
		return ErrInvalid
	}
	seen := map[string]bool{}
	admins := 0
	for _, grant := range m.Devices {
		if grant.Device.Validate() != nil || seen[grant.Device.ID] || len(grant.Envelope) == 0 || len(grant.Envelope) > 1<<20 {
			return ErrInvalid
		}
		seen[grant.Device.ID] = true
		if !slices.Contains(grant.Scopes, Config) || len(grant.Scopes) > len(Scopes) {
			return ErrInvalid
		}
		scopes := map[Scope]bool{}
		for _, scope := range grant.Scopes {
			if !ValidScope(scope) || scopes[scope] {
				return ErrInvalid
			}
			scopes[scope] = true
		}
		if grant.Admin {
			if len(scopes) != len(Scopes) {
				return ErrInvalid
			}
			admins++
		}
	}
	if admins == 0 {
		return ErrInvalid
	}
	signature, err := decode(m.Signature)
	if err != nil || !ed25519.Verify(root, manifestBytes(m.ManifestBody), signature) {
		return ErrInvalid
	}
	return nil
}

func (m Manifest) Follows(previous Manifest) error {
	if err := previous.Verify(); err != nil {
		return err
	}
	if previous.Revision == ^uint32(0) {
		return ErrInvalid
	}
	if err := m.Verify(); err != nil {
		return err
	}
	if m.Space != previous.Space || m.GenesisRoot != previous.GenesisRoot || m.RecoveryRecipient != previous.RecoveryRecipient || m.Revision != previous.Revision+1 || m.Previous != previous.Hash() {
		return ErrStale
	}
	previousRoot, _ := decode(previous.Root)
	previousSignature, err := decode(m.PreviousSignature)
	if err != nil || !ed25519.Verify(previousRoot, manifestBytes(m.ManifestBody), previousSignature) {
		return ErrInvalid
	}
	for _, scope := range Scopes {
		if m.Epochs[scope] < previous.Epochs[scope] || m.Epochs[scope] > previous.Epochs[scope]+1 {
			return ErrInvalid
		}
	}
	// Revoking a holder requires fresh scope keys; changing an envelope alone
	// cannot revoke a key the removed device has already learned.
	for _, old := range previous.Devices {
		current, exists := m.Grant(old.Device.ID)
		if old.Admin && (!exists || !current.Admin) && m.Root == previous.Root {
			return errors.New("revoking an administrator requires root rotation")
		}
		for _, scope := range old.Scopes {
			if (!exists || !slices.Contains(current.Scopes, scope)) && m.Epochs[scope] != previous.Epochs[scope]+1 {
				return fmt.Errorf("revocation requires rotating %s", scope)
			}
		}
	}
	return nil
}

// VerifyChain anchors a new device to the fingerprint carried out of band in a
// pairing/recovery code. Established clients instead start at their saved head.
func VerifyChain(space string, chain []Manifest) error {
	if len(chain) == 0 || chain[0].Revision != 1 || chain[0].Space != space {
		return ErrInvalid
	}
	if err := chain[0].Verify(); err != nil {
		return err
	}
	for i := 1; i < len(chain); i++ {
		if err := chain[i].Follows(chain[i-1]); err != nil {
			return err
		}
	}
	return nil
}

func objectAAD(h ObjectHeader) []byte {
	b, _ := json.Marshal(h)
	return append([]byte("easyssh/object/v5\x00"), b...)
}
func objectSignatureInput(o Object) []byte {
	return append(append(objectAAD(o.ObjectHeader), 0), []byte(o.Ciphertext)...)
}

func (o Object) Verify(m Manifest) error {
	if err := m.Verify(); err != nil {
		return err
	}
	if o.Version != Version || o.Space != m.Space || o.Manifest != m.Hash() || !ValidScope(o.Scope) || o.Epoch != m.Epochs[o.Scope] || !validID(o.ID) || !validID(o.Document) || len(o.Parents) > 64 || o.Parents == nil {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for _, id := range o.Parents {
		if !validID(id) || seen[id] || id == o.ID {
			return ErrInvalid
		}
		seen[id] = true
	}
	grant, exists := m.Grant(o.Author)
	if !exists || !slices.Contains(grant.Scopes, o.Scope) {
		return ErrUnauthorized
	}
	if len(o.Ciphertext) > base64.StdEncoding.EncodedLen(MaxObjectBytes+28) {
		return ErrInvalid
	}
	data, err := decode(o.Ciphertext)
	if err != nil || len(data) < 28 {
		return ErrInvalid
	}
	key, _ := decode(grant.Device.SigningKey)
	signature, err := decode(o.Signature)
	if err != nil || !ed25519.Verify(key, objectSignatureInput(o), signature) {
		return ErrInvalid
	}
	return nil
}
