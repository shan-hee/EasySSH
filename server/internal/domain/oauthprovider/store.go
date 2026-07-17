package oauthprovider

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/ory/fosite"
	"github.com/ory/fosite/handler/oauth2"
	"github.com/ory/fosite/handler/openid"
	"github.com/ory/fosite/handler/pkce"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	grantAuthorizeCode = "authorize_code"
	grantAccessToken   = "access_token"
	grantRefreshToken  = "refresh_token"
	grantPKCE          = "pkce"
	grantOpenID        = "openid"
)

type Store struct {
	db *gorm.DB
}

var (
	_ fosite.Storage                     = (*Store)(nil)
	_ oauth2.CoreStorage                 = (*Store)(nil)
	_ oauth2.TokenRevocationStorage      = (*Store)(nil)
	_ openid.OpenIDConnectRequestStorage = (*Store)(nil)
	_ pkce.PKCERequestStorage            = (*Store)(nil)
)

func NewStore(db *gorm.DB) *Store { return &Store{db: db} }

func (s *Store) GetClient(ctx context.Context, id string) (fosite.Client, error) {
	var client Client
	if err := s.db.WithContext(ctx).Where("id = ?", id).First(&client).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fosite.ErrNotFound
		}
		return nil, err
	}
	return &fosite.DefaultOpenIDConnectClient{
		DefaultClient: &fosite.DefaultClient{
			ID:            client.ID,
			Secret:        []byte(client.SecretHash),
			RedirectURIs:  append([]string(nil), client.RedirectURIs...),
			GrantTypes:    append([]string(nil), client.GrantTypes...),
			ResponseTypes: append([]string(nil), client.ResponseTypes...),
			Scopes:        append([]string(nil), client.Scopes...),
			Audience:      append([]string(nil), client.Audience...),
			Public:        client.Public,
		},
		TokenEndpointAuthMethod:           client.TokenEndpointAuthMethod,
		RequestObjectSigningAlgorithm:     client.RequestObjectSigningAlg,
		TokenEndpointAuthSigningAlgorithm: client.TokenEndpointAuthSigningAlg,
	}, nil
}

func (s *Store) ClientAssertionJWTValid(ctx context.Context, jti string) error {
	if strings.TrimSpace(jti) == "" {
		return fosite.ErrInvalidRequest.WithHint("client assertion JTI is required")
	}

	var assertion ClientAssertion
	err := s.db.WithContext(ctx).
		Where("jti_hash = ? AND expires_at > ?", clientAssertionJTIHash(jti), time.Now()).
		First(&assertion).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	return fosite.ErrJTIKnown
}

func (s *Store) SetClientAssertionJWT(ctx context.Context, jti string, expiresAt time.Time) error {
	if strings.TrimSpace(jti) == "" {
		return fosite.ErrInvalidRequest.WithHint("client assertion JTI is required")
	}

	now := time.Now()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("expires_at <= ?", now).Delete(&ClientAssertion{}).Error; err != nil {
			return err
		}

		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ClientAssertion{
			JTIHash:   clientAssertionJTIHash(jti),
			ExpiresAt: expiresAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return fosite.ErrJTIKnown
		}
		return nil
	})
}

func clientAssertionJTIHash(jti string) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(jti)))
}

func (s *Store) CreateAuthorizeCodeSession(ctx context.Context, signature string, request fosite.Requester) error {
	return s.createGrant(ctx, grantAuthorizeCode, signature, "", request)
}

func (s *Store) GetAuthorizeCodeSession(ctx context.Context, signature string, _ fosite.Session) (fosite.Requester, error) {
	request, active, err := s.getGrant(ctx, grantAuthorizeCode, signature)
	if err != nil {
		return nil, err
	}
	if !active {
		return request, fosite.ErrInvalidatedAuthorizeCode
	}
	return request, nil
}

