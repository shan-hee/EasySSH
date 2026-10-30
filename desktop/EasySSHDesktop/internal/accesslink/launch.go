package accesslink

import (
	"errors"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"unicode"

	"github.com/google/uuid"
)

// NormalizeOrigin accepts a deployment origin, not a URL path or credential.
func NormalizeOrigin(raw string) (string, error) {
	if len(raw) > 2048 || strings.IndexFunc(raw, unicode.IsControl) >= 0 {
		return "", errors.New("invalid_origin")
	}
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Opaque != "" || u.Host == "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("invalid_origin")
	}
	u.Scheme, u.Host = strings.ToLower(u.Scheme), strings.ToLower(u.Host)
	host := u.Hostname()
	if strings.ContainsAny(host, "\\% ") || host == "" {
		return "", errors.New("invalid_origin")
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", errors.New("invalid_origin")
		}
	}
	if u.Scheme != "https" {
		addr, _ := netip.ParseAddr(host)
		if u.Scheme != "http" || (host != "localhost" && !addr.IsLoopback()) {
			return "", errors.New("https_required")
		}
	}
	// Canonicalize default ports to avoid duplicate workspaces for one origin.
	if (u.Scheme == "https" && u.Port() == "443") || (u.Scheme == "http" && u.Port() == "80") {
		u.Host = host
		if strings.Contains(host, ":") {
			u.Host = "[" + host + "]"
		}
	}
	return u.Scheme + "://" + u.Host, nil
}

// DesktopLaunch is an untrusted rendezvous hint. It contains no share secret,
// verifier or access token; the browser must approve the bound receiver.
type DesktopLaunch struct {
	Origin    string `json:"origin"`
	HandoffID string `json:"handoff_id"`
}

func ParseDesktopLaunch(raw string) (DesktopLaunch, error) {
	invalid := errors.New("invalid_desktop_launch")
	if len(raw) > 4096 || strings.IndexFunc(raw, unicode.IsControl) >= 0 {
		return DesktopLaunch{}, invalid
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "easyssh" || u.Host != "access" || u.User != nil || u.Opaque != "" || u.Path != "" || u.Fragment != "" || strings.Contains(raw, "#") {
		return DesktopLaunch{}, invalid
	}
	values, err := url.ParseQuery(u.RawQuery)
	if err != nil || len(values) != 2 || len(values["origin"]) != 1 || len(values["handoff"]) != 1 {
		return DesktopLaunch{}, invalid
	}
	origin, err := NormalizeOrigin(values.Get("origin"))
	if err != nil {
		return DesktopLaunch{}, invalid
	}
	id, err := uuid.Parse(values.Get("handoff"))
	if err != nil || id == uuid.Nil || id.String() != values.Get("handoff") {
		return DesktopLaunch{}, invalid
	}
	return DesktopLaunch{origin, id.String()}, nil
}

func DesktopLaunchURL(origin, handoffID string) (string, error) {
	origin, err := NormalizeOrigin(origin)
	if err != nil {
		return "", err
	}
	values := url.Values{"origin": {origin}, "handoff": {handoffID}}
	raw := "easyssh://access?" + values.Encode()
	if _, err := ParseDesktopLaunch(raw); err != nil {
		return "", err
	}
	return raw, nil
}
