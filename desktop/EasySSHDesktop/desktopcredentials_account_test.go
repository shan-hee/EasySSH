package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopCredentialAccountPreservesLegacyAndSelectsRestoredCopy(t *testing.T) {
	legacy, restored := t.TempDir(), t.TempDir()
	account, err := desktopCredentialAccount(legacy)
	if err != nil || account != "credential-encryption-v1" {
		t.Fatalf("legacy account: %q, %v", account, err)
	}
	selected := "credential-encryption-v1/" + strings.Repeat("ab", 32)
	path := filepath.Join(restored, ".easyssh-key-account")
	if err := os.WriteFile(path, []byte(selected), 0600); err != nil {
		t.Fatal(err)
	}
	account, err = desktopCredentialAccount(restored)
	if err != nil || account != selected {
		t.Fatalf("restored account: %q, %v", account, err)
	}
	account, err = desktopCredentialAccount(legacy)
	if err != nil || account != "credential-encryption-v1" {
		t.Fatal("restored copy changed legacy selection")
	}
	if err := os.WriteFile(path, []byte("unrelated-vault-entry"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := desktopCredentialAccount(restored); err == nil {
		t.Fatal("accepted invalid account marker")
	}
}
