package app

import "testing"

func TestDesktopTemporaryCredentialsBindToConnectionRevision(t *testing.T) {
	service := &DesktopServerService{}
	old := DesktopSSHCredential{AuthMethod: DesktopServerAuthPassword, Password: "old-secret"}
	current := DesktopSSHCredential{AuthMethod: DesktopServerAuthPassword, Password: "current-secret"}
	service.setTemporaryCredential("server", 1, [32]byte{}, old)
	if got, ok := service.getTemporaryCredential("server", 1, [32]byte{}); !ok || got.Password != old.Password {
		t.Fatal("same revision lost credential")
	}
	if _, ok := service.getTemporaryCredential("server", 2, [32]byte{}); ok {
		t.Fatal("changed endpoint inherited old credential")
	}
	service.clearTemporaryCredential("server")
	// Completion of authentication that started before the configuration edit.
	service.setTemporaryCredential("server", 1, [32]byte{}, old)
	if _, ok := service.getTemporaryCredential("server", 2, [32]byte{}); ok {
		t.Fatal("late authentication rebound credential")
	}
	service.setTemporaryCredential("server", 2, [32]byte{}, current)
	service.setTemporaryCredential("server", 1, [32]byte{}, old)
	if _, ok := service.getTemporaryCredential("server", 1, [32]byte{}); ok {
		t.Fatal("old request obtained new credential")
	}
	if got, ok := service.getTemporaryCredential("server", 2, [32]byte{}); !ok || got.Password != current.Password {
		t.Fatal("old authentication/read destroyed current credential")
	}
	if _, ok := service.getTemporaryCredential("other", 2, [32]byte{}); ok {
		t.Fatal("credential crossed server identity")
	}
	service.setTemporaryCredential("unversioned", 0, [32]byte{}, old)
	if _, ok := service.getTemporaryCredential("unversioned", 0, [32]byte{}); ok {
		t.Fatal("unversioned credential accepted")
	}
	service.clearTemporaryCredentials()
	if _, ok := service.getTemporaryCredential("server", 2, [32]byte{}); ok {
		t.Fatal("shutdown retained credential")
	}
}

func TestDesktopTemporaryCredentialsBindToSavedSecrets(t *testing.T) {
	service := &DesktopServerService{}
	before := DesktopServer{Password: "saved-before", PrivateKey: "key", SavedPrivateKeyPassphrase: "phrase"}
	secret := DesktopSSHCredential{Password: "temporary-before"}
	for _, change := range []func(*DesktopServer){
		func(s *DesktopServer) { s.Password = "saved-after" },
		func(s *DesktopServer) { s.SavedPrivateKeyPassphrase = "new-phrase" },
	} {
		after := before
		change(&after)
		service.setTemporaryCredential("server", 1, before.credentialDigest(), secret)
		if _, ok := service.getTemporaryCredential("server", 1, after.credentialDigest()); ok {
			t.Fatal("rotated secret inherited cached credentials")
		}
		service.clearTemporaryCredential("server")
		service.setTemporaryCredential("server", 1, before.credentialDigest(), secret)
		if _, ok := service.getTemporaryCredential("server", 1, after.credentialDigest()); ok {
			t.Fatal("late authentication restored old secret")
		}
		service.setTemporaryCredential("server", 1, after.credentialDigest(), secret)
		if _, ok := service.getTemporaryCredential("server", 1, after.credentialDigest()); !ok {
			t.Fatal("current authentication snapshot rejected")
		}
	}
}
