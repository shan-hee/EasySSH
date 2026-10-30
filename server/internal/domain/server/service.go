package server

import (
	"context"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/servertag"
	"log/slog"
	"net"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/sshkey"
	"github.com/easyssh/server/internal/pkg/geoip"
	"github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
)

// Service 服务器服务接口
type Service interface {
	// Create 创建服务器
	Create(ctx context.Context, scope access.Scope, req *protocol.ServerCreate) (*Server, error)

	// GetByID 根据 ID 获取服务器
	GetByID(ctx context.Context, scope access.Scope, serverID uuid.UUID) (*Server, error)

	// List 获取用户的服务器列表
	List(ctx context.Context, scope access.Scope, limit, offset int) ([]*Server, int64, error)

	// Update 更新服务器信息
	Update(ctx context.Context, scope access.Scope, serverID uuid.UUID, req *protocol.ServerUpdate) (*Server, error)

	// Delete 删除服务器
	Delete(ctx context.Context, scope access.Scope, serverID uuid.UUID) error

	// Search 搜索服务器
	Search(ctx context.Context, scope access.Scope, query, group, tag string, limit, offset int) ([]*Server, int64, error)

	// FindByGroup 根据分组查找服务器
	FindByGroup(ctx context.Context, scope access.Scope, group string, limit, offset int) ([]*Server, int64, error)

	// GetStatistics 获取统计信息
	GetStatistics(ctx context.Context, scope access.Scope) (*protocol.ServerStatistics, error)

	// ReorderServers 批量更新服务器排序顺序
	ReorderServers(ctx context.Context, scope access.Scope, serverIDs []uuid.UUID) error
}

// serverService 服务器服务实现
type serverService struct {
	repo        Repository
	encryptor   *crypto.Encryptor
	geoipClient *geoip.Client
	keys        sshkey.Service
}

// NewService 创建服务器服务
func NewService(repo Repository, encryptor *crypto.Encryptor, geoipClient *geoip.Client, keys sshkey.Service) Service {
	return &serverService{
		repo:        repo,
		encryptor:   encryptor,
		geoipClient: geoipClient,
		keys:        keys,
	}
}

func (s *serverService) Create(ctx context.Context, scope access.Scope, req *protocol.ServerCreate) (*Server, error) {
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return nil, err
	}
	// 参数验证
	if req == nil {
		return nil, ErrInvalidServer
	}
	req.Host = sshutil.NormalizeHost(req.Host)
	if req.Host == "" || req.Username == "" {
		return nil, fmt.Errorf("%w: host and username are required", ErrInvalidServer)
	}

	if req.Port == 0 {
		req.Port = 22
	}

	if !AuthMethod(req.AuthMethod).IsValid() {
		return nil, fmt.Errorf("%w: unsupported auth method", ErrInvalidServer)
	}

	if err := validateServerFields(req.Name, req.Host, req.Port, req.Username, req.Description); err != nil {
		return nil, err
	}
	if len(req.Password) > 4096 || len(req.PrivateKey) > 1<<20 || len(req.PrivateKeyPassphrase) > 4096 {
		return nil, ErrInvalidServer
	}
	tags, err := servertag.Normalize(req.Tags)
	if err != nil {
		return nil, err
	}
	// 创建服务器
	server := &Server{
		ID:          uuid.New(),
		Name:        req.Name,
		Host:        req.Host,
		Port:        req.Port,
		Username:    req.Username,
		Auth:        ServerAuth{AuthMethod: AuthMethod(req.AuthMethod)},
		Tags:        tags,
		Description: req.Description,
		Status:      StatusOffline, // 新建服务器默认为离线状态
	}

	if req.GroupID != "" {
		id, err := uuid.Parse(req.GroupID)
		if err != nil || id == uuid.Nil || id.String() != req.GroupID {
			return nil, ErrInvalidGroup
		}
		server.GroupID = &id
	}

	// 加密密码
	if req.Password != "" {
		encrypted, err := s.encryptor.EncryptWithAAD(req.Password, server.CredentialAAD("password"))
		if err != nil {
			return nil, fmt.Errorf("failed to encrypt password: %w", err)
		}
		server.Auth.Password = encrypted
	}

	if err := s.assignKey(ctx, scope, server, req.SSHKeyID, &req.PrivateKey, req.PrivateKeyPassphrase); err != nil {
		return nil, err
	}

	// 查询 IP 地理位置；查询失败不影响创建。
	s.updateServerLocation(ctx, server)

	// 保存到数据库
	if err := s.repo.Create(access.WithScope(ctx, scope), server); err != nil {
		return nil, err
	}

	server.executionScope = scope
	return server, nil
}

func (s *serverService) GetByID(ctx context.Context, scope access.Scope, serverID uuid.UUID) (*Server, error) {
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead, ServerID: serverID.String()}); err != nil {
		return nil, err
	}
	row, err := s.repo.FindByID(ctx, serverID)
	if err != nil {
		return nil, err
	}
	row.executionScope = scope
	return row, nil
}