func (s *Store) InvalidateAuthorizeCodeSession(ctx context.Context, signature string) error {
	return s.setGrantActive(ctx, grantAuthorizeCode, signature, false)
}

func (s *Store) CreateAccessTokenSession(ctx context.Context, signature string, request fosite.Requester) error {
	return s.createGrant(ctx, grantAccessToken, signature, "", request)
}

func (s *Store) GetAccessTokenSession(ctx context.Context, signature string, _ fosite.Session) (fosite.Requester, error) {
	request, _, err := s.getGrant(ctx, grantAccessToken, signature)
	return request, err
}

func (s *Store) DeleteAccessTokenSession(ctx context.Context, signature string) error {
	return s.deleteGrant(ctx, grantAccessToken, signature)
}

func (s *Store) CreateRefreshTokenSession(ctx context.Context, signature, accessSignature string, request fosite.Requester) error {
	return s.createGrant(ctx, grantRefreshToken, signature, accessSignature, request)
}

func (s *Store) GetRefreshTokenSession(ctx context.Context, signature string, _ fosite.Session) (fosite.Requester, error) {
	request, active, err := s.getGrant(ctx, grantRefreshToken, signature)
	if err != nil {
		return nil, err
	}
	if !active {
		return request, fosite.ErrInactiveToken
	}
	return request, nil
}

func (s *Store) DeleteRefreshTokenSession(ctx context.Context, signature string) error {
	return s.deleteGrant(ctx, grantRefreshToken, signature)
}

func (s *Store) RotateRefreshToken(ctx context.Context, requestID, _ string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Grant{}).Where("kind = ? AND request_id = ?", grantRefreshToken, requestID).Update("active", false).Error; err != nil {
			return err
		}
		return tx.Where("kind = ? AND request_id = ?", grantAccessToken, requestID).Delete(&Grant{}).Error
	})
}

func (s *Store) RevokeRefreshToken(ctx context.Context, requestID string) error {
	return s.db.WithContext(ctx).Model(&Grant{}).
		Where("kind = ? AND request_id = ?", grantRefreshToken, requestID).
		Update("active", false).Error
}

func (s *Store) RevokeAccessToken(ctx context.Context, requestID string) error {
	return s.db.WithContext(ctx).Where("kind = ? AND request_id = ?", grantAccessToken, requestID).Delete(&Grant{}).Error
}

func (s *Store) CreatePKCERequestSession(ctx context.Context, signature string, request fosite.Requester) error {
	return s.createGrant(ctx, grantPKCE, signature, "", request)
}

func (s *Store) GetPKCERequestSession(ctx context.Context, signature string, _ fosite.Session) (fosite.Requester, error) {
	request, _, err := s.getGrant(ctx, grantPKCE, signature)
	return request, err
}

func (s *Store) DeletePKCERequestSession(ctx context.Context, signature string) error {
	return s.deleteGrant(ctx, grantPKCE, signature)
}

func (s *Store) CreateOpenIDConnectSession(ctx context.Context, signature string, request fosite.Requester) error {
	return s.createGrant(ctx, grantOpenID, signature, "", request)
}

func (s *Store) GetOpenIDConnectSession(ctx context.Context, signature string, _ fosite.Requester) (fosite.Requester, error) {
	request, _, err := s.getGrant(ctx, grantOpenID, signature)
	return request, err
}

func (s *Store) DeleteOpenIDConnectSession(ctx context.Context, signature string) error {
	return s.deleteGrant(ctx, grantOpenID, signature)
}

func (s *Store) createGrant(ctx context.Context, kind, signature, accessSignature string, request fosite.Requester) error {
	raw, expiresAt, err := s.marshalRequest(kind, request)
	if err != nil {
		return err
	}
	grant := &Grant{
		Kind:            kind,
		Signature:       signature,
		RequestID:       request.GetID(),
		AccessSignature: accessSignature,
		RequestData:     raw,
		Active:          true,
		ExpiresAt:       expiresAt,
	}
	return s.db.WithContext(ctx).Create(grant).Error
}

