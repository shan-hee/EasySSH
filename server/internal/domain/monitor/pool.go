package monitor

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"log"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/server"
	sshDomain "github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
)

// PooledConnection 池化的监控连接
type PooledConnection struct {
	Revision   int64
	Client     *sshDomain.Client // SSH 客户端
	RefCount   int               // 引用计数（多少个监控 WebSocket 在使用）
	ServerID   string            // 服务器 ID
	Actor      protocol.Actor    // 已认证发起主体
	key        string
	CreatedAt  time.Time    // 创建时间
	LastUsedAt time.Time    // 最后使用时间
	mu         sync.RWMutex // 连接级别的锁
}

// IncRef 增加引用计数
func (pc *PooledConnection) IncRef() {
	pc.mu.Lock()
	defer pc.mu.Unlock()
	pc.RefCount++
	pc.LastUsedAt = time.Now()
}

// DecRef 减少引用计数，返回新的引用计数
func (pc *PooledConnection) DecRef() int {
	pc.mu.Lock()
	defer pc.mu.Unlock()
	pc.RefCount--
	if pc.RefCount < 0 {
		pc.RefCount = 0
	}
	pc.LastUsedAt = time.Now()
	return pc.RefCount
}

// GetRefCount 获取当前引用计数
func (pc *PooledConnection) GetRefCount() int {
	pc.mu.RLock()
	defer pc.mu.RUnlock()
	return pc.RefCount
}

// IsHealthy 检查连接是否健康
func (pc *PooledConnection) IsHealthy() bool {
	pc.mu.RLock()
	defer pc.mu.RUnlock()

	if pc.Client == nil {
		return false
	}

	// 检查连接是否活跃
	return pc.Client.IsConnected()
}

// ConnectionPool 监控专用连接池
type ConnectionPool struct {
	connections       map[string]*PooledConnection // key: actor kind/session/resource
	mu                sync.RWMutex
	serverService     server.Service // 服务器服务，用于获取服务器配置
	encryptor         *crypto.Encryptor
	connectionTimeout time.Duration // 连接超时时间
	hostKeyCallback   sshutil.HostKeyPolicy
}

// NewConnectionPool 创建监控连接池
func NewConnectionPool(serverService server.Service, encryptor *crypto.Encryptor, hostKeyCallback sshutil.HostKeyPolicy) *ConnectionPool {
	return &ConnectionPool{
		connections:       make(map[string]*PooledConnection),
		serverService:     serverService,
		encryptor:         encryptor,
		connectionTimeout: 30 * time.Second, // 默认30秒超时
		hostKeyCallback:   hostKeyCallback,
	}
}

// SetConnectionTimeout 设置连接超时时间
func (p *ConnectionPool) SetConnectionTimeout(timeout time.Duration) {
	p.connectionTimeout = timeout
}

