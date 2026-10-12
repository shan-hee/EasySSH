package synccrypto

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"

	"filippo.io/age"
	"golang.org/x/crypto/argon2"
)

type keyring map[Scope]map[uint32]string
type distribution struct {
	Space       string  `json:"space"`
	RootPrivate string  `json:"root_private,omitempty"`
	Keys        keyring `json:"keys"`
}
type material struct {
	PendingRecovery   string          `json:"pending_recovery,omitempty"`
	Version           int             `json:"version"`
	Device            PublicDevice    `json:"device"`
	SigningPrivate    string          `json:"signing_private"`
	EncryptionPrivate string          `json:"encryption_private"`
	Distribution      distribution    `json:"distribution"`
	Manifest          Manifest        `json:"manifest"`
	Trusted           map[string]bool `json:"trusted"`
}

// Vault stays in the native process or a dedicated browser Worker. Private
// fields are never returned through its RPC; Save returns a locally wrapped blob.
type Vault struct {
	data       *material
	localKey   []byte
	localSalt  string
	localOwner string
}
type LocalEnvelope struct {
	Version    int    `json:"version"`
	Salt       string `json:"salt"`
	Ciphertext string `json:"ciphertext"`
}
type View struct {
	Device       PublicDevice `json:"device"`
	Manifest     Manifest     `json:"manifest"`
	Scopes       []Scope      `json:"scopes"`
	Admin        bool         `json:"admin"`
	ManifestHash string       `json:"manifest_hash"`
}

func privateKey(value string) (ed25519.PrivateKey, error) {
	key, err := decode(value)
	if err != nil || len(key) != ed25519.PrivateKeySize || !bytes.Equal(ed25519.NewKeyFromSeed(key[:32]), key) {
		return nil, ErrInvalid
	}
	return ed25519.PrivateKey(key), nil
}
func newMaterial(name string) (*material, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	identity, err := age.GenerateX25519Identity()
	if err != nil {
		return nil, err
	}
	device := PublicDevice{SigningKey: encode(pub), Recipient: identity.Recipient().String(), Name: name}
	device.ID = digest(append(append([]byte("easyssh/device/v5\x00"), pub...), []byte(device.Recipient)...))
	if err := device.Validate(); err != nil {
		return nil, err
	}
	return &material{Version: Version, Device: device, SigningPrivate: encode(priv), EncryptionPrivate: identity.String(), Distribution: distribution{Keys: keyring{}}, Trusted: map[string]bool{}}, nil
}
func randomKey() string { key := make([]byte, 32); _, _ = rand.Read(key); return encode(key) }
func cloneJSON[T any](value T) T {
	data, _ := json.Marshal(value)
	var result T
	_ = json.Unmarshal(data, &result)
	return result
}

