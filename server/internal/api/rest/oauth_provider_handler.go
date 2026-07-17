package rest

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/easyssh/server/internal/domain/oauthprovider"
	"github.com/gin-gonic/gin"
)

type OAuthProviderHandler struct {
	provider *oauthprovider.Service
	loginURL string
}

func NewOAuthProviderHandler(provider *oauthprovider.Service, loginURL string) *OAuthProviderHandler {
	return &OAuthProviderHandler{provider: provider, loginURL: loginURL}
}

func (h *OAuthProviderHandler) Authorize(c *gin.Context) {
	input := oauthprovider.AuthorizeInput{
		ResponseType:        strings.TrimSpace(c.Query("response_type")),
		ClientID:            strings.TrimSpace(c.Query("client_id")),
		RedirectURI:         strings.TrimSpace(c.Query("redirect_uri")),
		Scope:               strings.TrimSpace(c.Query("scope")),
		State:               c.Query("state"),
		CodeChallenge:       strings.TrimSpace(c.Query("code_challenge")),
		CodeChallengeMethod: strings.TrimSpace(c.Query("code_challenge_method")),
		Nonce:               c.Query("nonce"),
	}
	authorizeRequest, err := h.provider.NewAuthorizeRequest(c.Request.Context(), input)
	if err != nil {
		h.provider.WriteAuthorizeError(c.Request.Context(), c.Writer, authorizeRequest, err)
		return
	}

	loginURL, err := url.Parse(h.loginURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error", "message": "OAuth login URL is invalid"})
		return
	}
	query := loginURL.Query()
	query.Set("oauth_response_type", input.ResponseType)
	query.Set("oauth_client_id", input.ClientID)
	query.Set("oauth_redirect_uri", input.RedirectURI)
	query.Set("oauth_scope", input.Scope)
	query.Set("oauth_state", input.State)
	query.Set("oauth_code_challenge", input.CodeChallenge)
	query.Set("oauth_code_challenge_method", input.CodeChallengeMethod)
	if input.Nonce != "" {
		query.Set("oauth_nonce", input.Nonce)
	}
	loginURL.RawQuery = query.Encode()
	c.Redirect(http.StatusFound, loginURL.String())
}

func (h *OAuthProviderHandler) Discovery(c *gin.Context) {
	c.JSON(200, h.provider.Discovery())
}

func (h *OAuthProviderHandler) JWKS(c *gin.Context) {
	c.JSON(200, h.provider.JWKS())
}

func (h *OAuthProviderHandler) UserInfo(c *gin.Context) {
	authorization := strings.Fields(c.GetHeader("Authorization"))
	if len(authorization) != 2 || !strings.EqualFold(authorization[0], "Bearer") {
		c.Header("WWW-Authenticate", `Bearer realm="userinfo"`)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token", "error_description": "Missing bearer access token"})
		return
	}
	claims, err := h.provider.UserInfo(c.Request.Context(), strings.TrimSpace(authorization[1]))
	if err != nil {
		c.Header("WWW-Authenticate", `Bearer realm="userinfo", error="invalid_token"`)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token", "error_description": "Access token is invalid or expired"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, claims)
}

func (h *OAuthProviderHandler) Revoke(c *gin.Context) {
	h.provider.HandleRevocation(c.Writer, c.Request)
}

func (h *OAuthProviderHandler) Introspect(c *gin.Context) {
	h.provider.HandleIntrospection(c.Writer, c.Request)
}