func (s *serverService) List(ctx context.Context, scope access.Scope, limit, offset int) ([]*Server, int64, error) {
	return s.query(ctx, scope, Query{}, limit, offset)
}

func (s *serverService) Update(ctx context.Context, scope access.Scope, serverID uuid.UUID, req *protocol.ServerUpdate) (*Server, error) {
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return nil, err
	}
	if req == nil {
		return nil, ErrInvalidServer
	}
	if req.Password != nil && len(*req.Password) > 4096 || req.PrivateKey != nil && len(*req.PrivateKey) > 1<<20 || len(req.PrivateKeyPassphrase) > 4096 {
		return nil, ErrInvalidServer
	}
	// 查找服务器并验证权限
	server, err := s.repo.FindByID(ctx, serverID)
	if err != nil {
		return nil, err
	}

	if req.Host != nil {
		normalized := sshutil.NormalizeHost(*req.Host)
		req.Host = &normalized
	}
	hostChanged := req.Host != nil && *req.Host != server.Host
	endpointConfigChanged :=
		hostChanged ||
			(req.Port != nil && *req.Port != server.Port) ||
			(req.Username != nil && *req.Username != server.Username)
	authConfigChanged :=
		(req.AuthMethod != nil && AuthMethod(*req.AuthMethod) != server.Auth.AuthMethod) ||
			req.Password != nil ||
			req.PrivateKey != nil || req.SSHKeyID != nil

	// 更新字段
	if req.Name != nil {
		server.Name = *req.Name
	}
	if req.Host != nil {
		server.Host = *req.Host
	}
	if req.Port != nil {
		server.Port = *req.Port
	}
	if req.Username != nil {
		server.Username = *req.Username
	}
	if req.AuthMethod != nil {
		if !AuthMethod(*req.AuthMethod).IsValid() {
			return nil, fmt.Errorf("%w: unsupported auth method", ErrInvalidServer)
		}
		server.Auth.AuthMethod = AuthMethod(*req.AuthMethod)
	}
	if req.GroupID != nil {
		server.GroupID = nil
		if *req.GroupID != "" {
			id, err := uuid.Parse(*req.GroupID)
			if err != nil || id == uuid.Nil || id.String() != *req.GroupID {
				return nil, ErrInvalidGroup
			}
			server.GroupID = &id
		}
	}
	if req.Tags != nil {
		server.Tags, err = servertag.Normalize(*req.Tags)
		if err != nil {
			return nil, err
		}
	}
	if req.Description != nil {
		server.Description = *req.Description
	}

	if err := validateServerFields(server.Name, server.Host, server.Port, server.Username, server.Description); err != nil {
		return nil, err
	}
	// 更新密码
	if req.Password != nil {
		previous, err := s.encryptor.DecryptSecret(server.Auth.Password, server.CredentialAAD("password"))
		if err != nil {
			return nil, fmt.Errorf("failed to read existing password: %w", err)
		}
		if previous != *req.Password {
			encrypted, err := s.encryptor.EncryptSecret(*req.Password, server.CredentialAAD("password"))
			if err != nil {
				return nil, fmt.Errorf("failed to encrypt password: %w", err)
			}
			server.Auth.Password = encrypted
		}
	}

	if err := s.assignKey(ctx, scope, server, req.SSHKeyID, req.PrivateKey, req.PrivateKeyPassphrase); err != nil {
		return nil, err
	}

	// 主机改变后旧位置即失效；普通编辑不重复消耗在线查询额度。
	if hostChanged {
		server.Country = ""
		server.CountryCode = ""
		server.Region = ""
		server.City = ""
	}
	if hostChanged || server.CountryCode == "" {
		s.updateServerLocation(ctx, server)
	}

	if endpointConfigChanged || (authConfigChanged && !req.VerifiedConnectionCredential) {
		server.Status = StatusOffline
	}
	if endpointConfigChanged || authConfigChanged {
		server.OS = ""
	}

	// 保存更新
	if err := s.repo.Update(access.WithScope(ctx, scope), server); err != nil {
		return nil, err
	}

	server.executionScope = scope
	return server, nil
}

func (s *serverService) Delete(ctx context.Context, scope access.Scope, serverID uuid.UUID) error {
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	// 验证权限
	if _, err := s.repo.FindByID(ctx, serverID); err != nil {
		return err
	}

	return s.repo.Delete(access.WithScope(ctx, scope), serverID)
}

func (s *serverService) Search(ctx context.Context, scope access.Scope, query, group, tag string, limit, offset int) ([]*Server, int64, error) {
	if tag != "" {
		normalized, err := servertag.Normalize([]string{tag})
		if err != nil {
			return nil, 0, err
		}
		tag = normalized[0]
	}
	return s.query(ctx, scope, Query{Search: query, GroupID: group, Tag: tag}, limit, offset)
}

