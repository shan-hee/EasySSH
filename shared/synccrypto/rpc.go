package synccrypto

import (
	"encoding/json"
	"errors"
)

// Dispatch is shared by the browser Worker and Wails. It intentionally exposes
// no API for exporting plaintext private keys or scope keys.
func (v *Vault) Dispatch(input string) (string, error) {
	if len(input) > 24<<20 {
		return "", ErrInvalid
	}
	var request struct {
		Algorithm  string        `json:"algorithm"`
		KeySize    int           `json:"key_size"`
		PrivateKey string        `json:"private_key"`
		Passphrase string        `json:"passphrase"`
		Operation  string        `json:"operation"`
		Name       string        `json:"name"`
		Password   string        `json:"password"`
		Owner      string        `json:"owner"`
		Space      string        `json:"space"`
		Code       string        `json:"code"`
		Device     PublicDevice  `json:"device"`
		DeviceID   string        `json:"device_id"`
		Scopes     []Scope       `json:"scopes"`
		Admin      bool          `json:"admin"`
		Chain      []Manifest    `json:"chain"`
		Manifest   Manifest      `json:"manifest"`
		Local      LocalEnvelope `json:"local"`
		Object     Object        `json:"object"`
		Scope      Scope         `json:"scope"`
		Resource   string        `json:"resource"`
		Document   string        `json:"document"`
		Parents    []string      `json:"parents"`
		Data       string        `json:"data"`
	}
	if json.Unmarshal([]byte(input), &request) != nil {
		return "", ErrInvalid
	}
	var result any
	var err error
	switch request.Operation {
	case "inspect_ssh_key":
		result, err = inspectSSHKey(request.PrivateKey, request.Passphrase)
	case "generate_ssh_key":
		result, err = generateSSHKey(request.Algorithm, request.KeySize)
	case "pending_recovery":
		if v.data == nil {
			return "", ErrLocked
		}
		result = v.data.PendingRecovery
	case "confirm_recovery":
		if v.data == nil {
			return "", ErrLocked
		}
		v.data.PendingRecovery = ""
	case "initialize":
		var recovery string
		recovery, err = v.Initialize(request.Name)
		if err == nil {
			view, _ := v.View()
			result = map[string]any{"recovery": recovery, "view": view}
		}
	case "new_device":
		result, err = v.NewDevice(request.Name)
	case "view":
		result, err = v.View()
	case "save":
		result, err = v.Save(request.Password, request.Owner)
	case "persist":
		result, err = v.Persist(request.Owner)
	case "unlock":
		err = v.Load(request.Password, request.Owner, request.Local)
		if err == nil {
			result, err = v.View()
		}
	case "lock":
		v.Lock()
	case "accept":
		err = v.Accept(request.Space, request.Chain)
		if err == nil {
			result, err = v.View()
		}
	case "authorize":
		result, err = v.Authorize(request.Device, request.Scopes, request.Admin)
	case "revoke":
		result, err = v.Revoke(request.DeviceID)
	case "recover":
		result, err = v.Recover(request.Code, request.Name, request.Chain)
	case "seal":
		var plaintext []byte
		plaintext, err = decode(request.Data)
		if err == nil {
			result, err = v.Seal(request.Scope, request.Document, request.Parents, plaintext)
			clear(plaintext)
		}
	case "open":
		var plaintext []byte
		plaintext, err = v.Open(request.Object, request.Manifest)
		if err == nil {
			result = encode(plaintext)
			clear(plaintext)
		}
	case "verify_object":
		err = v.VerifyObject(request.Object, request.Manifest)
	case "manifest_index":
		index := map[string]Manifest{}
		for _, manifest := range request.Chain {
			index[manifest.Hash()] = manifest
		}
		result = index
	case "document_id":
		result = DocumentID(request.Scope, request.Resource)
	default:
		err = errors.New("unknown encrypted workspace operation")
	}
	if err != nil {
		return "", err
	}
	output, err := json.Marshal(result)
	return string(output), err
}
