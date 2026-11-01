# EasySSH 后端服务

EasySSH 后端采用 Go，提供 SSH/SFTP、服务器管理、任务执行、监控和审计。Web 工作台支持 noVNC 和可选 guacd 网关的 RDP，外部 Agent 可通过 MCP 或 REST 使用受限访问令牌。

访问令牌、MCP 客户端配置、VNC 要求以及生产数据库升级/回退流程见 [MCP、访问令牌与远程桌面](../docs/automation-vnc.md)。API 契约以 [OpenAPI](../contracts/http/openapi.yaml) 为准。

## 🚀 快速开始

### 1. 环境要求

- Go 1.26.10+（以 `go.mod` 为准）
- 默认 SQLite，无需单独数据库服务
- 可选 PostgreSQL 12+ 或 MySQL 8+

### 2. 配置环境

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置文件
vim .env
```

默认 SQLite 单实例没有必需环境变量。以下值均已有默认值，仅在切换数据库或显式管理根密钥时填写：
```env
DB_DRIVER=sqlite
DB_DSN=./data/easyssh.db

# 可选显式部署根密钥；单实例留空会写入数据目录/easyssh-root.key
# ENCRYPTION_KEY=$(openssl rand -base64 32)
```

### 3. 安装依赖

```bash
go mod download
```

### 4. 运行服务

```bash
# 开发模式
go run ./cmd/api

# 或使用 air 热重载（需安装 air）
air
```

服务将在 `http://localhost:8520` 启动

### 5. 验证运行

```bash
curl http://localhost:8520/api/v1/health
```

预期响应：
```json
{
  "status": "ok",
  "service": "easyssh-api",
  "version": "1.0.0",
  "dependencies": {
    "database": "ok"
  }
}
```

---

## 🏗️ 项目结构

```
server/
├── cmd/
│   └── api/
│       └── main.go              # 应用入口
├── internal/
│   ├── api/                     # API 层
│   │   ├── middleware/          # 中间件
│   │   │   ├── auth.go          # Owner/访客身份认证
│   │   │   ├── audit.go         # 审计日志
│   │   │   ├── cors.go          # CORS
│   │   │   ├── logger.go        # 日志
│   │   │   ├── recovery.go      # 错误恢复
│   │   │   └── request_id.go    # 请求 ID
│   │   ├── rest/                # REST API 处理器
│   │   │   ├── auth.go          # 认证 API
│   │   │   ├── server.go        # 服务器管理
│   │   │   ├── ssh.go           # SSH 会话
│   │   │   ├── sftp.go          # SFTP 文件
│   │   │   ├── monitoring.go    # 监控
│   │   │   └── auditlog.go      # 审计日志
│   │   └── ws/                  # WebSocket
│   │       └── terminal.go      # SSH 终端
│   ├── domain/                  # 领域层（业务逻辑）
│   │   ├── auth/                # 认证域
│   │   │   ├── model.go         # 用户模型
│   │   │   ├── repository.go    # 数据访问
│   │   │   ├── service.go       # 业务逻辑
│   │   │   └── service.go       # 登录与用户会话服务
│   │   ├── server/              # 服务器域
│   │   ├── ssh/                 # SSH 域
│   │   ├── sftp/                # SFTP 域
│   │   ├── monitoring/          # 监控域
│   │   └── auditlog/            # 审计日志域
│   ├── infra/                   # 基础设施层
│   │   ├── config/              # 配置管理
│   │   └── db/                  # 数据库
│   └── pkg/                     # 公共包
│       └── crypto/              # 加密工具
├── .env.example                 # 环境变量示例
├── go.mod                       # Go 依赖
└── README.md                    # 本文件
```

---

## 🎯 API 端点

### 认证与授权
- `POST /api/v1/owner/initialize` - 初始化所有者
- `POST /api/v1/owner/login` - 所有者登录
- `POST /api/v1/owner/logout` - 撤销当前登录会话
- `GET /api/v1/owner/profile` - 当前所有者资料
- `/api/v1/grants` - 所有者管理资源授权
- `GET/POST /api/v1/access-tokens`、`DELETE /api/v1/access-tokens/:id` - 令牌列表、签发与撤销
- `POST /api/v1/mcp` - 使用自动化 Bearer 令牌调用 MCP Streamable HTTP
- `POST /api/v1/automation/tools/:name` - 调用与 MCP 相同的业务工具
- `GET/PUT /api/v1/vnc/:server_id/config` - VNC 配置；修改仅限所有者
- `GET /api/v1/vnc/:server_id/ws` - 绑定逻辑连接的一次性票据认证，代理 VNC 数据

