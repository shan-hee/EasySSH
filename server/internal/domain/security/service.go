package security

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// Service 安全配置服务接口
type Service interface {
	// Get 获取安全配置
	Get(ctx context.Context) (*SecurityConfig, error)

	SaveWorkspace(ctx context.Context, config *SecurityConfig) error
	SaveLoginSession(ctx context.Context, config *SecurityConfig) error
	SaveLoginSecurity(ctx context.Context, config *SecurityConfig) error
	SaveWebSecurity(ctx context.Context, config *SecurityConfig) error
	SaveCORS(ctx context.Context, config *SecurityConfig) error
	SaveAccessControl(ctx context.Context, config *SecurityConfig) error

	// GetCORSConfig 获取CORS配置
	GetCORSConfig(ctx context.Context) (*CORSConfig, error)

	// GetRateLimitConfig 获取速率限制配置
	GetRateLimitConfig(ctx context.Context) (*RateLimitConfig, error)

	// GetAccountLockConfig 获取账户锁定配置
	GetAccountLockConfig(ctx context.Context) (*AccountLockConfig, error)

	// CheckIPAllowed 检查IP是否允许访问
	CheckIPAllowed(ctx context.Context, ip string) (bool, error)

	// CheckIPAllowedWithConfig 使用已有配置检查IP是否允许访问(避免重复查询)
	CheckIPAllowedWithConfig(config *SecurityConfig, ip string) bool
}

type service struct {
	repo Repository
}

func applySecurityConfigDefaults(config *SecurityConfig) {
	if config == nil {
		return
	}

	if config.SessionTimeout <= 0 {
		config.SessionTimeout = 30
	}
	if config.MaxTabs <= 0 {
		config.MaxTabs = 10
	}
	if config.InactiveMinutes <= 0 {
		config.InactiveMinutes = 15
	}
	if config.LoginLimit <= 0 {
		config.LoginLimit = 5
	}
	if config.APILimit <= 0 {
		config.APILimit = 100
	}
	if config.TwoFALimit <= 0 {
		config.TwoFALimit = 5
	}
	if config.MaxIPFailAttempts <= 0 {
		config.MaxIPFailAttempts = 10
	}
	if config.IPLockDurationMinutes <= 0 {
		config.IPLockDurationMinutes = 30
	}
	if config.MaxAccountFailAttempts <= 0 {
		config.MaxAccountFailAttempts = 5
	}
	if config.AccountLockDurationMinutes <= 0 {
		config.AccountLockDurationMinutes = 60
	}
	if strings.TrimSpace(config.TrustedProxies) == "" {
		config.TrustedProxies = "127.0.0.1\n::1"
	}
	if strings.TrimSpace(config.CookieSecureMode) == "" {
		config.CookieSecureMode = "auto"
	}
	if strings.TrimSpace(config.CookieSameSite) == "" {
		config.CookieSameSite = "lax"
	}
}

// NewService 创建安全配置服务
func NewService(repo Repository) Service {
	return &service{repo: repo}
}

// Get 获取安全配置
func (s *service) Get(ctx context.Context) (*SecurityConfig, error) {
	config, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	applySecurityConfigDefaults(config)
	return config, nil
}

func (s *service) SaveWorkspace(ctx context.Context, config *SecurityConfig) error {
	return s.save(ctx, config, s.validateWorkspace, s.repo.SaveWorkspace)
}

func (s *service) SaveLoginSession(ctx context.Context, config *SecurityConfig) error {
	return s.save(ctx, config, s.validateLoginSession, s.repo.SaveLoginSession)
}

func (s *service) SaveLoginSecurity(ctx context.Context, config *SecurityConfig) error {
	return s.save(ctx, config, s.validateLoginSecurity, s.repo.SaveLoginSecurity)
}

func (s *service) SaveWebSecurity(ctx context.Context, config *SecurityConfig) error {
	return s.save(ctx, config, s.validateWebSecurity, s.repo.SaveWebSecurity)
}

func (s *service) SaveCORS(ctx context.Context, config *SecurityConfig) error {
	return s.save(ctx, config, s.validateCORS, s.repo.SaveCORS)
}

func (s *service) SaveAccessControl(ctx context.Context, config *SecurityConfig) error {
	return s.save(ctx, config, s.validateAccessControl, s.repo.SaveAccessControl)
}

