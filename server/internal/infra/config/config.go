package config

import (
	"encoding/base64"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/caarlos0/env/v11"
	mysqlconfig "github.com/go-sql-driver/mysql"
)

// Config 应用配置
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	SFTP     SFTPConfig
	GeoIP    GeoIPConfig
	OAuth    OAuthConfig
}

// ServerConfig 服务器配置
type ServerConfig struct {
	Port           int
	Env            string   // development, production
	EncryptionKey  string   // 加密密钥（Base64 编码的 32 字节 AES 密钥）
	WebDevPort     int      // 前端开发端口（从 WEB_PORT 读取）
	TrustedProxies []string // 可信反向代理 IP/CIDR，用于解析客户端真实 IP
}

// DatabaseConfig 数据库配置
type DatabaseConfig struct {
	Driver          string // sqlite, postgres, mysql
	DSN             string // 数据库连接串；SQLite 时为数据库文件路径或 file: DSN
	Debug           bool   // 是否开启SQL调试日志
	MaxIdleConns    int    // 最大空闲连接数
	MaxOpenConns    int    // 最大打开连接数
	ConnMaxLifetime int    // 连接最大生命周期（分钟）
	ConnMaxIdleTime int    // 连接最大空闲时间（分钟）
}

// SFTPConfig SFTP/SSH 池化相关配置
type SFTPConfig struct {
	MaxIdleTimeSeconds     int // SSH 空闲回收时间（秒）
	CleanupIntervalSeconds int // 清理/keepalive 扫描间隔（秒）
	MaxLifeTimeMinutes     int // SSH 最大寿命（分钟，0 表示不启用）
	ConnTimeoutSeconds     int // SSH 建连/keepalive 超时（秒）
	MaxSFTPSessionsPerConn int // 单条 SSH 最大并发 SFTP 会话数（0 表示不限制）
}

type GeoIPConfig struct {
	DatabasePath string
}

type OAuthConfig struct {
	GlobalSecret    string
	Issuer          string
	LoginURL        string
	WebRedirectURIs []string
}

type environmentConfig struct {
	Environment     string   `env:"ENV" envDefault:"development"`
	EncryptionKey   string   `env:"ENCRYPTION_KEY" envDefault:"ZWFzeXNzaC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzISE="`
	WebDevPort      int      `env:"WEB_PORT" envDefault:"3000"`
	TrustedProxies  []string `env:"TRUSTED_PROXIES" envDefault:"127.0.0.1,::1" envSeparator:","`
	DatabaseDriver  string   `env:"DB_DRIVER" envDefault:"sqlite"`
	DatabaseDSN     string   `env:"DB_DSN" envDefault:"./data/easyssh.db"`
	DBMaxIdleConns  int      `env:"DB_MAX_IDLE_CONNS" envDefault:"10"`
	DBMaxOpenConns  int      `env:"DB_MAX_OPEN_CONNS" envDefault:"100"`
	DBMaxLifetime   int      `env:"DB_CONN_MAX_LIFETIME" envDefault:"60"`
	DBMaxIdleTime   int      `env:"DB_CONN_MAX_IDLE_TIME" envDefault:"10"`
	OAuthSecret     string   `env:"OAUTH_GLOBAL_SECRET" envDefault:"easyssh-oauth-secret-change-in-production"`
	SFTPMaxIdle     int      `env:"SFTP_MAX_IDLE_TIME_SECONDS" envDefault:"120"`
	SFTPCleanup     int      `env:"SFTP_CLEANUP_INTERVAL_SECONDS" envDefault:"30"`
	SFTPMaxLifetime int      `env:"SFTP_MAX_LIFE_TIME_MINUTES" envDefault:"0"`
	SFTPConnTimeout int      `env:"SFTP_CONN_TIMEOUT_SECONDS" envDefault:"10"`
	SFTPMaxSessions int      `env:"SFTP_MAX_SESSIONS_PER_CONN" envDefault:"8"`
	GeoIPDatabase   string   `env:"GEOIP_DATABASE_PATH" envDefault:"./data/GeoLite2-City.mmdb"`
	OAuthIssuer     string   `env:"OAUTH_ISSUER" envDefault:"http://localhost:8520/api/v1"`
	OAuthLoginURL   string   `env:"OAUTH_LOGIN_URL" envDefault:"http://localhost:3000/login"`
	OAuthRedirects  []string `env:"OAUTH_WEB_REDIRECT_URIS" envDefault:"http://localhost:3000/auth/callback,http://localhost:8520/auth/callback" envSeparator:","`
}

