package oauthprovider

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/easyssh/server/internal/pkg/crypto"
	"github.com/go-jose/go-jose/v3"
	"github.com/google/uuid"
	"github.com/ory/fosite"
	"github.com/ory/fosite/compose"
	"github.com/ory/fosite/token/jwt"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const signingKeyID = "default"

type Config struct {
	Issuer                string
	GlobalSecret          []byte
	AccessTokenLifespan   time.Duration
	RefreshTokenLifespan  time.Duration
	AuthorizeCodeLifespan time.Duration
	WebRedirectURIs       []string
}

type Identity struct {
	UserID    uuid.UUID
	Username  string
	Email     string
	Role      string
	SessionID uuid.UUID
	ExpiresAt time.Time
}

type AuthorizeInput struct {
	ResponseType        string `json:"response_type"`
	ClientID            string `json:"client_id"`
	RedirectURI         string `json:"redirect_uri"`
	Scope               string `json:"scope"`
	State               string `json:"state"`
	CodeChallenge       string `json:"code_challenge"`
	CodeChallengeMethod string `json:"code_challenge_method"`
	Nonce               string `json:"nonce"`
	RememberLogin       bool   `json:"remember_login"`
}

type Service struct {
	db       *gorm.DB
	store    *Store
	provider fosite.OAuth2Provider
	config   Config
	key      *rsa.PrivateKey
}

func New(db *gorm.DB, encryptor *crypto.Encryptor, config Config) (*Service, error) {
	if len(config.GlobalSecret) < 32 {
		return nil, errors.New("oauth global secret must contain at least 32 bytes")
	}
	config.Issuer = strings.TrimRight(strings.TrimSpace(config.Issuer), "/")
	if config.Issuer == "" {
		return nil, errors.New("oauth issuer is required")
	}
	if config.AccessTokenLifespan <= 0 {
		config.AccessTokenLifespan = time.Hour
	}
	if config.RefreshTokenLifespan <= 0 {
		config.RefreshTokenLifespan = 30 * 24 * time.Hour
	}
	if config.AuthorizeCodeLifespan <= 0 {
		config.AuthorizeCodeLifespan = 5 * time.Minute
	}

	key, err := loadOrCreateSigningKey(db, encryptor)
	if err != nil {
		return nil, err
	}
	store := NewStore(db)
	fositeConfig := &fosite.Config{
		GlobalSecret:                   config.GlobalSecret,
		AccessTokenLifespan:            config.AccessTokenLifespan,
		RefreshTokenLifespan:           config.RefreshTokenLifespan,
		AuthorizeCodeLifespan:          config.AuthorizeCodeLifespan,
		IDTokenLifespan:                config.AccessTokenLifespan,
		IDTokenIssuer:                  config.Issuer,
		AccessTokenIssuer:              config.Issuer,
		TokenURL:                       config.Issuer + "/oauth/token",
		EnforcePKCE:                    true,
		EnablePKCEPlainChallengeMethod: false,
		RefreshTokenScopes:             []string{},
		SendDebugMessagesToClients:     false,
	}
	keyGetter := func(context.Context) (interface{}, error) { return key, nil }
	strategy := &compose.CommonStrategy{
		CoreStrategy:               compose.NewOAuth2HMACStrategy(fositeConfig),
		OpenIDConnectTokenStrategy: compose.NewOpenIDConnectStrategy(keyGetter, fositeConfig),
		Signer:                     &jwt.DefaultSigner{GetPrivateKey: keyGetter},
	}
	provider := compose.Compose(
		fositeConfig,
		store,
		strategy,
		compose.OAuth2AuthorizeExplicitFactory,
		compose.OAuth2RefreshTokenGrantFactory,
		compose.OpenIDConnectExplicitFactory,
		compose.OpenIDConnectRefreshFactory,
		compose.OAuth2TokenIntrospectionFactory,
		compose.OAuth2TokenRevocationFactory,
		compose.OAuth2PKCEFactory,
	)
	service := &Service{db: db, store: store, provider: provider, config: config, key: key}
	if err := service.seedBuiltInClient(context.Background()); err != nil {
		return nil, err
	}
	return service, nil
}

