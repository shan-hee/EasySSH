package app

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
)

const desktopProxyPreferenceKey = "easyssh:network-proxy"

type desktopProxyConfig struct {
	Mode        string `json:"mode"`
	URL         string `json:"url"`
	Username    string `json:"username,omitempty"`
	Password    string `json:"password,omitempty"`
	PasswordSet bool   `json:"passwordSet,omitempty"`
	HasPassword bool   `json:"hasPassword,omitempty"`
}

// Keep one stable RoundTripper for SDK clients, replacing its connection pool
// when the user saves a new policy. In-flight requests finish on the old pool.
type desktopProxyRoundTripper struct {
	current atomic.Pointer[http.Transport]
}

var desktopHTTPProxy = &desktopProxyRoundTripper{}
var desktopHTTPTransportTemplate = http.DefaultTransport.(*http.Transport).Clone()

func (p *desktopProxyRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return p.current.Load().RoundTrip(req)
}

func (p *desktopProxyRoundTripper) CloseIdleConnections() {
	if transport := p.current.Load(); transport != nil {
		transport.CloseIdleConnections()
	}
}

func parseDesktopProxyConfig(value string) (desktopProxyConfig, error) {
	config := desktopProxyConfig{Mode: "system"}
	if value != "" {
		if err := json.Unmarshal([]byte(value), &config); err != nil {
			return config, fmt.Errorf("invalid network proxy settings")
		}
	}
	return normalizeDesktopProxy(config)
}

func normalizeDesktopProxy(config desktopProxyConfig) (desktopProxyConfig, error) {
	switch config.Mode {
	case "system", "direct":
		config.URL = ""
		config.Username = ""
		config.Password = ""
	case "manual":
		config.URL = strings.TrimSpace(config.URL)
		u, err := url.Parse(config.URL)
		if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "socks5") {
			return config, fmt.Errorf("proxy URL must use http, https or socks5 and include a host and port")
		}
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			return config, fmt.Errorf("proxy URL requires a port from 1 to 65535 and must not contain credentials, a path, query or fragment")
		}
	default:
		return config, fmt.Errorf("unknown network proxy mode")
	}
	return config, nil
}

func validateDesktopProxyCredentials(config desktopProxyConfig) error {
	if config.Username == "" && config.Password != "" {
		return fmt.Errorf("proxy username is required when a password is provided")
	}
	if config.Mode != "manual" || config.Username == "" {
		return nil
	}
	u, _ := url.Parse(config.URL)
	if u.Scheme == "socks5" {
		if len(config.Username) > 255 || len(config.Password) == 0 || len(config.Password) > 255 {
			return fmt.Errorf("SOCKS5 username and password must each contain 1 to 255 bytes")
		}
	} else if strings.Contains(config.Username, ":") {
		return fmt.Errorf("HTTP proxy username must not contain a colon")
	}
	return nil
}

func decryptDesktopProxyConfig(config desktopProxyConfig) (desktopProxyConfig, error) {
	password, err := decryptDesktopCredential(config.Password, "desktop_network_proxy", "1", "password")
	if err != nil {
		return config, err
	}
	config.Password = password
	return config, validateDesktopProxyCredentials(config)
}

// Keep the existing preferences binding shape, but never expose stored secrets.
func publicDesktopProxy(config desktopProxyConfig) (string, error) {
	config.HasPassword = config.Password != ""
	config.Password = ""
	config.PasswordSet = false
	encoded, err := json.Marshal(config)
	return string(encoded), err
}

func prepareDesktopProxy(value string, previous desktopProxyConfig) (desktopProxyConfig, error) {
	config, err := parseDesktopProxyConfig(value)
	if err != nil {
		return config, err
	}
	if !config.PasswordSet {
		config.Password = ""
		if config.Mode == "manual" && config.URL == previous.URL && config.Username == previous.Username {
			config.Password = previous.Password
		}
	}
	if err := validateDesktopProxyCredentials(config); err != nil {
		return config, err
	}
	config.PasswordSet = false
	config.HasPassword = false
	return config, nil
}

func readDesktopProxy(db interface{ QueryRow(string, ...any) *sql.Row }) (desktopProxyConfig, error) {
	var config desktopProxyConfig
	err := db.QueryRow(`SELECT mode,url,username,password FROM desktop_network_proxy WHERE id=1`).Scan(&config.Mode, &config.URL, &config.Username, &config.Password)
	if err != nil {
		return config, err
	}
	return normalizeDesktopProxy(config)
}

func (s *DesktopService) saveProxy(value string) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stored, err := readDesktopProxy(tx)
	if err != nil {
		return err
	}
	previous, err := decryptDesktopProxyConfig(stored)
	if err != nil {
		return err
	}
	config, err := prepareDesktopProxy(value, previous)
	if err != nil {
		return err
	}
	fields := []string{}
	for _, field := range []struct {
		name    string
		changed bool
	}{
		{"mode", previous.Mode != config.Mode}, {"url", previous.URL != config.URL},
		{"username", previous.Username != config.Username}, {"password", previous.Password != config.Password},
	} {
		if field.changed {
			fields = append(fields, field.name)
		}
	}
	if len(fields) == 0 {
		return tx.Commit()
	}
	password := stored.Password
	if previous.Password != config.Password {
		password, err = encryptDesktopCredential(config.Password, "desktop_network_proxy", "1", "password")
		if err != nil {
			return err
		}
	}
	if _, err = tx.Exec(`UPDATE desktop_network_proxy SET mode=?,url=?,username=?,password=? WHERE id=1`, config.Mode, config.URL, config.Username, password); err != nil {
		return err
	}
	if err = recordDesktopConfiguration(tx, "network_proxy_updated", "network_proxy", "1", "网络代理", "manual", fields, nil); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	applyDesktopProxy(config)
	return nil
}

func initDesktopProxy(db *sql.DB) error {
	config, err := readDesktopProxy(db)
	if err != nil {
		return err
	}
	config, err = decryptDesktopProxyConfig(config)
	if err != nil {
		return err
	}
	applyDesktopProxy(config)
	// All desktop HTTP clients (including AI SDKs) use the default transport.
	// SSH and SFTP dial TCP separately and are unaffected by this setting.
	http.DefaultTransport = desktopHTTPProxy
	return nil
}

func applyDesktopProxy(config desktopProxyConfig) {
	transport := desktopHTTPTransportTemplate.Clone()
	transport.Proxy = func(req *http.Request) (*url.URL, error) {
		host := req.URL.Hostname()
		ip := net.ParseIP(host)
		if strings.EqualFold(host, "localhost") || (ip != nil && ip.IsLoopback()) {
			return nil, nil
		}
		switch config.Mode {
		case "manual":
			proxyURL, err := url.Parse(config.URL)
			if err != nil {
				return nil, err
			}
			if config.Username != "" {
				proxyURL.User = url.UserPassword(config.Username, config.Password)
			}
			return proxyURL, nil
		case "system":
			return desktopSystemProxy(req)
		default:
			return nil, nil
		}
	}
	if previous := desktopHTTPProxy.current.Swap(transport); previous != nil {
		previous.CloseIdleConnections()
	}
}