// GetOrCreate authorizes every borrow, including an existing transport. Transports
// are isolated by authenticated session so revocation cannot inherit another login.
func (p *ConnectionPool) GetOrCreate(ctx context.Context, serverID string, action protocol.Action) (*PooledConnection, error) {
	scope, err := access.FromContext(ctx)
	if err != nil {
		return nil, err
	}
	switch action {
	case protocol.MonitorRead, protocol.DockerRead, protocol.DockerManage:
	default:
		return nil, access.ErrForbidden
	}
	requirement := access.Requirement{Action: action, ServerID: serverID}
	if err := scope.Check(ctx, requirement); err != nil {
		return nil, err
	}
	serverUUID, err := uuid.Parse(serverID)
	if err != nil {
		return nil, err
	}
	srv, err := p.serverService.GetByID(ctx, scope, serverUUID)
	if err != nil {
		return nil, err
	}
	key := string(scope.Actor().Kind) + ":" + scope.Actor().SessionID + ":" + serverID
	p.mu.Lock()
	existing := p.connections[key]
	if existing != nil && existing.Revision == srv.ConnectionRevision && existing.IsHealthy() {
		existing.IncRef()
		p.mu.Unlock()
		return existing, nil
	}
	if existing != nil {
		delete(p.connections, key)
	}
	p.mu.Unlock()
	if existing != nil {
		_ = existing.Client.Close()
	}
	client, err := sshDomain.NewClient(ctx, srv, p.encryptor, p.hostKeyCallback)
	if err != nil {
		return nil, err
	}
	dialCtx, cancel := context.WithTimeout(ctx, p.connectionTimeout)
	defer cancel()
	if err := client.ConnectContext(dialCtx, srv.Host, srv.Port); err != nil {
		_ = client.Close()
		return nil, err
	}
	if err := scope.Check(ctx, requirement); err != nil {
		_ = client.Close()
		return nil, err
	}
	current, err := p.serverService.GetByID(ctx, scope, serverUUID)
	if err != nil || current.ConnectionRevision != srv.ConnectionRevision || current.CredentialDigest() != srv.CredentialDigest() {
		_ = client.Close()
		return nil, access.ErrResourceChanged
	}
	created := &PooledConnection{Client: client, Revision: srv.ConnectionRevision, RefCount: 1, ServerID: serverID, Actor: scope.Actor(), key: key, CreatedAt: time.Now(), LastUsedAt: time.Now()}
	p.mu.Lock()
	if existing = p.connections[key]; existing != nil && existing.Revision == srv.ConnectionRevision && existing.IsHealthy() {
		existing.IncRef()
		p.mu.Unlock()
		_ = client.Close()
		return existing, nil
	}
	displaced := p.connections[key]
	p.connections[key] = created
	p.mu.Unlock()
	if displaced != nil {
		_ = displaced.Client.Close()
	}
	return created, nil
}

// Release operates on the borrowed transport, never an untrusted identity/key.
func (p *ConnectionPool) Release(conn *PooledConnection) {
	if conn == nil {
		return
	}
	p.mu.Lock()
	closeClient := conn.DecRef() == 0
	if closeClient && p.connections[conn.key] == conn {
		delete(p.connections, conn.key)
	}
	p.mu.Unlock()
	if closeClient {
		_ = conn.Client.Close()
	}
}

// ForceClose removes all sessions belonging to the affected owner/resource.
func (p *ConnectionPool) ForceClose(ownerID, serverID string) error {
	p.mu.Lock()
	var matches []*PooledConnection
	for key, conn := range p.connections {
		if conn.Actor.Kind == protocol.Owner && conn.Actor.ID == ownerID && conn.ServerID == serverID {
			matches = append(matches, conn)
			delete(p.connections, key)
		}
	}
	p.mu.Unlock()
	for _, conn := range matches {
		_ = conn.Client.Close()
	}
	return nil
}

// GetStats 获取连接池统计信息
func (p *ConnectionPool) GetStats() map[string]interface{} {
	p.mu.RLock()
	defer p.mu.RUnlock()

	totalConnections := len(p.connections)
	activeConnections := 0
	idleConnections := 0

	for _, conn := range p.connections {
		if conn.GetRefCount() > 0 {
			activeConnections++
		} else {
			idleConnections++
		}
	}

	return map[string]interface{}{
		"total_connections":  totalConnections,
		"active_connections": activeConnections,
		"idle_connections":   idleConnections,
	}
}

// GetAllConnections 获取所有连接信息（用于调试）
func (p *ConnectionPool) GetAllConnections() []map[string]interface{} {
	p.mu.RLock()
	defer p.mu.RUnlock()

	result := make([]map[string]interface{}, 0, len(p.connections))
	for key, conn := range p.connections {
		result = append(result, map[string]interface{}{
			"key":          key,
			"server_id":    conn.ServerID,
			"actor":        conn.Actor,
			"ref_count":    conn.GetRefCount(),
			"created_at":   conn.CreatedAt,
			"last_used_at": conn.LastUsedAt,
			"is_healthy":   conn.IsHealthy(),
		})
	}

	return result
}

// Close 关闭连接池（关闭所有连接）
func (p *ConnectionPool) Close() {
	log.Println("[ConnectionPool] 关闭连接池")

	p.mu.Lock()
	defer p.mu.Unlock()

	// 关闭所有连接
	for key, conn := range p.connections {
		log.Printf("[ConnectionPool] 关闭连接: key=%s", key)
		if conn.Client != nil {
			conn.Client.Close()
		}
	}

	// 清空连接池
	p.connections = make(map[string]*PooledConnection)
}