// Load 从环境变量加载配置
func Load() (*Config, error) {
	var values environmentConfig
	if err := env.Parse(&values); err != nil {
		return nil, fmt.Errorf("failed to parse environment configuration: %w", err)
	}

	config := &Config{
		Server: ServerConfig{
			Port:           getBackendPort(),
			Env:            values.Environment,
			EncryptionKey:  values.EncryptionKey,
			WebDevPort:     values.WebDevPort,
			TrustedProxies: values.TrustedProxies,
		},
		Database: DatabaseConfig{
			Driver:          values.DatabaseDriver,
			DSN:             expandEnvRefs(values.DatabaseDSN),
			MaxIdleConns:    values.DBMaxIdleConns,
			MaxOpenConns:    values.DBMaxOpenConns,
			ConnMaxLifetime: values.DBMaxLifetime,
			ConnMaxIdleTime: values.DBMaxIdleTime,
		},
		SFTP: SFTPConfig{
			MaxIdleTimeSeconds:     values.SFTPMaxIdle,
			CleanupIntervalSeconds: values.SFTPCleanup,
			MaxLifeTimeMinutes:     values.SFTPMaxLifetime,
			ConnTimeoutSeconds:     values.SFTPConnTimeout,
			MaxSFTPSessionsPerConn: values.SFTPMaxSessions,
		},
		GeoIP: GeoIPConfig{DatabasePath: expandEnvRefs(values.GeoIPDatabase)},
		OAuth: OAuthConfig{
			GlobalSecret:    values.OAuthSecret,
			Issuer:          values.OAuthIssuer,
			LoginURL:        values.OAuthLoginURL,
			WebRedirectURIs: values.OAuthRedirects,
		},
	}

	// 根据运行环境自动设置配置
	config.applyEnvironmentDefaults()

	// 验证必要配置
	if err := config.Validate(); err != nil {
		return nil, err
	}

	return config, nil
}

// applyEnvironmentDefaults 根据运行环境自动设置默认配置
func (c *Config) applyEnvironmentDefaults() {
	// 根据 ENV 自动设置数据库调试模式
	if c.Server.Env == "development" {
		c.Database.Debug = true // 开发环境开启 SQL 调试
	} else {
		c.Database.Debug = false // 生产环境关闭 SQL 调试
	}

	if c.Database.Driver == "" {
		c.Database.Driver = "sqlite"
	}
	c.Database.Driver = strings.ToLower(strings.TrimSpace(c.Database.Driver))
	switch c.Database.Driver {
	case "pgsql", "postgresql":
		c.Database.Driver = "postgres"
	}
	c.Database.DSN = strings.TrimSpace(c.Database.DSN)
	c.GeoIP.DatabasePath = strings.TrimSpace(c.GeoIP.DatabasePath)
	c.OAuth.Issuer = strings.TrimRight(strings.TrimSpace(c.OAuth.Issuer), "/")
	c.OAuth.LoginURL = strings.TrimSpace(c.OAuth.LoginURL)
	for index, redirectURI := range c.OAuth.WebRedirectURIs {
		c.OAuth.WebRedirectURIs[index] = strings.TrimSpace(redirectURI)
	}
	if c.Database.DSN == "" && c.Database.Driver == "sqlite" {
		c.Database.DSN = "./data/easyssh.db"
	}

	// SQLite 是默认单机模式，连接池保持保守可以避免写锁争用。
	if c.Database.Driver == "sqlite" {
		c.Database.MaxIdleConns = 1
		c.Database.MaxOpenConns = 1
	}

	// 设置 Gin 框架模式（通过环境变量）
	if c.Server.Env == "production" {
		os.Setenv("GIN_MODE", "release")
	} else {
		os.Setenv("GIN_MODE", "debug")
	}
}