### 服务器管理 (7 个)
- `GET /api/v1/servers` - 服务器列表
- `POST /api/v1/servers` - 创建服务器
- `GET /api/v1/servers/:id` - 服务器详情
- `PUT /api/v1/servers/:id` - 更新服务器
- `DELETE /api/v1/servers/:id` - 删除服务器
- `POST /api/v1/servers/:id/test` - 测试连接
- `GET /api/v1/servers/statistics` - 统计信息

### SSH 终端 (4 个)
- `WS /ws/terminal/:server_id` - WebSocket 终端连接
- `GET /api/v1/ssh/sessions` - 会话列表
- `GET /api/v1/ssh/sessions/:id` - 会话详情
- `DELETE /api/v1/ssh/sessions/:id` - 关闭会话

### SFTP 文件 (12 个)
- `GET /api/v1/sftp/:server_id/list` - 列出目录
- `GET /api/v1/sftp/:server_id/stat` - 文件信息
- `POST /api/v1/sftp/:server_id/upload` - 上传文件
- `GET /api/v1/sftp/:server_id/download` - 下载文件
- `POST /api/v1/sftp/:server_id/mkdir` - 创建目录
- `DELETE /api/v1/sftp/:server_id/delete` - 删除文件/目录
- `POST /api/v1/sftp/:server_id/rename` - 重命名
- `POST /api/v1/sftp/:server_id/move` - 移动
- `POST /api/v1/sftp/:server_id/copy` - 复制
- `GET /api/v1/sftp/:server_id/read` - 读取文件
- `POST /api/v1/sftp/:server_id/write` - 写入文件
- `GET /api/v1/sftp/:server_id/disk-usage` - 磁盘使用

### 系统监控 (6 个)
- `GET /api/v1/monitoring/:server_id/system` - 系统综合信息
- `GET /api/v1/monitoring/:server_id/cpu` - CPU 信息
- `GET /api/v1/monitoring/:server_id/memory` - 内存信息
- `GET /api/v1/monitoring/:server_id/disk` - 磁盘信息
- `GET /api/v1/monitoring/:server_id/network` - 网络信息
- `GET /api/v1/monitoring/:server_id/processes` - 进程列表

### 日志与操作记录
- `GET /api/v1/logs` - 活动日志/安全审计统一列表
- `GET /api/v1/logs/statistics` - 日志统计
- `GET /api/v1/logs/:id` - 日志详情
- `DELETE /api/v1/logs/cleanup` - 清理旧日志（需要 `audit:manage`）
- `GET /api/v1/operation-records` - 历史连接、传输、执行统一操作记录
- `GET /api/v1/operation-records/statistics` - 操作记录统计
- `GET /api/v1/operation-records/:id` - 操作记录详情

---

## 📚 技术栈

### 核心框架
- **Web 框架**: Gin v1.12.0
- **ORM**: GORM v1.30.0
- **数据库**: SQLite（默认）、PostgreSQL、MySQL

### 认证与安全
- **身份与授权**: Owner 会话、Grant 资源授权及独立自动化令牌
- **MCP**: 官方 Go SDK，Streamable HTTP
- **密码加密**: bcrypt (golang.org/x/crypto)
- **凭证加密**: AES-256-GCM

### 后台任务
- **调度**: robfig/cron 负责计算触发时间，任务执行统一写入 `job_queue`
- **持久化队列**: SQLite 使用原子条件更新抢占；PostgreSQL/MySQL 使用 `FOR UPDATE SKIP LOCKED`
- **可靠执行**: Worker Lease、心跳、过期租约回收、指数退避重试和多实例计划任务去重

### SSH/SFTP
- **SSH 客户端**: golang.org/x/crypto/ssh
- **SFTP**: github.com/pkg/sftp v1.13.6
- **WebSocket**: github.com/gorilla/websocket v1.5.3

### 其他
- **UUID**: github.com/google/uuid v1.6.0

---

## 🔒 安全特性

### 数据加密
- ✅ **密码**: bcrypt 哈希（成本因子 12）
- ✅ **服务器凭证**: AES-256-GCM 加密存储
- ✅ **传输**: 支持 HTTPS（生产环境）

### 认证授权
- **所有者会话**：管理配置、授权和凭据；浏览器使用会话 Cookie 与 CSRF 防护。
- **访客授权**：按服务器、操作和脚本范围检查 Grant，支持过期、撤销与目标变更确认。
- **自动化令牌**：绑定 Grant，仅保存哈希，原文签发时返回一次；通过 `Authorization: Bearer ess_api_...` 使用，不具有所有者管理权限。
- **运行时权限**：REST、MCP 与连接复用服务端 Scope 和工作租约；撤销可中断关联工作。
- **WebSocket**：短期一次性票据绑定身份、服务器及逻辑连接；VNC 使用独立的 `vnc.connect` 权限。