func (s *serverService) FindByGroup(ctx context.Context, scope access.Scope, group string, limit, offset int) ([]*Server, int64, error) {
	return s.query(ctx, scope, Query{GroupID: group}, limit, offset)
}

func (s *serverService) GetStatistics(ctx context.Context, scope access.Scope) (*protocol.ServerStatistics, error) {
	ids, err := scope.ServerIDs(ctx)
	if err != nil {
		return nil, err
	}
	return s.repo.GetStatistics(ctx, Query{ServerIDs: ids})
}

// ReorderServers 批量更新服务器排序顺序
// serverIDs: 按照新顺序排列的服务器 ID 数组
func (s *serverService) ReorderServers(ctx context.Context, scope access.Scope, serverIDs []uuid.UUID) error {
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	if len(serverIDs) == 0 || len(serverIDs) > 10000 {
		return ErrInvalidServer
	}
	seen := make(map[uuid.UUID]bool, len(serverIDs))
	for _, id := range serverIDs {
		if id == uuid.Nil || seen[id] {
			return ErrInvalidServer
		}
		seen[id] = true
	}

	return s.repo.Reorder(access.WithScope(ctx, scope), serverIDs)
}

// Helper function to check TCP connectivity
func checkTCPConnection(host string, port int, timeout time.Duration) error {
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return err
	}
	defer conn.Close()
	return nil
}

// updateServerLocation 查询并更新服务器的地理位置信息
func (s *serverService) updateServerLocation(ctx context.Context, server *Server) {
	loc, err := s.geoipClient.Lookup(ctx, server.Host)
	if err != nil {
		slog.WarnContext(ctx, "failed to look up server location", "server_id", server.ID, "error", err)
		return
	}

	server.Country = loc.Country
	server.CountryCode = loc.CountryCode
	server.Region = loc.Region
	server.City = loc.City
}

// Private key material is an import command, never a field of a saved connection.
func (s *serverService) assignKey(ctx context.Context, scope access.Scope, srv *Server, keyID *uuid.UUID, material *string, passphrase string) error {
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	if !srv.Auth.AuthMethod.RequiresPrivateKey() {
		srv.Auth.SSHKeyID = nil
		srv.Auth.SSHKey = nil
		return nil
	}
	if keyID != nil && material != nil && *material != "" {
		return fmt.Errorf("%w: choose a saved SSH key or import a key, not both", ErrInvalidServer)
	}
	if keyID != nil {
		if *keyID == uuid.Nil {
			srv.Auth.SSHKeyID = nil
			srv.Auth.SSHKey = nil
			return nil
		}
		key, err := s.keys.GetKey(ctx, scope, *keyID)
		if err != nil {
			return fmt.Errorf("SSH key is not available to this user: %w", err)
		}
		srv.Auth.SSHKeyID, srv.Auth.SSHKey = &key.ID, key
		return nil
	}
	if material == nil {
		return nil
	}
	if *material == "" {
		srv.Auth.SSHKeyID = nil
		srv.Auth.SSHKey = nil
		return nil
	}
	key, err := s.keys.ImportKeyPair(ctx, scope, &protocol.SSHKeyImportInput{Name: srv.Host, PrivateKey: *material, Passphrase: passphrase})
	if err != nil {
		return err
	}
	srv.Auth.SSHKeyID = &key.ID
	srv.Auth.SSHKey, err = s.keys.GetKey(ctx, scope, key.ID)
	return err
}

func (s *serverService) query(ctx context.Context, scope access.Scope, filter Query, limit, offset int) ([]*Server, int64, error) {
	if filter.GroupID != "" {
		id, err := uuid.Parse(filter.GroupID)
		if err != nil || id == uuid.Nil || id.String() != filter.GroupID {
			return nil, 0, ErrInvalidGroup
		}
	}

	ids, err := scope.ServerIDs(ctx)
	if err != nil {
		return nil, 0, err
	}
	filter.ServerIDs = ids
	rows, total, err := s.repo.Query(ctx, filter, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	for _, row := range rows {
		row.executionScope = scope
	}
	return rows, total, nil
}

func validateServerFields(name, host string, port int, username, description string) error {
	if strings.TrimSpace(host) == "" || strings.IndexAny(host, " \t\r\n\x00") >= 0 || utf8.RuneCountInString(host) > 255 ||
		strings.TrimSpace(username) == "" || utf8.RuneCountInString(username) > 50 || strings.ContainsRune(username, 0) ||
		port < 1 || port > 65535 || utf8.RuneCountInString(name) > 100 || strings.ContainsRune(name, 0) ||
		utf8.RuneCountInString(description) > 10000 || strings.ContainsRune(description, 0) {
		return ErrInvalidServer
	}
	return nil
}
