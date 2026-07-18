# EasySSH 后端服务

![Status](https://img.shields.io/badge/status-completed-success)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Go](https://img.shields.io/badge/go-1.21+-00ADD8?logo=go)

EasySSH 后端服务采用 Go 语言开发，提供完整的 SSH 服务器管理、终端连接、文件传输、系统监控和审计日志功能。

---

## 📊 开发进度

✅ **后端核心功能已 100% 完成**

| 模块 | 状态 | API 数量 |
|------|------|---------|
| 用户认证 | ✅ 已完成 | 5 个 |
| 服务器管理 | ✅ 已完成 | 7 个 |
| SSH 终端 | ✅ 已完成 | 4 个 |
| SFTP 文件 | ✅ 已完成 | 12 个 |
| 系统监控 | ✅ 已完成 | 6 个 |
| 审计日志 | ✅ 已完成 | 5 个 |

**总计**: 39+ REST API 端点

---

## 🚀 快速开始

### 1. 环境要求

- Go 1.25+
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
go run cmd/api/main.go

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
│   │   │   ├── auth.go          # OAuth 访问令牌认证
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

### 认证 & 授权 (5 个)
- `POST /api/v1/oauth/authorize` - 使用邮箱密码 + PKCE 发起授权请求（支持 2FA）
- `POST /api/v1/oauth/token` - 使用授权码/refresh_token 换取 access_token
- `POST /api/v1/auth/register` - 用户注册
- `POST /api/v1/oauth/logout` - 推荐登出端点（完整撤销当前会话）
- `GET /api/v1/users/me` - 获取当前用户信息

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
- `DELETE /api/v1/logs/cleanup` - 清理旧日志
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
- **OAuth/OIDC Provider**: Ory Fosite v0.49.0
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
- ✅ **OAuth 2.0 + PKCE 登录**：通过 `/api/v1/oauth/authorize` + `/api/v1/oauth/token` 的 Authorization Code + PKCE 流程完成邮箱密码登录（支持 2FA）
- ✅ **访问令牌 (Access Token)**：由 Fosite 签发，仅通过 `Authorization: Bearer <token>` 传递，由前端内存存储和自动刷新管理
- ✅ **刷新令牌 (Refresh Token)**：由 Fosite 签发，内置 Web Client 将其存放于 HttpOnly Cookie（`Path=/api/v1/oauth`）
- ✅ **OIDC**：提供 Discovery、JWKS 与 RSA 3072 签名的 ID Token，支持 Authorization Code + PKCE S256
- ✅ **会话管理**：每次登录创建独立 `user_sessions` 记录，并通过 Fosite Request ID 关联数据库中的授权记录，实现持久化撤销
- ✅ **Casbin RBAC**：权限代码为只读契约，支持自定义角色、角色继承和数据库持久化策略
- ✅ **资源级授权**：可向指定用户或角色授予单个服务器的查看、连接、终端、SFTP 或 Docker 权限
- ✅ **数据层隔离**：Repository 继续校验资源所有者，作为 Casbin 策略之外的纵深安全边界

### 审计追踪
- ✅ 记录所有关键操作（登录、SSH 连接、文件操作等）
- ✅ 包含用户、时间、IP、User-Agent、错误信息
- ✅ 支持多维度查询和统计分析

---

## 🛠️ 开发

### 编译

```bash
# 开发模式（带调试信息）
go build -o easyssh-server cmd/api/main.go

# 生产模式（优化编译）
go build -ldflags="-s -w" -o easyssh-server cmd/api/main.go
```

### 测试

```bash
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
EasySSH 只保留启动自举配置。Cookie、CORS、CSRF、CSP、可信代理、GeoIP、SFTP 连接池、Access Token/Refresh Token 生命周期以及对外 OAuth/OIDC Provider 地址与开关都在“系统设置”维护。对外 Provider 默认关闭，EasySSH 自身登录始终使用固定内部 issuer/redirect，不依赖部署域名。

未设置 `ENCRYPTION_KEY` 时，服务首次启动会生成权限为 `0600` 的 `easyssh-root.key`。服务通过 HKDF-SHA256 派生 OAuth、CSRF 和 2FA 备份码子密钥，不再需要额外全局密钥。外部数据库多实例必须显式提供同一根密钥。首次填写或修改对外 Provider 地址后需重启，关闭/开启开关本身即时生效。

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
  start_period: 40s
```

---

## 🤝 贡献

欢迎贡献！请参考主项目的 [README.md](../README.md) 了解贡献指南。

---

## 📄 许可证

Apache License 2.0 - 详见 [LICENSE](../LICENSE)

---

**EasySSH Backend** - 安全、高效的 SSH 管理后端服务 🚀
