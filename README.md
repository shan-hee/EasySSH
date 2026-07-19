<div align="center">

# EasySSH

<img src="web/public/logo.svg" alt="EasySSH Logo" width="120" />

**现代化的 SSH 管理平台**

提供直观的 Web 界面进行远程服务器管理，支持终端模拟、文件传输、系统监控等功能

[![Version](https://img.shields.io/badge/version-1.0.31-blue)](https://github.com/shan-hee/EasySSH/releases)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](https://go.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite)](https://vite.dev/)
[![React](https://img.shields.io/badge/React-19.1-61DAFB?logo=react)](https://react.dev/)
[![i18n](https://img.shields.io/badge/i18n-ready-green)](https://github.com/shan-hee/EasySSH)

[![Docker Image Version](https://img.shields.io/docker/v/shanhee/easyssh?label=Docker&logo=docker&sort=semver)](https://hub.docker.com/r/shanhee/easyssh)
[![Docker Image Size](https://img.shields.io/docker/image-size/shanhee/easyssh/latest?logo=docker)](https://hub.docker.com/r/shanhee/easyssh)
[![Docker Pulls](https://img.shields.io/docker/pulls/shanhee/easyssh?logo=docker)](https://hub.docker.com/r/shanhee/easyssh)
[![Build Status](https://img.shields.io/github/actions/workflow/status/shan-hee/EasySSH/release.yml?logo=github)](https://github.com/shan-hee/EasySSH/actions)
[![License](https://img.shields.io/github/license/shan-hee/EasySSH)](LICENSE)

[快速开始](#快速开始) • [功能特性](#功能特性) • [技术栈](#技术栈) • [部署指南](#生产环境部署docker) • [开发文档](#开发指南)

</div>

---

## 功能特性

- 🖥️ **Web 终端**：基于 xterm.js 5.5.0 的全功能终端模拟器，支持多标签页、WebGL 渲染、命令补全
- 📁 **文件管理**：SFTP 文件浏览、批量操作、Monaco Editor 0.55.1 在线编辑
- 📊 **系统监控**：实时 CPU、内存、磁盘、网络监控，支持多数据源（EasySSH/Nezha/Komari），Protobuf 高效传输
- 🐳 **Docker 管理**：容器生命周期管理、镜像管理、Compose 项目分组（v1.0.31+）、实时日志查看
- 🤖 **AI 助手**：多提供商支持（Claude/GPT/Gemini）、流式响应、工具调用、权限模式控制
- ⚙️ **自动化任务**：Cron 只负责入队，批量执行和后台传输由数据库持久化队列、租约、心跳与失败重试驱动，无需 Redis
- 🔐 **安全认证**：OAuth 2.0 + PKCE 授权流程，支持双因素认证（2FA）、账户锁定、登录检测
- 🛡️ **Casbin RBAC**：支持自定义角色、单父角色继承、权限策略和指定服务器资源授权
- 🎨 **现代 UI**：基于 Radix UI + Tailwind CSS 4 的响应式界面，支持国际化（react-i18next）

## 技术栈

### 前端
- **框架**：React 19.1.2 + Vite 7 + TypeScript 5
- **UI 组件**：Radix UI + shadcn/ui + Tailwind CSS 4
- **终端**：xterm.js 5.5.0（WebGL 渲染、多主题支持）
- **代码编辑器**：Monaco Editor 0.55.1
- **状态管理**：Zustand 5.0.8 + React Query 5.90.10
- **数据可视化**：ECharts 6.0
- **国际化**：i18next + react-i18next

### 后端
- **语言**：Go 1.25
- **框架**：Gin 1.12.0 + GORM 1.30.0
- **数据库**：SQLite（默认）/ PostgreSQL / MySQL
- **SSH/SFTP**：golang.org/x/crypto + pkg/sftp 1.13.6
- **AI 集成**：Anthropic 官方 Go SDK + OpenAI 官方 Go SDK（Chat Completions / Responses API）
- **WebSocket**：Gorilla WebSocket 1.5.3
- **任务调度**：robfig/cron v3.0.1

### 架构设计

**纯 CSR 架构**：前端静态文件由 Go 后端托管，单容器部署

```
┌─────────────────────────────────────┐
│         Docker 容器                  │
│  ┌──────────────────────────────┐  │
│  │   Go 后端 (:8520)            │  │
│  │  ├─ API 服务                 │  │
│  │  ├─ WebSocket (SSH)          │  │
│  │  └─ 静态文件托管             │  │
│  └──────────────────────────────┘  │
│           ↓                          │
│  ┌──────────────────────────┐       │
│  │ SQLite 数据文件 / 外部 DB │       │
│  └──────────────────────────┘       │
└─────────────────────────────────────┘
```


## 快速开始

### 方式一：Docker 部署（推荐）

**使用 Docker Compose（默认 SQLite 持久化）**：

```bash
# 1. 下载配置文件
mkdir easyssh && cd easyssh
wget https://raw.githubusercontent.com/shan-hee/EasySSH/main/docker/docker-compose.yml

# 2. 编辑配置（可选，修改端口、密码等）
vi docker-compose.yml

# 3. 启动服务
docker compose up -d

# 4. 访问应用
# http://your-server:8520
```

> 💡 **说明**：`docker-compose.yml` 默认只启动 EasySSH 一个容器，SQLite 数据保存在 `docker/data/`。如需 PostgreSQL/MySQL，可通过 `DB_DRIVER` 与 `DB_DSN` 连接串切换。

**单容器部署**（默认 SQLite）：

```bash
docker run -d \
  --name easyssh \
  -p 8520:8520 \
  -v easyssh-data:/app/data \
  shanhee/easyssh:latest
```

镜像默认就是 production + SQLite；挂载 `/app/data` 后，数据库和自动生成的 `easyssh-root.key` 会一起持久化，不需要额外环境变量。

**外部 PostgreSQL/MySQL**：仅需增加 `DB_DRIVER`、`DB_DSN`；多实例再增加共享的 `ENCRYPTION_KEY`。例如 `postgres://easyssh:password@postgres:5432/easyssh_db?sslmode=require`。

**支持架构**：`linux/amd64`、`linux/arm64`

Docker Hub 镜像发布由 GitHub Actions 执行，推送前需要配置仓库 secret `DOCKERHUB_TOKEN`；详情见 [Docker 发布说明](docker/README.md#发布镜像到-docker-hub)。

### 方式二：本地开发

**前置要求**：
- Node.js 24+ / pnpm 11+
- Go 1.25+
- 默认无需单独数据库服务；如需外部数据库，可使用 PostgreSQL 或 MySQL

**一键启动**：

```bash
# 在项目根目录运行
./scripts/dev.sh
```

脚本会自动完成环境配置、依赖安装、服务启动（前端 :3000，后端 :8520）

**手动启动**：

```bash
# 后端（支持热重载）
cd server && make dev

# 前端
cd web && pnpm dev
```

访问 http://localhost:3000

### Docker 常用命令

```bash
# 查看日志
docker compose logs -f

# 停止服务
docker compose down

# 重启服务
docker compose restart

# 升级版本
docker compose pull && docker compose up -d

# 备份数据
tar -czf easyssh-backup-$(date +%Y%m%d).tar.gz docker/data/
```

## 项目结构

```
EasySSH/
├── web/                    # React + Vite 前端（静态构建）
│   ├── src/
│   │   ├── pages/         # 页面组件
│   │   ├── layouts/       # 页面布局
│   │   ├── router.tsx     # React Router 路由
│   │   ├── components/    # React 组件（ui/terminal/editor）
│   │   ├── lib/           # 工具函数与 API 客户端
│   │   └── hooks/         # React Hooks
│   └── public/            # 静态资源
│
├── server/                 # Go 后端服务
│   ├── cmd/api/           # 应用入口
│   ├── internal/
│   │   ├── api/           # HTTP/WebSocket 处理器
│   │   ├── domain/        # 业务领域（server/ssh/auth）
│   │   └── infra/         # 基础设施（db/config）
│   └── migrations/        # 数据库迁移
│
├── docker/                 # Docker 配置与数据持久化
├── scripts/                # 自动化脚本
└── docs/                   # 项目文档
```

## 开发指南

### 常用命令

```bash
# 前端开发
cd web
pnpm dev          # 开发服务器
pnpm build        # Vite 构建生产版本（静态产物到 web/dist）
pnpm lint         # 代码检查

# 后端开发
cd server
make dev          # 开发服务器（热重载）
make build        # 构建二进制
make test         # 运行测试

# API 契约同步（校验全部路由并生成 Go/TypeScript 代码）
./scripts/gen-types.sh
```

## 最小部署配置

EasySSH 只把“数据库连接之前必须知道、且不能安全存入数据库”的参数留在启动层。SQLite 单实例挂载数据目录后可以零参数启动；首次启动会生成权限为 `0600` 的 `easyssh-root.key` 并与数据库一起持久保存：

SQLite 单实例不需要填写任何启动参数。直接运行二进制时，公网部署只需把运行模式改为 production；切换外部数据库时再增加数据库连接：

```bash
ENV=production

DB_DRIVER=postgres
DB_DSN=postgres://easyssh:password@db:5432/easyssh?sslmode=require

# 仅外部数据库多实例需要显式共享同一值
ENCRYPTION_KEY=$(openssl rand -base64 32)
```

部署根密钥保护数据库敏感字段，并通过 HKDF-SHA256 派生用途隔离的 OAuth、CSRF 和 2FA 备份码子密钥，因此不再需要单独维护多把全局密钥。自动生成的密钥位于运行数据目录；显式 `ENCRYPTION_KEY` 会覆盖该文件。根密钥必须随数据持久保存，更换会使已加密凭据和现有登录状态失效。

其余参数在 Web 管理界面维护：

- **身份认证**：注册、默认角色、Google 登录、登录会话、限流、泄露密码检查、对外 OAuth/OIDC Provider 地址与开关。
- **Web 与部署**：Cookie 自动 HTTP/HTTPS 策略、CORS、CSRF、CSP、可信代理和 GeoIP 路径。
- **文件传输**：上传与暂存策略、SSH/SFTP 连接池参数。
- **服务集成与数据保护**：通知、AI、备份与恢复。

EasySSH 自身登录使用固定内部 PKCE 标识，不依赖域名。对外 OAuth/OIDC Provider 默认关闭；首次填写或修改公开地址后需重启加载，之后开关可以即时关闭或开启。GeoIP 默认读取运行数据目录中的 `GeoLite2-City.mmdb`，文件缺失时自动禁用且不会调用第三方 IP 定位接口。

开发端口、外部数据库连接池和更新清单等高级启动参数见 [.env.example](.env.example)。

## 贡献指南

欢迎贡献代码！请遵循以下流程：

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'feat: add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 开源协议。

## 支持与反馈

- 🐛 **问题反馈**：[提交 Issue](https://github.com/shan-hee/EasySSH/issues)
- 📖 **文档**：[docs/](docs/)
- 🐳 **Docker Hub**：[shanhee/easyssh](https://hub.docker.com/r/shanhee/easyssh)

---

<div align="center">

**如果这个项目对你有帮助，请给个 ⭐️ Star 支持一下！**

</div>