func encrypt(key, plaintext, aad []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, ErrInvalid
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return aead.Seal(nonce, nonce, plaintext, aad), nil
}
func decrypt(key, ciphertext, aad []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, ErrInvalid
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil || len(ciphertext) < aead.NonceSize()+aead.Overhead() {
		return nil, ErrInvalid
	}
	return aead.Open(nil, ciphertext[:aead.NonceSize()], ciphertext[aead.NonceSize():], aad)
}
func wrap(recipient string, payload distribution) (string, error) {
	r, err := age.ParseX25519Recipient(recipient)
	if err != nil {
		return "", err
	}
	var buffer bytes.Buffer
	w, err := age.Encrypt(&buffer, r)
	if err != nil {
		return "", err
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	if buffer.Len() > 768<<10 {
		return "", errors.New("key history exceeds the supported size")
	}
	return encode(buffer.Bytes()), nil
}
func unwrap(identity *age.X25519Identity, envelope string) (distribution, error) {
	var result distribution
	if len(envelope) > 1<<20 {
		return result, ErrInvalid
	}
	data, err := decode(envelope)
	if err != nil {
		return result, ErrInvalid
	}
	r, err := age.Decrypt(bytes.NewReader(data), identity)
	if err != nil {
		return result, ErrInvalid
	}
	// Read through EOF to authenticate the final age chunk before using plaintext.
	plaintext, err := io.ReadAll(io.LimitReader(r, (768<<10)+1))
	if err != nil || len(plaintext) > 768<<10 {
		return result, ErrInvalid
	}
	if err := json.Unmarshal(plaintext, &result); err != nil {
		return result, ErrInvalid
	}
	return result, nil
}

func (v *Vault) Lock() {
	v.data = nil
	clear(v.localKey)
	v.localKey = nil
	v.localSalt = ""
	v.localOwner = ""
}
func (v *Vault) View() (View, error) {
	if v.data == nil {
		return View{}, ErrLocked
	}
	grant, _ := v.data.Manifest.Grant(v.data.Device.ID)
	return View{Device: v.data.Device, Manifest: cloneJSON(v.data.Manifest), Scopes: slices.Clone(grant.Scopes), Admin: grant.Admin, ManifestHash: v.data.Manifest.Hash()}, nil
}
func (v *Vault) NewDevice(name string) (PublicDevice, error) {
	v.Lock()
	data, err := newMaterial(name)
	if err != nil {
		return PublicDevice{}, err
	}
	v.data = data
	return data.Device, nil
}

func (v *Vault) Initialize(name string) (string, error) {
	v.Lock()
	data, err := newMaterial(name)
	if err != nil {
		return "", err
	}
	root, rootPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", err
	}
	recovery, err := age.GenerateX25519Identity()
	if err != nil {
		return "", err
	}
	data.Distribution = distribution{Space: digest(root), RootPrivate: encode(rootPrivate), Keys: keyring{}}
	m := Manifest{ManifestBody: ManifestBody{Version: Version, Space: digest(root), GenesisRoot: encode(root), Root: encode(root), Revision: 1, Epochs: map[Scope]uint32{}, Devices: []Grant{{Device: data.Device, Scopes: slices.Clone(Scopes), Admin: true}}, RecoveryRecipient: recovery.Recipient().String()}}
	for _, scope := range Scopes {
		m.Epochs[scope] = 1
		data.Distribution.Keys[scope] = map[uint32]string{1: randomKey()}
	}
	if err := distribute(&m, data.Distribution, nil); err != nil {
		return "", err
	}
	data.Manifest = m
	data.Trusted[m.Hash()] = true
	v.data = data
	// The space fingerprint prevents a server from substituting another genesis
	// when the only surviving trust anchor is this offline recovery code.
	data.PendingRecovery = "easyssh5:" + m.Space + ":" + recovery.String()
	return data.PendingRecovery, nil
}

func distribute(m *Manifest, secrets distribution, previousRoot ed25519.PrivateKey) error {
	root, err := privateKey(secrets.RootPrivate)
	if err != nil {
		return err
	}
	m.Root = encode(root.Public().(ed25519.PublicKey))
	for i := range m.Devices {
		grant := &m.Devices[i]
		bundle := distribution{Space: m.Space, Keys: keyring{}}
		for _, scope := range grant.Scopes {
			bundle.Keys[scope] = secrets.Keys[scope]
		}
		if grant.Admin {
			bundle.RootPrivate = secrets.RootPrivate
		}
		grant.Envelope, err = wrap(grant.Device.Recipient, bundle)
		if err != nil {
			return err
		}
	}
	m.Recovery, err = wrap(m.RecoveryRecipient, secrets)
	if err != nil {
		return err
	}
	m.Signature = encode(ed25519.Sign(root, manifestBytes(m.ManifestBody)))
	if previousRoot != nil {
		m.PreviousSignature = encode(ed25519.Sign(previousRoot, manifestBytes(m.ManifestBody)))
	}
	return m.Verify()
}

