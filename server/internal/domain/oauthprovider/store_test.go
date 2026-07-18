package oauthprovider

import (
	"bytes"
	"context"
	"encoding/base64"
	"testing"
	"time"

	servercrypto "github.com/easyssh/server/internal/pkg/crypto"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/ory/fosite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestStoreClientAssertionReplayProtection(t *testing.T) {
	database := newOAuthProviderTestDatabase(t)
	store := NewStore(database)
	ctx := context.Background()

	require.NoError(t, store.ClientAssertionJWTValid(ctx, "assertion-1"))
	require.NoError(t, store.SetClientAssertionJWT(ctx, "assertion-1", time.Now().Add(time.Minute)))
	require.ErrorIs(t, store.ClientAssertionJWTValid(ctx, "assertion-1"), fosite.ErrJTIKnown)
	require.ErrorIs(t, store.SetClientAssertionJWT(ctx, "assertion-1", time.Now().Add(time.Minute)), fosite.ErrJTIKnown)

	require.NoError(t, database.Create(&ClientAssertion{
		JTIHash:   clientAssertionJTIHash("expired-assertion"),
		ExpiresAt: time.Now().Add(-time.Minute),
	}).Error)
	require.NoError(t, store.ClientAssertionJWTValid(ctx, "expired-assertion"))
	require.NoError(t, store.SetClientAssertionJWT(ctx, "expired-assertion", time.Now().Add(time.Minute)))
	require.ErrorIs(t, store.ClientAssertionJWTValid(ctx, "expired-assertion"), fosite.ErrJTIKnown)
}

func TestNewComposesFositeProviderWithStore(t *testing.T) {
	database := newOAuthProviderTestDatabase(t)
	encryptionKey := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x42}, 32))
	encryptor, err := servercrypto.NewEncryptor(encryptionKey)
	require.NoError(t, err)

	var service *Service
	require.NotPanics(t, func() {
		service, err = New(database, encryptor, Config{
			Issuer:          "http://localhost:8520/api/v1",
			GlobalSecret:    bytes.Repeat([]byte{0x24}, 32),
			WebRedirectURIs: []string{"http://localhost:3000/auth/callback"},
		})
	})
	require.NoError(t, err)
	require.NotNil(t, service)
	require.NotNil(t, service.provider)
	client, err := service.store.GetClient(context.Background(), BuiltInWebClientID)
	require.NoError(t, err)
	require.Equal(t, []string{InternalWebRedirectURI}, client.GetRedirectURIs())
}

func TestExternalProviderGateRequiresDeploymentConfiguration(t *testing.T) {
	gate, err := NewExternalProviderGate(false, false)
	require.NoError(t, err)
	require.False(t, gate.Configured())
	require.False(t, gate.Enabled())
	require.Error(t, gate.SetEnabled(true))

	gate, err = NewExternalProviderGate(true, false)
	require.NoError(t, err)
	require.True(t, gate.Configured())
	require.NoError(t, gate.SetEnabled(true))
	require.True(t, gate.Enabled())
	require.NoError(t, gate.SetEnabled(false))
	require.False(t, gate.Enabled())
}

func newOAuthProviderTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(
		&Client{},
		&ClientAssertion{},
		&Grant{},
		&SigningKey{},
		&LoginChallenge{},
	))
	return database
}
