package monitoring

import (
	"context"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sshutil"
)

// Service 监控服务接口
type Service interface {
	// GetAllServersResourcesWithOwner 使用指定所有者配置获取所有服务器的资源概览
	GetAllServersResourcesWithOwner(ctx context.Context, owner *auth.Owner) (*AllServersResources, error)
	// TestDataSourceConnection 测试数据源连接
	TestDataSourceConnection(ctx context.Context, config *DataSourceConfig, owner *auth.Owner) error
}

// service 监控服务实现
type service struct {
	dataSourceFactory *DataSourceFactory
}

// NewService 创建监控服务
func NewService(serverService server.Service, encryptor *crypto.Encryptor, hostKeyCallback sshutil.HostKeyPolicy) Service {
	return &service{
		dataSourceFactory: NewDataSourceFactory(serverService, encryptor, hostKeyCallback),
	}
}

// GetAllServersResourcesWithOwner 使用指定所有者配置获取所有服务器的资源概览
func (s *service) GetAllServersResourcesWithOwner(ctx context.Context, owner *auth.Owner) (*AllServersResources, error) {
	scope := access.Current(ctx)
	if owner == nil || scope.Actor().ID != owner.ID.String() {
		return nil, access.ErrForbidden
	}
	if err := scope.RequireOwner(ctx, protocol.WorkspaceRead); err != nil {
		return nil, err
	}
	// 根据所有者配置创建数据源
	dataSource, err := s.dataSourceFactory.CreateDataSource(owner)
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
func (s *service) TestDataSourceConnection(ctx context.Context, config *DataSourceConfig, owner *auth.Owner) error {
	scope := access.Current(ctx)
	if owner == nil || scope.Actor().ID != owner.ID.String() {
		return access.ErrForbidden
	}
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	// 根据配置创建数据源
	dataSource, err := s.dataSourceFactory.CreateDataSourceFromConfig(config, owner)
	if err != nil {
		return fmt.Errorf("failed to create data source: %w", err)
	}

	// 测试连接
	return dataSource.TestConnection(ctx)
}
