package config

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
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
}

// ServerConfig 服务器配置
type ServerConfig struct {
	Port          int
	Env           string // development, production
	EncryptionKey string // 加密密钥（Base64 编码的 32 字节 AES 密钥）
	WebDevPort    int    // 前端开发端口（从 WEB_PORT 读取）
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

type environmentConfig struct {
	Environment    string `env:"ENV" envDefault:"development"`
	EncryptionKey  string `env:"ENCRYPTION_KEY"`
	WebDevPort     int    `env:"WEB_PORT" envDefault:"3000"`
	DatabaseDriver string `env:"DB_DRIVER" envDefault:"sqlite"`
	DatabaseDSN    string `env:"DB_DSN" envDefault:"./data/easyssh.db"`
	DBMaxIdleConns int    `env:"DB_MAX_IDLE_CONNS" envDefault:"10"`
	DBMaxOpenConns int    `env:"DB_MAX_OPEN_CONNS" envDefault:"100"`
	DBMaxLifetime  int    `env:"DB_CONN_MAX_LIFETIME" envDefault:"60"`
	DBMaxIdleTime  int    `env:"DB_CONN_MAX_IDLE_TIME" envDefault:"10"`
}

// Load 从环境变量加载配置
func Load() (*Config, error) {
	var values environmentConfig
	if err := env.Parse(&values); err != nil {
		return nil, fmt.Errorf("failed to parse environment configuration: %w", err)
	}

	databaseDSN := expandEnvRefs(values.DatabaseDSN)
	encryptionKey, err := resolveEncryptionKey(values.EncryptionKey, values.DatabaseDriver, databaseDSN)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve deployment root key: %w", err)
	}

	config := &Config{
		Server: ServerConfig{
			Port:          getBackendPort(),
			Env:           values.Environment,
			EncryptionKey: encryptionKey,
			WebDevPort:    values.WebDevPort,
		},
		Database: DatabaseConfig{
			Driver:          values.DatabaseDriver,
			DSN:             databaseDSN,
			MaxIdleConns:    values.DBMaxIdleConns,
			MaxOpenConns:    values.DBMaxOpenConns,
			ConnMaxLifetime: values.DBMaxLifetime,
			ConnMaxIdleTime: values.DBMaxIdleTime,
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

	return nil
}

const generatedRootKeyFile = "easyssh-root.key"

func resolveEncryptionKey(configured, driver, dsn string) (string, error) {
	if configured = strings.TrimSpace(configured); configured != "" {
		return configured, nil
	}

	dataDir := rootKeyDataDir(driver, dsn)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return "", err
	}
	keyPath := filepath.Join(dataDir, generatedRootKeyFile)
	if key, err := readRootKey(keyPath); err == nil {
		return key, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}

	randomKey := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, randomKey); err != nil {
		return "", err
	}
	encoded := base64.StdEncoding.EncodeToString(randomKey)
	file, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if os.IsExist(err) {
			return readRootKey(keyPath)
		}
		return "", err
	}
	if _, err := file.WriteString(encoded + "\n"); err != nil {
		_ = file.Close()
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	fmt.Printf("✅ Generated deployment root key: %s\n", keyPath)
	return encoded, nil
}

func readRootKey(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	key := strings.TrimSpace(string(raw))
	decoded, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(decoded) != 32 {
		return "", fmt.Errorf("invalid deployment root key file: %s", path)
	}
	return key, nil
}

func rootKeyDataDir(driver, dsn string) string {
	if normalized := strings.ToLower(strings.TrimSpace(driver)); normalized == "sqlite" || normalized == "" {
		pathValue := strings.TrimSpace(dsn)
		if strings.HasPrefix(pathValue, "file:") {
			pathValue = strings.TrimPrefix(pathValue, "file:")
			if index := strings.Index(pathValue, "?"); index >= 0 {
				pathValue = pathValue[:index]
			}
		}
		if pathValue != "" && pathValue != ":memory:" {
			return filepath.Dir(pathValue)
		}
	}
	return "./data"
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