type saveRepositoryFunc func(context.Context, *SecurityConfig) error

func (s *service) save(ctx context.Context, config *SecurityConfig, validate func(*SecurityConfig) error, save saveRepositoryFunc) error {
	if config == nil {
		return errors.New("security configuration is required")
	}
	if err := validate(config); err != nil {
		return err
	}
	return save(ctx, config)
}

// GetCORSConfig 获取CORS配置
func (s *service) GetCORSConfig(ctx context.Context) (*CORSConfig, error) {
	return s.repo.GetCORSConfig(ctx)
}

// GetRateLimitConfig 获取速率限制配置
func (s *service) GetRateLimitConfig(ctx context.Context) (*RateLimitConfig, error) {
	config, err := s.Get(ctx)
	if err != nil {
		return nil, err
	}

	twoFALimit := config.TwoFALimit
	if twoFALimit <= 0 {
		twoFALimit = 5 // 默认值
	}

	return &RateLimitConfig{
		LoginLimit: config.LoginLimit,
		APILimit:   config.APILimit,
		TwoFALimit: twoFALimit,
	}, nil
}

// GetAccountLockConfig 获取账户锁定配置
func (s *service) GetAccountLockConfig(ctx context.Context) (*AccountLockConfig, error) {
	config, err := s.Get(ctx)
	if err != nil {
		return DefaultAccountLockConfig(), err
	}

	return &AccountLockConfig{
		Enabled:                    config.AccountLockEnabled,
		MaxIPFailAttempts:          config.MaxIPFailAttempts,
		IPLockDurationMinutes:      config.IPLockDurationMinutes,
		MaxAccountFailAttempts:     config.MaxAccountFailAttempts,
		AccountLockDurationMinutes: config.AccountLockDurationMinutes,
	}, nil
}

// CheckIPAllowed 检查IP是否允许访问
func (s *service) CheckIPAllowed(ctx context.Context, ip string) (bool, error) {
	config, err := s.Get(ctx)
	if err != nil {
		return false, err
	}

	return s.CheckIPAllowedWithConfig(config, ip), nil
}

// CheckIPAllowedWithConfig 使用已有配置检查IP是否允许访问(避免重复查询)
func (s *service) CheckIPAllowedWithConfig(config *SecurityConfig, ip string) bool {
	// 1. 先检查黑名单（优先级最高）
	if config.BlocklistIPs != "" {
		blocklist := strings.Split(config.BlocklistIPs, "\n")
		for _, blocked := range blocklist {
			blocked = strings.TrimSpace(blocked)
			if blocked == "" {
				continue
			}
			if s.matchIP(ip, blocked) {
				return false
			}
		}
	}

	// 2. 检查白名单
	if config.AllowlistIPs != "" {
		allowlist := strings.Split(config.AllowlistIPs, "\n")
		for _, allowed := range allowlist {
			allowed = strings.TrimSpace(allowed)
			if allowed == "" {
				continue
			}
			if s.matchIP(ip, allowed) {
				return true
			}
		}
		// 如果配置了白名单但不在列表中，则拒绝
		return false
	}

	// 3. 如果没有配置任何白名单，则允许所有IP
	return true
}

// matchIP 检查IP是否匹配规则（支持单个IP和CIDR）
func (s *service) matchIP(ip, rule string) bool {
	// 尝试解析为CIDR
	if strings.Contains(rule, "/") {
		_, ipNet, err := net.ParseCIDR(rule)
		if err != nil {
			return false
		}
		testIP := net.ParseIP(ip)
		if testIP == nil {
			return false
		}
		return ipNet.Contains(testIP)
	}

	// 单个IP地址匹配
	return ip == rule
}

func (s *service) validateWorkspace(config *SecurityConfig) error {
	if config.MaxTabs < 1 || config.MaxTabs > 200 {
		return errors.New("max tabs must be between 1 and 200")
	}
	if config.InactiveMinutes < 5 || config.InactiveMinutes > 1440 {
		return errors.New("inactive minutes must be between 5 and 1440")
	}
	return nil
}

func (s *service) validateLoginSession(config *SecurityConfig) error {
	if config.SessionTimeout < 5 || config.SessionTimeout > 1440 {
		return errors.New("session timeout must be between 5 and 1440 minutes")
	}
	return nil
}