func validateDistribution(bundle distribution, m Manifest, grant Grant) error {
	if bundle.Space != m.Space || len(bundle.Keys) != len(grant.Scopes) {
		return ErrInvalid
	}
	for _, scope := range grant.Scopes {
		keys := bundle.Keys[scope]
		if len(keys) == 0 || len(keys) > 4096 {
			return ErrInvalid
		}
		for epoch, encoded := range keys {
			key, err := decode(encoded)
			if err != nil || len(key) != 32 || epoch == 0 || epoch > m.Epochs[scope] {
				return ErrInvalid
			}
		}
		if keys[m.Epochs[scope]] == "" {
			return ErrInvalid
		}
	}
	if grant.Admin {
		key, err := privateKey(bundle.RootPrivate)
		if err != nil || encode(key.Public().(ed25519.PublicKey)) != m.Root {
			return ErrInvalid
		}
	} else if bundle.RootPrivate != "" {
		return ErrInvalid
	}
	return nil
}

// Accept only advances from a persisted manifest, or a complete chain anchored
// to a fingerprint explicitly supplied during first-device pairing.
func (v *Vault) Accept(space string, chain []Manifest) error {
	if v.data == nil {
		return ErrLocked
	}
	if len(chain) == 0 {
		return ErrInvalid
	}
	previous := v.data.Manifest
	if previous.Revision == 0 {
		if err := VerifyChain(space, chain); err != nil {
			return err
		}
	} else {
		if space != previous.Space {
			return ErrInvalid
		}
		for _, m := range chain {
			if m.Hash() == previous.Hash() {
				continue
			}
			if err := m.Follows(previous); err != nil {
				return err
			}
			previous = m
		}
	}
	m := chain[len(chain)-1]
	grant, exists := m.Grant(v.data.Device.ID)
	if !exists {
		v.Lock()
		return ErrUnauthorized
	}
	identity, err := age.ParseX25519Identity(v.data.EncryptionPrivate)
	if err != nil {
		return err
	}
	bundle, err := unwrap(identity, grant.Envelope)
	if err != nil {
		return err
	}
	if err := validateDistribution(bundle, m, grant); err != nil {
		return err
	}
	v.data.Distribution = bundle
	v.data.Manifest = cloneJSON(m)
	for _, accepted := range chain {
		v.data.Trusted[accepted.Hash()] = true
	}
	return nil
}

func (v *Vault) Authorize(device PublicDevice, scopes []Scope, admin bool) (Manifest, error) {
	if v.data == nil {
		return Manifest{}, ErrLocked
	}
	if err := device.Validate(); err != nil {
		return Manifest{}, err
	}
	previous := v.data.Manifest
	if _, exists := previous.Grant(device.ID); exists {
		return Manifest{}, errors.New("device already authorized")
	}
	root, err := privateKey(v.data.Distribution.RootPrivate)
	if err != nil {
		return Manifest{}, ErrUnauthorized
	}
	m := cloneJSON(previous)
	m.Revision++
	m.Previous = previous.Hash()
	m.Devices = append(m.Devices, Grant{Device: device, Scopes: slices.Clone(scopes), Admin: admin})
	if err := distribute(&m, v.data.Distribution, root); err != nil {
		return Manifest{}, err
	}
	if err := m.Follows(previous); err != nil {
		return Manifest{}, err
	}
	// Publication is a CAS operation. Do not advance local state until Accept
	// acknowledges the exact published manifest, so failed requests are retryable.
	return m, nil
}

func (v *Vault) Revoke(id string) (Manifest, error) {
	if v.data == nil {
		return Manifest{}, ErrLocked
	}
	if id == v.data.Device.ID {
		return Manifest{}, errors.New("use another authorized administrator to revoke this device")
	}
	previous := v.data.Manifest
	grant, exists := previous.Grant(id)
	if !exists {
		return Manifest{}, ErrInvalid
	}
	root, err := privateKey(v.data.Distribution.RootPrivate)
	if err != nil {
		return Manifest{}, ErrUnauthorized
	}
	m := cloneJSON(previous)
	m.Revision++
	m.Previous = previous.Hash()
	m.Devices = slices.DeleteFunc(m.Devices, func(g Grant) bool { return g.Device.ID == id })
	bundle := cloneJSON(v.data.Distribution)
	for _, scope := range grant.Scopes {
		m.Epochs[scope]++
		bundle.Keys[scope][m.Epochs[scope]] = randomKey()
	}
	if grant.Admin {
		_, nextRoot, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return Manifest{}, err
		}
		bundle.RootPrivate = encode(nextRoot)
	}
	if err := distribute(&m, bundle, root); err != nil {
		return Manifest{}, err
	}
	if err := m.Follows(previous); err != nil {
		return Manifest{}, err
	}
	return m, nil
}