func (s *Service) NewAuthorizeRequest(ctx context.Context, input AuthorizeInput) (fosite.AuthorizeRequester, error) {
	values := url.Values{
		"response_type":         {strings.TrimSpace(input.ResponseType)},
		"client_id":             {input.ClientID},
		"redirect_uri":          {input.RedirectURI},
		"scope":                 {input.Scope},
		"state":                 {input.State},
		"code_challenge":        {input.CodeChallenge},
		"code_challenge_method": {input.CodeChallengeMethod},
		"nonce":                 {input.Nonce},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, s.config.Issuer+"/oauth/authorize?"+values.Encode(), nil)
	if err != nil {
		return nil, err
	}
	return s.provider.NewAuthorizeRequest(ctx, request)
}

func (s *Service) IssueAuthorizationCode(ctx context.Context, request fosite.AuthorizeRequester, identity Identity, rememberLogin bool) (string, error) {
	session := NewSession()
	session.UserID = identity.UserID.String()
	session.Username = identity.Username
	session.Email = identity.Email
	session.Role = identity.Role
	session.SessionID = identity.SessionID.String()
	session.RememberLogin = rememberLogin
	session.Subject = identity.UserID.String()
	session.Claims.Subject = identity.UserID.String()
	session.Claims.AuthTime = time.Now().UTC()
	session.Claims.Extra = map[string]interface{}{
		"email":      identity.Email,
		"role":       identity.Role,
		"session_id": identity.SessionID.String(),
	}
	session.IDTokenHeaders().Add("kid", signingKeyID)
	for _, scope := range request.GetRequestedScopes() {
		request.GrantScope(scope)
	}
	for _, audience := range request.GetRequestedAudience() {
		request.GrantAudience(audience)
	}
	response, err := s.provider.NewAuthorizeResponse(ctx, request, session)
	if err != nil {
		return "", err
	}
	return response.GetCode(), nil
}

func (s *Service) WriteAuthorizeError(ctx context.Context, writer http.ResponseWriter, request fosite.AuthorizeRequester, err error) {
	s.provider.WriteAuthorizeError(ctx, writer, request, err)
}

func (s *Service) NewAccessRequest(ctx context.Context, values url.Values, authorizationHeader string) (fosite.AccessRequester, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.config.Issuer+"/oauth/token", strings.NewReader(values.Encode()))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if strings.TrimSpace(authorizationHeader) != "" {
		request.Header.Set("Authorization", authorizationHeader)
	}
	return s.provider.NewAccessRequest(ctx, request, NewSession())
}

func (s *Service) NewAccessResponse(ctx context.Context, request fosite.AccessRequester) (map[string]interface{}, *Session, error) {
	for _, scope := range request.GetRequestedScopes() {
		request.GrantScope(scope)
	}
	response, err := s.provider.NewAccessResponse(ctx, request)
	if err != nil {
		return nil, nil, err
	}
	session, _ := request.GetSession().(*Session)
	return response.ToMap(), session, nil
}

func (s *Service) WriteAccessError(ctx context.Context, writer http.ResponseWriter, request fosite.AccessRequester, err error) {
	s.provider.WriteAccessError(ctx, writer, request, err)
}

func (s *Service) ValidateAccessToken(ctx context.Context, token string) (*Identity, error) {
	_, request, err := s.provider.IntrospectToken(ctx, token, fosite.AccessToken, NewSession())
	if err != nil {
		return nil, err
	}
	session, ok := request.GetSession().(*Session)
	if !ok {
		return nil, errors.New("oauth access token has invalid session")
	}
	userID, err := uuid.Parse(session.UserID)
	if err != nil {
		return nil, err
	}
	sessionID, err := uuid.Parse(session.SessionID)
	if err != nil {
		return nil, err
	}
	return &Identity{
		UserID: userID, Username: session.Username, Email: session.Email, Role: session.Role,
		SessionID: sessionID, ExpiresAt: session.GetExpiresAt(fosite.AccessToken),
	}, nil
}