// Validate 验证配置
func (c *Config) Validate() error {
	// 服务器配置验证
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		return fmt.Errorf("server port must be between 1 and 65535")
	}
	if c.Server.Env != "development" && c.Server.Env != "production" {
		return fmt.Errorf("server environment must be 'development' or 'production'")
	}
	if c.Server.EncryptionKey == "" {
		return fmt.Errorf("encryption key is required")
	}
	decoded, err := base64.StdEncoding.DecodeString(c.Server.EncryptionKey)
	if err != nil || len(decoded) != 32 {
		return fmt.Errorf("encryption key must be a base64-encoded 32-byte key")
	}
	// 生产环境必须使用强加密密钥
	if c.Server.Env == "production" && c.Server.EncryptionKey == "ZWFzeXNzaC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzISE=" {
		return fmt.Errorf("must change encryption key in production environment")
	}

	// 数据库配置验证
	switch c.Database.Driver {
	case "sqlite":
		if c.Database.DSN == "" {
			return fmt.Errorf("database connection string is required for sqlite")
		}
	case "postgres":
		if err := validatePostgresDSN(c.Database.DSN); err != nil {
			return err
		}
		// 生产环境建议使用 SSL
		if c.Server.Env == "production" && postgresSSLMode(c.Database.DSN) == "disable" {
			fmt.Println("⚠️  Warning: Database SSL is disabled in production environment")
		}
	case "mysql":
		if err := validateMySQLDSN(c.Database.DSN); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported database driver: %s (must be sqlite, postgres/pgsql, or mysql)", c.Database.Driver)
	}
	// 连接池参数验证
	if c.Database.MaxIdleConns < 1 || c.Database.MaxIdleConns > 100 {
		return fmt.Errorf("database max idle connections must be between 1 and 100")
	}
	if c.Database.MaxOpenConns < 1 || c.Database.MaxOpenConns > 1000 {
		return fmt.Errorf("database max open connections must be between 1 and 1000")
	}
	if c.Database.MaxIdleConns > c.Database.MaxOpenConns {
		return fmt.Errorf("database max idle connections cannot exceed max open connections")
	}
	if c.Database.ConnMaxLifetime < 1 || c.Database.ConnMaxLifetime > 1440 {
		return fmt.Errorf("database connection max lifetime must be between 1 and 1440 minutes (24 hours)")
	}
	if c.Database.ConnMaxIdleTime < 1 || c.Database.ConnMaxIdleTime > 60 {
		return fmt.Errorf("database connection max idle time must be between 1 and 60 minutes")
	}

	if c.OAuth.GlobalSecret == "" {
		return fmt.Errorf("oauth global secret is required")
	}
	if len(c.OAuth.GlobalSecret) < 32 {
		return fmt.Errorf("oauth global secret must be at least 32 characters for security")
	}
	if c.Server.Env == "production" && c.OAuth.GlobalSecret == "easyssh-oauth-secret-change-in-production" {
		return fmt.Errorf("must change oauth global secret in production environment")
	}
	// SFTP/SSH 池化配置验证
	if c.SFTP.MaxIdleTimeSeconds < 5 || c.SFTP.MaxIdleTimeSeconds > 3600 {
		return fmt.Errorf("sftp max idle time must be between 5 and 3600 seconds")
	}
	if c.SFTP.CleanupIntervalSeconds < 5 || c.SFTP.CleanupIntervalSeconds > 600 {
		return fmt.Errorf("sftp cleanup interval must be between 5 and 600 seconds")
	}
	if c.SFTP.MaxLifeTimeMinutes < 0 || c.SFTP.MaxLifeTimeMinutes > 1440 {
		return fmt.Errorf("sftp max life time must be between 0 and 1440 minutes")
	}
	if c.SFTP.ConnTimeoutSeconds < 1 || c.SFTP.ConnTimeoutSeconds > 120 {
		return fmt.Errorf("sftp conn timeout must be between 1 and 120 seconds")
	}
	if c.SFTP.MaxSFTPSessionsPerConn < 0 || c.SFTP.MaxSFTPSessionsPerConn > 64 {
		return fmt.Errorf("sftp max sessions per conn must be between 0 and 64")
	}
	if c.OAuth.Issuer == "" {
		return fmt.Errorf("oauth issuer is required")
	}
	issuer, err := url.Parse(c.OAuth.Issuer)
	if err != nil || issuer.Scheme == "" || issuer.Host == "" {
		return fmt.Errorf("oauth issuer must be an absolute URL: %s", c.OAuth.Issuer)
	}
	loginURL, err := url.Parse(c.OAuth.LoginURL)
	if err != nil || loginURL.Scheme == "" || loginURL.Host == "" {
		return fmt.Errorf("oauth login URL must be an absolute URL: %s", c.OAuth.LoginURL)
	}
	if len(c.OAuth.WebRedirectURIs) == 0 {
		return fmt.Errorf("at least one oauth web redirect URI is required")
	}
	for _, redirectURI := range c.OAuth.WebRedirectURIs {
		parsed, err := url.Parse(redirectURI)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return fmt.Errorf("invalid oauth web redirect URI: %s", redirectURI)
		}
	}

	return nil
}

// DialectorDSN 返回传给 GORM dialector 的连接串。
func (c *DatabaseConfig) DialectorDSN() (string, error) {
	if c.Driver == "mysql" {
		return normalizeMySQLDSN(c.DSN)
	}
	return c.DSN, nil
}