func (v *Vault) Recover(code, name string, chain []Manifest) (Manifest, error) {
	parts := strings.Split(code, ":")
	if len(parts) != 3 || parts[0] != "easyssh5" {
		return Manifest{}, ErrInvalid
	}
	if err := VerifyChain(parts[1], chain); err != nil {
		return Manifest{}, err
	}
	m := chain[len(chain)-1]
	identity, err := age.ParseX25519Identity(parts[2])
	if err != nil || identity.Recipient().String() != m.RecoveryRecipient {
		return Manifest{}, ErrInvalid
	}
	bundle, err := unwrap(identity, m.Recovery)
	if err != nil {
		return Manifest{}, err
	}
	if err := validateDistribution(bundle, m, Grant{Scopes: Scopes, Admin: true}); err != nil {
		return Manifest{}, err
	}
	data, err := newMaterial(name)
	if err != nil {
		return Manifest{}, err
	}
	data.Distribution, data.Manifest = bundle, m
	for _, accepted := range chain {
		data.Trusted[accepted.Hash()] = true
	}
	v.Lock()
	v.data = data
	return v.Authorize(data.Device, Scopes, true)
}

func (v *Vault) Seal(scope Scope, document string, parents []string, plaintext []byte) (Object, error) {
	if v.data == nil {
		return Object{}, ErrLocked
	}
	if len(plaintext) > MaxObjectBytes {
		return Object{}, errors.New("encrypted object exceeds 8 MiB")
	}
	m := v.data.Manifest
	grant, exists := m.Grant(v.data.Device.ID)
	if !exists || !slices.Contains(grant.Scopes, scope) {
		return Object{}, ErrUnauthorized
	}
	if parents == nil {
		parents = []string{}
	}
	o := Object{ObjectHeader: ObjectHeader{Version: Version, Space: m.Space, Manifest: m.Hash(), Scope: scope, Epoch: m.Epochs[scope], Document: document, ID: NewID(), Parents: slices.Clone(parents), Author: v.data.Device.ID}}
	key, err := decode(v.data.Distribution.Keys[scope][o.Epoch])
	if err != nil {
		return Object{}, err
	}
	data, err := encrypt(key, plaintext, objectAAD(o.ObjectHeader))
	if err != nil {
		return Object{}, err
	}
	o.Ciphertext = encode(data)
	signer, err := privateKey(v.data.SigningPrivate)
	if err != nil {
		return Object{}, err
	}
	o.Signature = encode(ed25519.Sign(signer, objectSignatureInput(o)))
	if err := o.Verify(m); err != nil {
		return Object{}, err
	}
	return o, nil
}

// Open requires a manifest already validated against the client's chain. A
// current authorized device can read history; revoked authors cannot submit new
// writes, as the storage service only accepts the current manifest and epoch.
func (v *Vault) Open(o Object, trusted Manifest) ([]byte, error) {
	if err := v.VerifyObject(o, trusted); err != nil {
		return nil, err
	}
	key, err := decode(v.data.Distribution.Keys[o.Scope][o.Epoch])
	if err != nil || len(key) != 32 {
		return nil, ErrUnauthorized
	}
	data, err := decode(o.Ciphertext)
	if err != nil {
		return nil, ErrInvalid
	}
	return decrypt(key, data, objectAAD(o.ObjectHeader))
}
func (v *Vault) VerifyObject(o Object, trusted Manifest) error {
	if v.data == nil {
		return ErrLocked
	}
	if trusted.Space != v.data.Manifest.Space || trusted.Revision > v.data.Manifest.Revision || !v.data.Trusted[trusted.Hash()] {
		return ErrInvalid
	}
	return o.Verify(trusted)
}

