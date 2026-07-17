package backupcrypto

import (
	"testing"

	"filippo.io/age"
)

func TestValidateX25519Inputs(t *testing.T) {
	identity, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatalf("generate identity: %v", err)
	}
	if err := ValidateX25519Recipients([]string{identity.Recipient().String()}); err != nil {
		t.Fatalf("validate recipient: %v", err)
	}
	if err := ValidateX25519Identities([]string{identity.String()}); err != nil {
		t.Fatalf("validate identity: %v", err)
	}
	if err := ValidateX25519Recipients([]string{"not-an-age-recipient"}); err == nil {
		t.Fatal("expected invalid recipient to be rejected")
	}
	if err := ValidateX25519Identities([]string{"not-an-age-identity"}); err == nil {
		t.Fatal("expected invalid identity to be rejected")
	}
}
