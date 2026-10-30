package monitoring

import (
	"fmt"

	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sshutil"
)

// DataSourceFactory 数据源工厂
type DataSourceFactory struct {
	serverService   server.Service
	encryptor       *crypto.Encryptor
	hostKeyCallback sshutil.HostKeyPolicy
}

// NewDataSourceFactory 创建数据源工厂
func NewDataSourceFactory(serverService server.Service, encryptor *crypto.Encryptor, hostKeyCallback sshutil.HostKeyPolicy) *DataSourceFactory {
	return &DataSourceFactory{
		serverService:   serverService,
		encryptor:       encryptor,
		hostKeyCallback: hostKeyCallback,
	}
}

// CreateDataSource 根据所有者配置创建数据源
func (f *DataSourceFactory) CreateDataSource(owner *auth.Owner) (DataSourceProvider, error) {
	switch auth.MonitorDataSourceType(owner.MonitorDataSource) {
	case auth.MonitorDataSourceEasySSH, "":
		// 默认使用 EasySSH
		return NewEasySSHDataSource(f.serverService, f.encryptor, owner.ID, f.hostKeyCallback), nil

	case auth.MonitorDataSourceNezha:
		if owner.NezhaAPIEndpoint == "" {
			return nil, fmt.Errorf("Nezha endpoint is required")
		}
		// 解密 token
		token := owner.NezhaAPIToken
		if token != "" {
			if f.encryptor == nil {
				return nil, fmt.Errorf("monitor credential encryption is unavailable")
			}
			decrypted, err := f.encryptor.DecryptSecret(token, crypto.SecretAAD("owners", owner.ID.String(), "nezha_api_token"))
			if err != nil {
				return nil, fmt.Errorf("failed to decrypt Nezha token: %w", err)
			}
			token = decrypted
		}
		return NewNezhaDataSource(owner.NezhaAPIEndpoint, token), nil

	case auth.MonitorDataSourceKomari:
		if owner.KomariAPIEndpoint == "" {
			return nil, fmt.Errorf("Komari endpoint is required")
		}
		// 解密 token
		token := owner.KomariAPIToken
		if token != "" {
			if f.encryptor == nil {
				return nil, fmt.Errorf("monitor credential encryption is unavailable")
			}
			decrypted, err := f.encryptor.DecryptSecret(token, crypto.SecretAAD("owners", owner.ID.String(), "komari_api_token"))
			if err != nil {
				return nil, fmt.Errorf("failed to decrypt Komari token: %w", err)
			}
			token = decrypted
		}
		return NewKomariDataSource(owner.KomariAPIEndpoint, token), nil

	default:
		return nil, fmt.Errorf("unsupported data source type: %s", owner.MonitorDataSource)
	}
}

// CreateDataSourceFromConfig 根据配置创建数据源（用于测试连接等场景）
func (f *DataSourceFactory) CreateDataSourceFromConfig(config *DataSourceConfig, owner *auth.Owner) (DataSourceProvider, error) {
	switch config.Type {
	case "easyssh", "":
		return NewEasySSHDataSource(f.serverService, f.encryptor, owner.ID, f.hostKeyCallback), nil

	case "nezha":
		if config.Endpoint == "" {
			return nil, fmt.Errorf("Nezha endpoint is required")
		}
		return NewNezhaDataSource(config.Endpoint, config.Token), nil

	case "komari":
		if config.Endpoint == "" {
			return nil, fmt.Errorf("Komari endpoint is required")
		}
		return NewKomariDataSource(config.Endpoint, config.Token), nil

	default:
		return nil, fmt.Errorf("unsupported data source type: %s", config.Type)
	}
}