func (s *Store) getGrant(ctx context.Context, kind, signature string) (fosite.Requester, bool, error) {
	var grant Grant
	if err := s.db.WithContext(ctx).Where("kind = ? AND signature = ?", kind, signature).First(&grant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, fosite.ErrNotFound
		}
		return nil, false, err
	}
	if time.Now().After(grant.ExpiresAt) {
		return nil, false, fosite.ErrNotFound
	}
	request, err := s.unmarshalRequest(ctx, grant.RequestData)
	return request, grant.Active, err
}

func (s *Store) setGrantActive(ctx context.Context, kind, signature string, active bool) error {
	result := s.db.WithContext(ctx).Model(&Grant{}).
		Where("kind = ? AND signature = ?", kind, signature).
		Update("active", active)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fosite.ErrNotFound
	}
	return nil
}

func (s *Store) deleteGrant(ctx context.Context, kind, signature string) error {
	return s.db.WithContext(ctx).Where("kind = ? AND signature = ?", kind, signature).Delete(&Grant{}).Error
}

type requestSnapshot struct {
	ID                string     `json:"id"`
	RequestedAt       time.Time  `json:"requested_at"`
	ClientID          string     `json:"client_id"`
	RequestedScope    []string   `json:"requested_scope"`
	GrantedScope      []string   `json:"granted_scope"`
	Form              url.Values `json:"form"`
	Session           *Session   `json:"session"`
	RequestedAudience []string   `json:"requested_audience"`
	GrantedAudience   []string   `json:"granted_audience"`
}

func (s *Store) marshalRequest(kind string, request fosite.Requester) (string, time.Time, error) {
	session, ok := request.GetSession().(*Session)
	if !ok {
		return "", time.Time{}, fosite.ErrServerError.WithDebug("oauth session has unexpected type")
	}
	var tokenType fosite.TokenType
	switch kind {
	case grantAuthorizeCode, grantPKCE, grantOpenID:
		tokenType = fosite.AuthorizeCode
	case grantAccessToken:
		tokenType = fosite.AccessToken
	case grantRefreshToken:
		tokenType = fosite.RefreshToken
	}
	expiresAt := session.GetExpiresAt(tokenType)
	if expiresAt.IsZero() {
		expiresAt = time.Now().Add(24 * time.Hour)
	}
	snapshot := requestSnapshot{
		ID:                request.GetID(),
		RequestedAt:       request.GetRequestedAt(),
		ClientID:          request.GetClient().GetID(),
		RequestedScope:    append([]string(nil), request.GetRequestedScopes()...),
		GrantedScope:      append([]string(nil), request.GetGrantedScopes()...),
		Form:              request.GetRequestForm(),
		Session:           session,
		RequestedAudience: append([]string(nil), request.GetRequestedAudience()...),
		GrantedAudience:   append([]string(nil), request.GetGrantedAudience()...),
	}
	raw, err := json.Marshal(snapshot)
	return string(raw), expiresAt, err
}

func (s *Store) unmarshalRequest(ctx context.Context, raw string) (fosite.Requester, error) {
	var snapshot requestSnapshot
	if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
		return nil, err
	}
	client, err := s.GetClient(ctx, snapshot.ClientID)
	if err != nil {
		return nil, err
	}
	return &fosite.Request{
		ID:                snapshot.ID,
		RequestedAt:       snapshot.RequestedAt,
		Client:            client,
		RequestedScope:    fosite.Arguments(snapshot.RequestedScope),
		GrantedScope:      fosite.Arguments(snapshot.GrantedScope),
		Form:              snapshot.Form,
		Session:           snapshot.Session,
		RequestedAudience: fosite.Arguments(snapshot.RequestedAudience),
		GrantedAudience:   fosite.Arguments(snapshot.GrantedAudience),
	}, nil
}