func (s *service) validateLoginSecurity(config *SecurityConfig) error {
	if config.LoginLimit < 1 || config.LoginLimit > 100 {
		return errors.New("login limit must be between 1 and 100")
	}
	if config.APILimit < 10 || config.APILimit > 10000 {
		return errors.New("api limit must be between 10 and 10000")
	}
	if config.TwoFALimit < 1 || config.TwoFALimit > 20 {
		return errors.New("2FA limit must be between 1 and 20")
	}
	return nil
}

func (s *service) validateCORS(config *SecurityConfig) error {
	if config.CORSConfig != "" {
		var cors CORSConfig
		if err := json.Unmarshal([]byte(config.CORSConfig), &cors); err != nil {
			return fmt.Errorf("invalid CORS config: %w", err)
		}

		for _, origin := range cors.AllowedOrigins {
			origin = strings.TrimSpace(origin)
			if origin == "*" {
				return errors.New("wildcard CORS origin is not allowed when credentials are enabled")
			}
			if err := validateHTTPOrigin(origin); err != nil {
				return fmt.Errorf("invalid CORS origin %q: %w", origin, err)
			}
		}
	}
	return nil
}

func (s *service) validateWebSecurity(config *SecurityConfig) error {
	switch config.CookieSecureMode {
	case "auto", "always", "never":
	default:
		return errors.New("cookie secure mode must be auto, always, or never")
	}
	switch config.CookieSameSite {
	case "lax", "strict", "none":
	default:
		return errors.New("cookie SameSite must be lax, strict, or none")
	}
	if config.CookieSameSite == "none" && config.CookieSecureMode == "never" {
		return errors.New("SameSite=None requires secure cookies")
	}
	if domain := strings.TrimSpace(config.CookieDomain); strings.Contains(domain, "://") || strings.ContainsAny(domain, "/\\ \t\r\n") {
		return errors.New("cookie domain must be a hostname without scheme, path, or whitespace")
	}
	if strings.ContainsAny(config.ContentSecurityPolicy, "\r\n") {
		return errors.New("Content-Security-Policy must be a single line")
	}
	for _, proxy := range config.TrustedProxyList() {
		if proxy == "0.0.0.0/0" || proxy == "::/0" {
			return errors.New("trusted proxies must not include the entire internet")
		}
		if err := s.validateIPAddress(proxy); err != nil {
			return fmt.Errorf("invalid trusted proxy %q: %w", proxy, err)
		}
	}
	for _, origin := range config.CSRFTrustedOriginList() {
		if err := validateHTTPOrigin(origin); err != nil {
			return fmt.Errorf("invalid CSRF trusted origin %q: %w", origin, err)
		}
	}
	return nil
}

func (s *service) validateAccessControl(config *SecurityConfig) error {
	if config.AllowlistIPs != "" {
		ips := strings.Split(config.AllowlistIPs, "\n")
		for _, ip := range ips {
			ip = strings.TrimSpace(ip)
			if ip == "" {
				continue
			}
			if err := s.validateIPAddress(ip); err != nil {
				return fmt.Errorf("invalid allowlist IP: %s - %w", ip, err)
			}
		}
	}

	if config.BlocklistIPs != "" {
		ips := strings.Split(config.BlocklistIPs, "\n")
		for _, ip := range ips {
			ip = strings.TrimSpace(ip)
			if ip == "" {
				continue
			}
			if err := s.validateIPAddress(ip); err != nil {
				return fmt.Errorf("invalid blocklist IP: %s - %w", ip, err)
			}
		}
	}

	return nil
}

func validateHTTPOrigin(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return errors.New("must be an absolute HTTP(S) origin")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return errors.New("must not contain a path")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("must not contain query parameters or fragments")
	}
	return nil
}

// validateIPAddress 验证IP地址格式（支持IPv4、IPv6和CIDR）
func (s *service) validateIPAddress(ip string) error {
	// CIDR格式
	if strings.Contains(ip, "/") {
		_, _, err := net.ParseCIDR(ip)
		if err != nil {
			return fmt.Errorf("invalid CIDR format: %w", err)
		}
		return nil
	}

	// 单个IP地址
	if net.ParseIP(ip) == nil {
		return errors.New("invalid IP address format")
	}

	return nil
}