func (s *Service) UserInfo(ctx context.Context, token string) (map[string]interface{}, error) {
	_, request, err := s.provider.IntrospectToken(ctx, token, fosite.AccessToken, NewSession())
	if err != nil {
		return nil, err
	}
	session, ok := request.GetSession().(*Session)
	if !ok || strings.TrimSpace(session.UserID) == "" {
		return nil, errors.New("oauth access token has invalid session")
	}

	claims := map[string]interface{}{"sub": session.UserID}
	grantedScopes := request.GetGrantedScopes()
	if grantedScopes.Has("profile") {
		claims["preferred_username"] = session.Username
	}
	if grantedScopes.Has("email") {
		claims["email"] = session.Email
	}
	if grantedScopes.Has("easyssh") {
		claims["role"] = session.Role
		claims["session_id"] = session.SessionID
	}
	return claims, nil
}

func (s *Service) RevokeToken(ctx context.Context, token string) error {
	values := url.Values{"token": {token}, "client_id": {"easyssh-web"}}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.config.Issuer+"/oauth/revoke", strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return s.provider.NewRevocationRequest(ctx, request)
}

func (s *Service) RevokeRequest(ctx context.Context, requestID string) error {
	if strings.TrimSpace(requestID) == "" {
		return nil
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Grant{}).Where("kind = ? AND request_id = ?", grantRefreshToken, requestID).Update("active", false).Error; err != nil {
			return err
		}
		return tx.Where("kind = ? AND request_id = ?", grantAccessToken, requestID).Delete(&Grant{}).Error
	})
}

func (s *Service) HandleRevocation(w http.ResponseWriter, request *http.Request) {
	err := s.provider.NewRevocationRequest(request.Context(), request)
	s.provider.WriteRevocationResponse(request.Context(), w, err)
}

func (s *Service) HandleIntrospection(w http.ResponseWriter, request *http.Request) {
	response, err := s.provider.NewIntrospectionRequest(request.Context(), request, NewSession())
	if err != nil {
		s.provider.WriteIntrospectionError(request.Context(), w, err)
		return
	}
	s.provider.WriteIntrospectionResponse(request.Context(), w, response)
}

func (s *Service) JWKS() jose.JSONWebKeySet {
	return jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{
		Key: &s.key.PublicKey, KeyID: signingKeyID, Algorithm: "RS256", Use: "sig",
	}}}
}

func (s *Service) Discovery() map[string]interface{} {
	return map[string]interface{}{
		"issuer":                                s.config.Issuer,
		"authorization_endpoint":                s.config.Issuer + "/oauth/authorize",
		"token_endpoint":                        s.config.Issuer + "/oauth/token",
		"userinfo_endpoint":                     s.config.Issuer + "/oauth/userinfo",
		"revocation_endpoint":                   s.config.Issuer + "/oauth/revoke",
		"introspection_endpoint":                s.config.Issuer + "/oauth/introspect",
		"jwks_uri":                              s.config.Issuer + "/oauth/jwks",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"token_endpoint_auth_methods_supported": []string{"none", "client_secret_basic", "client_secret_post"},
		"code_challenge_methods_supported":      []string{"S256"},
		"scopes_supported":                      []string{"openid", "profile", "email", "easyssh", "offline_access"},
		"claims_supported":                      []string{"sub", "preferred_username", "email", "role", "session_id"},
	}
}

func (s *Service) DefaultWebRedirectURI() string {
	if len(s.config.WebRedirectURIs) == 0 {
		return ""
	}
	return s.config.WebRedirectURIs[0]
}

func (s *Service) IssueTokenPair(ctx context.Context, identity Identity, rememberLogin bool, redirectURI string) (map[string]interface{}, *Session, string, error) {
	verifierBytes := make([]byte, 48)
	if _, err := rand.Read(verifierBytes); err != nil {
		return nil, nil, "", err
	}
	verifier := hex.EncodeToString(verifierBytes)
	digest := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(digest[:])
	authorizeRequest, err := s.NewAuthorizeRequest(ctx, AuthorizeInput{
		ResponseType: "code", ClientID: "easyssh-web", RedirectURI: redirectURI,
		Scope: "openid profile email easyssh offline_access",
		State: uuid.NewString(), CodeChallenge: challenge, CodeChallengeMethod: "S256",
		RememberLogin: rememberLogin,
	})
	if err != nil {
		return nil, nil, "", err
	}
	code, err := s.IssueAuthorizationCode(ctx, authorizeRequest, identity, rememberLogin)
	if err != nil {
		return nil, nil, "", err
	}
	accessRequest, err := s.NewAccessRequest(ctx, url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "client_id": {"easyssh-web"},
		"redirect_uri": {redirectURI}, "code_verifier": {verifier},
	}, "")
	if err != nil {
		return nil, nil, "", err
	}
	response, session, err := s.NewAccessResponse(ctx, accessRequest)
	return response, session, accessRequest.GetID(), err
}

