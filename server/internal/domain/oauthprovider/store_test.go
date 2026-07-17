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
