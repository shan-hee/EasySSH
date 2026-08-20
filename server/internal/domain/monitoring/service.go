package monitoring

import (
	"context"
	"fmt"
	"time"

	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/pkg/crypto"
	"golang.org/x/crypto/ssh"
)

// Service 监控服务接口
type Service interface {
	// GetAllServersResourcesWithUser 使用指定用户配置获取所有服务器的资源概览
	GetAllServersResourcesWithUser(ctx context.Context, user *auth.User) (*AllServersResources, error)
	// TestDataSourceConnection 测试数据源连接
	TestDataSourceConnection(ctx context.Context, config *DataSourceConfig, user *auth.User) error
}

// service 监控服务实现
type service struct {
	dataSourceFactory *DataSourceFactory
}

// NewService 创建监控服务
func NewService(serverService server.Service, encryptor *crypto.Encryptor, hostKeyCallback ssh.HostKeyCallback) Service {
	return &service{
		dataSourceFactory: NewDataSourceFactory(serverService, encryptor, hostKeyCallback),
	}
}

// GetAllServersResourcesWithUser 使用指定用户配置获取所有服务器的资源概览
func (s *service) GetAllServersResourcesWithUser(ctx context.Context, user *auth.User) (*AllServersResources, error) {
	// 根据用户配置创建数据源
	dataSource, err := s.dataSourceFactory.CreateDataSource(user)
	if err != nil {
		return nil, fmt.Errorf("failed to create data source: %w", err)
	}

	// 使用数据源获取资源
	summaries, err := dataSource.GetServersResources(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get servers resources from %s: %w", dataSource.Name(), err)
	}

	return &AllServersResources{
		Servers:     summaries,
		CollectedAt: time.Now(),
	}, nil
}

// TestDataSourceConnection 测试数据源连接
func (s *service) TestDataSourceConnection(ctx context.Context, config *DataSourceConfig, user *auth.User) error {
	// 根据配置创建数据源
	dataSource, err := s.dataSourceFactory.CreateDataSourceFromConfig(config, user)
	if err != nil {
		return fmt.Errorf("failed to create data source: %w", err)
	}

	// 测试连接
	return dataSource.TestConnection(ctx)
}