### 审计追踪
- ✅ 记录所有关键操作（登录、SSH 连接、文件操作等）
- ✅ 包含用户、时间、IP、User-Agent、错误信息
- ✅ 支持多维度查询和统计分析

---

## 🛠️ 开发

### 编译

```bash
# 开发模式（带调试信息）
go build -o easyssh-server ./cmd/api

# 生产模式（优化编译）
go build -ldflags="-s -w" -o easyssh-server ./cmd/api
```

### 测试

同步集成测试会启动真实的 Automerge worker，需安装 Node.js 22+。

```bash
# 安装同步测试运行时依赖（首次检出或依赖更新后执行，使用仓库根 pnpm 工作区）
make sync-deps

# 运行所有测试
go test ./...

# 运行特定包的测试
go test ./internal/domain/auth

# 查看测试覆盖率
go test -cover ./...

# 生成覆盖率报告
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

### 代码检查

```bash
# 格式化代码
go fmt ./...

# 代码检查
go vet ./...

# 使用 golangci-lint（需先安装）
golangci-lint run
```

---

## 📝 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 | 必需 |
|--------|------|--------|------|
| `BACKEND_URL` | 后端服务地址；监听端口从这里解析 | http://localhost:8520 | 否 |
| `ENV` | 运行环境 | development | 否 |
| `ENCRYPTION_KEY` | 可选显式部署根密钥（32 字节，Base64）；多实例必须共享 | 自动生成到数据目录 | 否 |
| `DB_DRIVER` | 数据库驱动 | sqlite | 否 |
| `DB_DSN` | 数据库连接串 | ./data/easyssh.db | 否 |
EasySSH 只保留启动自举配置。Cookie、CORS、CSRF、CSP、可信代理、SFTP 连接池、后台任务最大并发、登录会话与安全策略都在“系统设置”维护。后台任务队列按需创建执行协程，空闲时不保留 Worker；最大并发默认 2，保存后立即生效。服务器与登录位置统一通过 HTTPS 调用 `ipwho.is`，无需 API Key 或本地位置库；成功结果缓存 24 小时，单次查询（含 DNS）最多等待 3 秒。免费接口按出口 IP 每天限额 1,000 次，收到 429 后按 `Retry-After` 暂停请求（未提供有效值时暂停 24 小时）；位置查询失败不阻止保存或登录。

未设置 `ENCRYPTION_KEY` 时，服务首次启动会生成权限为 `0600` 的 `easyssh-root.key`。同一数据库由一个 EasySSH 进程独占；备份维护前需停止正常进程。

### 生成加密密钥

```bash
# 多实例部署：生成并安全分发同一把 32 字节部署根密钥
ENCRYPTION_KEY=$(openssl rand -base64 32)
```

---

## 📖 文档

### 完整文档
- [后端开发流程](../docs/后端开发流程.md)
- [后端开发完成总结](../docs/后端开发完成总结.md)
- [项目状态](../PROJECT_STATUS.md)

### Phase 文档
- [Phase 1 - 基础架构](../docs/Phase1-基础架构完成.md)
- [Phase 2 - 用户认证](../docs/Phase2-认证系统完成.md)
- [Phase 3 - 服务器管理](../docs/Phase3-服务器管理完成.md)
- [Phase 4 - SSH 终端](../docs/Phase4-SSH连接终端完成.md)
- [Phase 5 - SFTP 文件](../docs/Phase5-SFTP文件传输完成.md)
- [Phase 6 - 监控日志](../docs/Phase6-监控日志完成.md)

---

## 🐛 已知问题

### 安全提醒
- SSH 主机密钥验证使用 TOFU 记录和校验，主机密钥变更或记录失败会拒绝连接。

### 功能限制
- 监控数据仅返回实时数据，暂不支持历史记录
- WebSocket 会话超时固定为 30 分钟
- 大文件上传暂无断点续传

### 性能优化
- 监控数据需要添加缓存
- 审计日志查询需要更多索引

---

## 🚀 生产部署

### Docker 部署

```bash
# 构建镜像
docker build -t easyssh-server:1.0.0 .

# 运行容器
docker run -d \
  --name easyssh-server \
  -p 8520:8520 \
  -v easyssh-data:/app/data \
  easyssh-server:1.0.0
