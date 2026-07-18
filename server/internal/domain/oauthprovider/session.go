package oauthprovider

import (
	"encoding/json"

	"github.com/ory/fosite"
	"github.com/ory/fosite/handler/openid"
)

type Session struct {
	*openid.DefaultSession
	UserID         string `json:"user_id"`
	Email          string `json:"email"`
	Role           string `json:"role"`
	SessionID      string `json:"session_id"`
	RememberLogin  bool   `json:"remember_login"`
	InternalClient bool   `json:"internal_client"`
}

func NewSession() *Session {
	return &Session{DefaultSession: openid.NewDefaultSession()}
}

func (s *Session) Clone() fosite.Session {
	if s == nil {
		return nil
	}
	raw, err := json.Marshal(s)
	if err != nil {
		return NewSession()
	}
	cloned := NewSession()
	if err := json.Unmarshal(raw, cloned); err != nil {
		return NewSession()
	}
	return cloned
}
