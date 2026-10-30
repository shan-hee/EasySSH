package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/auth"
	"github.com/gin-gonic/gin"
)

func TestOwnerCookiePersistenceFollowsSessionPolicy(t *testing.T) {
	for _, remember := range []bool{false, true} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "https://workspace.example/owner/status", nil)
		deadline := time.Now().Add(7 * time.Minute)
		SetOwnerSessionCookie(c, "session-token", &auth.Session{RememberLogin: remember, ExpiresAt: deadline}, nil)
		cookies := recorder.Result().Cookies()
		if len(cookies) != 1 {
			t.Fatalf("cookies = %v", cookies)
		}
		cookie := cookies[0]
		if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || cookie.Name != OwnerCookieName {
			t.Fatalf("cookie protections changed: %+v", cookie)
		}
		if remember {
			if cookie.MaxAge < 419 || cookie.MaxAge > 420 || cookie.Expires.Unix() != deadline.Unix() {
				t.Fatalf("persistent cookie did not follow renewed expiry: %+v", cookie)
			}
		} else if cookie.MaxAge != 0 || !cookie.Expires.IsZero() {
			t.Fatal("non-remembered session persisted a cookie")
		}
	}
}