```

正式镜像默认使用 production + SQLite。外部数据库部署再通过 `-e DB_DRIVER=... -e DB_DSN=...` 覆盖；多实例同时传入相同的 `ENCRYPTION_KEY`。

### 健康检查

```bash
# Docker Compose 配置
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8520/api/v1/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 32m
```

---

## 🤝 贡献

欢迎贡献！请参考主项目的 [README.md](../README.md) 了解贡献指南。

---

## 📄 许可证

Apache License 2.0 - 详见 [LICENSE](../LICENSE)

---

**EasySSH Backend** - 安全、高效的 SSH 管理后端服务 🚀

## Configuration synchronization

The Web **Account settings → Data & sync** page manages authorized desktop devices and concurrent configuration changes. Its sync switch persists a per-account pause flag and blocks subsequent device sync requests while paused; device revocation/logout and existing data remain available. System backup/restore remains in system settings. The sync service uses Automerge 3.5.0, with the same document logic as the Web and desktop JS/WASM clients (`packages/sync-document`). The Go server launches a private Node.js stdio worker on demand; no extra public port is exposed and CGO remains disabled.

Docker includes the runtime automatically. For a source checkout, install Node.js 22+ and pnpm, then run `pnpm install --frozen-lockfile --filter "easyssh-sync-runtime..."` from the repository root (or `make sync-deps` in `server`). `scripts/dev.sh` and `make dev` install the worker dependencies. When deploying the Go executable separately, create a self-contained worker directory with `pnpm --filter easyssh-sync-runtime deploy --prod --legacy <dir>` and point `EASYSSH_SYNC_ENGINE` to the absolute path of `<dir>/engine.mjs`.

Owner-scoped server metadata and scripts form the basic scope. Browser approval can additionally grant server credentials (passwords/private keys), personal AI configuration/API keys and conversation history. Each grant is enforced on the supplementary object/document endpoints. System-shared AI keys, account/device credentials, live terminal state, execution authorization and another owner’s resources are excluded. Device tokens are generated in desktop Go, stored only as SHA-256 hashes on the server, expire in 90 days, and require the owner's current `server:manage` permission for bidirectional sync. The default ordinary-user role lacks this resource permission and must be granted it explicitly; no system backup permission is required. Listing and revoking one's own devices requires only account authentication. Local desktop tokens use the OS credential store-backed encryption already used for SSH credentials.

`sync_states` persists Automerge history per account; `sync_devices` stores revocable device grants; `sync_instance` provides a stable database instance UUID; `sync_authorizations` stores five-minute browser approval requests. `sync_vault_documents` holds reference documents and safe conflict previews; `sync_vault_objects` encrypts immutable payloads and attachments with owner/object-bound associated data. All six tables are excluded from portable backup/restore. Device identity protocol 3 combines the instance UUID with the authenticated user UUID, independently of email or display names. Browser approval uses separate high-entropy approval and polling codes, explicit account/code confirmation and a single-use transactional approval. The desktop polling secret and credential never enter the browser. Requests can be cancelled or denied; revocation invalidates the associated device grant. HTTPS is mandatory outside localhost. Web API changes and restored data are reconciled against the saved document on the next sync request, even if no browser is open. A transaction serializes exchanges, reconciles current database values, applies the merge, and saves the document together. Initial synchronization sends a full document; subsequent requests exchange changes since acknowledged heads. Critical concurrent values are retained for explicit resolution.

Passwords, private keys, personal API keys and conversation bodies stay out of Automerge history and the Node process; the worker sees random version references. Go transports payloads over HTTPS and encrypts sync objects at rest. Existing AI history tables retain their existing storage policy. This is not end-to-end encryption: the configured server can decrypt data. Concurrent conversation snapshots are retained as separate versions; Web and desktop support choosing a version or copying it into a new read-only conversation. Runtime synchronization refuses active/waiting sessions, flushes in-memory idle edits and updates the cached session without replaying historical tools.

Limits: 12 MiB document exchange request bodies; 16 MiB object request bodies with 12 MiB payload values, 8 MiB encoded document history, 10,000 active records, 20,000 total records with deletion markers. Attachments are separate objects, limited to 8 MiB each and 32 MiB decoded total per conversation. Document compaction and payload-history garbage collection are not implemented. Node worker errors are reported in the sync UI; existing SSH and backup features remain available.

## 备份、数据迁移与数据库升级

日常跨端使用设备同步，完整实例使用加密原生数据库备份；通用 JSON 导入导出已移除。数据库结构由 Goose 的编号迁移管理，当前开发重置仅保留 schema 1 初始化；旧实例需重新安装，后续增量迁移从 00002 开始。服务端启动默认创建加密升级恢复点并自动迁移受支持的旧库，成功后才开放业务；可通过 `EASYSSH_AUTO_MIGRATE=off` 关闭，迁移总超时默认 `EASYSSH_MIGRATION_TIMEOUT=30m`。不会自动降级或覆盖数据库。具体命令、数据目录与根密钥恢复步骤见[备份、设备同步与数据库升级](../docs/backup-and-migrations.md)。