func validatePostgresDSN(dsn string) error {
	if strings.TrimSpace(dsn) == "" {
		return fmt.Errorf("database connection string is required for postgres")
	}

	// pgx 同时支持 URL DSN 与 keyword/value DSN；这里只对 URL 形式做结构校验。
	if strings.Contains(dsn, "://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			return fmt.Errorf("invalid postgres connection string: %w", err)
		}
		if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
			return fmt.Errorf("invalid postgres connection string scheme: %s", parsed.Scheme)
		}
		if parsed.Host == "" {
			return fmt.Errorf("postgres connection string must include host")
		}
		if strings.Trim(parsed.Path, "/") == "" {
			return fmt.Errorf("postgres connection string must include database name")
		}
	}

	return nil
}

func validateMySQLDSN(dsn string) error {
	if strings.TrimSpace(dsn) == "" {
		return fmt.Errorf("database connection string is required for mysql")
	}

	_, err := normalizeMySQLDSN(dsn)
	return err
}

func postgresSSLMode(dsn string) string {
	if parsed, err := url.Parse(dsn); err == nil && (parsed.Scheme == "postgres" || parsed.Scheme == "postgresql") {
		return strings.ToLower(strings.TrimSpace(parsed.Query().Get("sslmode")))
	}

	for _, field := range strings.Fields(dsn) {
		key, value, ok := strings.Cut(field, "=")
		if ok && strings.EqualFold(key, "sslmode") {
			return strings.ToLower(strings.Trim(value, `'"`))
		}
	}

	return ""
}

func normalizeMySQLDSN(dsn string) (string, error) {
	dsn = strings.TrimSpace(dsn)
	if !strings.HasPrefix(strings.ToLower(dsn), "mysql://") {
		return dsn, nil
	}

	parsed, err := url.Parse(dsn)
	if err != nil {
		return "", fmt.Errorf("invalid mysql connection string: %w", err)
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("mysql connection string must include host")
	}

	dbName := strings.TrimPrefix(parsed.Path, "/")
	if dbName == "" {
		return "", fmt.Errorf("mysql connection string must include database name")
	}

	cfg := mysqlconfig.NewConfig()
	cfg.User = parsed.User.Username()
	if password, ok := parsed.User.Password(); ok {
		cfg.Passwd = password
	}
	cfg.Net = "tcp"
	cfg.Addr = parsed.Host
	cfg.DBName = dbName
	cfg.ParseTime = true
	cfg.Loc = time.Local
	cfg.Params = map[string]string{
		"charset": "utf8mb4",
	}

	query := parsed.Query()
	for key, values := range query {
		if len(values) == 0 {
			continue
		}
		value := values[len(values)-1]
		switch strings.ToLower(key) {
		case "parsetime":
			parsedValue, err := strconv.ParseBool(value)
			if err != nil {
				return "", fmt.Errorf("invalid mysql parseTime value: %s", value)
			}
			cfg.ParseTime = parsedValue
		case "loc":
			loc, err := time.LoadLocation(value)
			if err != nil {
				return "", fmt.Errorf("invalid mysql loc value: %s", value)
			}
			cfg.Loc = loc
		default:
			cfg.Params[key] = value
		}
	}

	return cfg.FormatDSN(), nil
}

var envRefPattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(:-([^}]*))?\}`)

func expandEnvRefs(value string) string {
	return envRefPattern.ReplaceAllStringFunc(value, func(match string) string {
		parts := envRefPattern.FindStringSubmatch(match)
		if len(parts) == 0 {
			return match
		}
		if envValue := os.Getenv(parts[1]); envValue != "" {
			return envValue
		}
		if len(parts) > 3 {
			return parts[3]
		}
		return ""
	})
}

func getBackendPort() int {
	rawURL := strings.TrimSpace(os.Getenv("BACKEND_URL"))
	if rawURL == "" {
		return 8520
	}

	port, err := explicitPortFromURL(rawURL)
	if err != nil {
		fmt.Printf("⚠️  Warning: invalid BACKEND_URL %q, using default backend port 8520: %v\n", rawURL, err)
		return 8520
	}
	if port == 0 {
		return 8520
	}
	return port
}

func explicitPortFromURL(rawURL string) (int, error) {
	if !strings.Contains(rawURL, "://") {
		rawURL = "http://" + rawURL
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return 0, err
	}

	rawPort := parsed.Port()
	if rawPort == "" {
		return 0, nil
	}

	port, err := strconv.Atoi(rawPort)
	if err != nil {
		return 0, fmt.Errorf("invalid port %q", rawPort)
	}
	if port < 1 || port > 65535 {
		return 0, fmt.Errorf("port must be between 1 and 65535")
	}
	return port, nil
}