func (s *Service) CreateLoginChallenge(ctx context.Context, userID uuid.UUID, input AuthorizeInput) (string, error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	token := hex.EncodeToString(random)
	hash := sha256.Sum256([]byte(token))
	raw, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	challenge := &LoginChallenge{
		TokenHash:   hex.EncodeToString(hash[:]),
		UserID:      userID,
		RequestData: string(raw),
		ExpiresAt:   time.Now().Add(5 * time.Minute),
	}
	return token, s.db.WithContext(ctx).Create(challenge).Error
}

func (s *Service) LoadLoginChallenge(ctx context.Context, token string) (uuid.UUID, uuid.UUID, AuthorizeInput, error) {
	hash := sha256.Sum256([]byte(strings.TrimSpace(token)))
	var challenge LoginChallenge
	if err := s.db.WithContext(ctx).Where("token_hash = ?", hex.EncodeToString(hash[:])).First(&challenge).Error; err != nil {
		return uuid.Nil, uuid.Nil, AuthorizeInput{}, err
	}
	if challenge.UsedAt != nil || time.Now().After(challenge.ExpiresAt) {
		return uuid.Nil, uuid.Nil, AuthorizeInput{}, fosite.ErrInvalidRequest.WithHint("login challenge is expired or already used")
	}
	var input AuthorizeInput
	if err := json.Unmarshal([]byte(challenge.RequestData), &input); err != nil {
		return uuid.Nil, uuid.Nil, AuthorizeInput{}, err
	}
	return challenge.ID, challenge.UserID, input, nil
}

func (s *Service) ConsumeLoginChallenge(ctx context.Context, challengeID uuid.UUID) error {
	now := time.Now()
	result := s.db.WithContext(ctx).Model(&LoginChallenge{}).
		Where("id = ? AND used_at IS NULL AND expires_at > ?", challengeID, now).
		Update("used_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fosite.ErrInvalidRequest.WithHint("login challenge is expired or already used")
	}
	return nil
}

func (s *Service) seedBuiltInClient(ctx context.Context) error {
	client := Client{
		ID:                      "easyssh-web",
		Name:                    "EasySSH Web",
		RedirectURIs:            append([]string(nil), s.config.WebRedirectURIs...),
		GrantTypes:              []string{"authorization_code", "refresh_token"},
		ResponseTypes:           []string{"code"},
		Scopes:                  []string{"openid", "profile", "email", "easyssh", "offline_access"},
		Audience:                []string{"easyssh-api"},
		Public:                  true,
		TokenEndpointAuthMethod: "none",
	}
	return s.db.WithContext(ctx).Where("id = ?", client.ID).Assign(client).FirstOrCreate(&client).Error
}

func loadOrCreateSigningKey(db *gorm.DB, encryptor *crypto.Encryptor) (*rsa.PrivateKey, error) {
	var stored SigningKey
	err := db.Where("id = ?", signingKeyID).First(&stored).Error
	if err == nil {
		decrypted, err := encryptor.DecryptSecret(stored.EncryptedPrivatePEM, []byte("oauth-signing-key:"+signingKeyID))
		if err != nil {
			return nil, err
		}
		return parsePrivateKey([]byte(decrypted))
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		return nil, err
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	pemData := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})
	encrypted, err := encryptor.EncryptSecret(string(pemData), []byte("oauth-signing-key:"+signingKeyID))
	if err != nil {
		return nil, err
	}
	if err := db.Create(&SigningKey{ID: signingKeyID, EncryptedPrivatePEM: encrypted}).Error; err != nil {
		return nil, err
	}
	return key, nil
}

func parsePrivateKey(pemData []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(pemData)
	if block == nil {
		return nil, errors.New("invalid oauth signing key PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("oauth signing key has type %T", parsed)
	}
	return key, nil
}

func HashClientSecret(secret string) (string, error) {
	hashed, err := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
	return string(hashed), err
}