// Fixed versioned Argon2id parameters cannot be attacker-increased from the
// stored envelope. Passwords are independent of the EasySSH account password.
func (v *Vault) Save(password, owner string) (LocalEnvelope, error) {
	if v.data == nil {
		return LocalEnvelope{}, ErrLocked
	}
	if len(password) < 12 || len(password) > 1024 || owner == "" {
		return LocalEnvelope{}, errors.New("local unlock password must contain 12–1024 bytes")
	}
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	key := argon2.IDKey([]byte(password), salt, 3, 64*1024, 1, 32)
	defer clear(key)
	plaintext, err := json.Marshal(v.data)
	if err != nil {
		return LocalEnvelope{}, err
	}
	defer clear(plaintext)
	data, err := encrypt(key, plaintext, []byte("easyssh/local/v5\x00"+owner))
	if err == nil {
		clear(v.localKey)
		v.localKey = slices.Clone(key)
		v.localSalt = encode(salt)
		v.localOwner = owner
	}
	return LocalEnvelope{Version: Version, Salt: encode(salt), Ciphertext: encode(data)}, err
}

func (v *Vault) Persist(owner string) (LocalEnvelope, error) {
	if v.data == nil || len(v.localKey) != 32 || owner != v.localOwner {
		return LocalEnvelope{}, ErrLocked
	}
	plaintext, err := json.Marshal(v.data)
	if err != nil {
		return LocalEnvelope{}, err
	}
	defer clear(plaintext)
	data, err := encrypt(v.localKey, plaintext, []byte("easyssh/local/v5\x00"+owner))
	return LocalEnvelope{Version: Version, Salt: v.localSalt, Ciphertext: encode(data)}, err
}
func (v *Vault) Load(password, owner string, envelope LocalEnvelope) error {
	v.Lock()
	if envelope.Version != Version || len(envelope.Ciphertext) > 4<<20 || len(password) > 1024 || owner == "" {
		return ErrInvalid
	}
	salt, err := decode(envelope.Salt)
	if err != nil || len(salt) != 16 {
		return ErrInvalid
	}
	data, err := decode(envelope.Ciphertext)
	if err != nil {
		return ErrInvalid
	}
	key := argon2.IDKey([]byte(password), salt, 3, 64*1024, 1, 32)
	defer clear(key)
	plaintext, err := decrypt(key, data, []byte("easyssh/local/v5\x00"+owner))
	if err != nil {
		return errors.New("unlock failed: wrong password or damaged local key package")
	}
	defer clear(plaintext)
	var result material
	if json.Unmarshal(plaintext, &result) != nil || result.Version != Version || result.Device.Validate() != nil {
		return ErrInvalid
	}
	signer, err := privateKey(result.SigningPrivate)
	if err != nil || encode(signer.Public().(ed25519.PublicKey)) != result.Device.SigningKey {
		return ErrInvalid
	}
	identity, err := age.ParseX25519Identity(result.EncryptionPrivate)
	if err != nil || identity.Recipient().String() != result.Device.Recipient {
		return ErrInvalid
	}
	if result.Manifest.Revision != 0 {
		if !result.Trusted[result.Manifest.Hash()] {
			return ErrInvalid
		}
		if err := result.Manifest.Verify(); err != nil {
			return err
		}
		grant, exists := result.Manifest.Grant(result.Device.ID)
		if !exists {
			return ErrUnauthorized
		}
		if err := validateDistribution(result.Distribution, result.Manifest, grant); err != nil {
			return err
		}
	}
	v.data = &result
	v.localKey = slices.Clone(key)
	v.localSalt = envelope.Salt
	v.localOwner = owner
	return nil
}

func DocumentID(scope Scope, resource string) string {
	// Only public routing IDs or fixed names belong here. Never hash a password,
	// filename, message body or another low-entropy secret for an external ID.
	return digest([]byte(fmt.Sprintf("easyssh/document/v5/%s/%s", scope, resource)))
}
