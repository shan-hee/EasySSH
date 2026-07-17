# EasySSH Docker 部署指南

## 架构说明

EasySSH 采用纯 CSR 架构：前端静态文件由 Go 后端托管，默认一个容器即可运行。数据库默认使用 SQLite，数据文件挂载到宿主机；需要更高并发或多实例部署时，可切换到外部 PostgreSQL/MySQL。

```
┌─────────────────────────────────────┐
│         Docker 容器                  │
│  ┌──────────────────────────────┐   │
│  │   Go 后端 (:8520)            │   │
│  │  ├─ API 服务                 │   │
│  │  ├─ WebSocket (SSH)          │   │
│  │  └─ 静态文件托管 (Vite)      │   │
│  └──────────────────────────────┘   │
│           ↓                          │
│  ┌──────────────────────────┐       │
│  │ SQLite / 外部 PostgreSQL │       │
│  │        或 MySQL          │       │
│  └──────────────────────────┘       │
└─────────────────────────────────────┘
```

## 快速开始

```bash
cd docker
docker compose up -d
docker compose ps
docker compose logs -f
```

默认访问地址：

```text
http://localhost:8520
```

默认持久化目录：

- `docker/data/`：SQLite 数据库文件

## 环境变量

最小配置：

```bash
DB_DRIVER=sqlite
DB_DSN=/app/data/easyssh.db
GEOIP_DATABASE_PATH=/app/data/GeoLite2-City.mmdb
OAUTH_GLOBAL_SECRET=$(openssl rand -base64 48)
OAUTH_ISSUER=http://localhost:8520/api/v1
OAUTH_LOGIN_URL=http://localhost:8520/login
OAUTH_WEB_REDIRECT_URIS=http://localhost:8520/auth/callback
ENCRYPTION_KEY=$(openssl rand -base64 32)
```

如需服务器位置与登录位置识别，将 MaxMind `GeoLite2-City.mmdb` 放入挂载的 `docker/data/` 目录；文件缺失时应用不会调用第三方 IP 查询服务。

外部 PostgreSQL 示例：

```bash
DB_DRIVER=postgres
DB_PASSWORD=your_secure_password
DB_DSN="postgres://easyssh:${DB_PASSWORD:-your_secure_password}@postgres.example.com:5432/easyssh_db?sslmode=require"
```

外部 MySQL 示例：

```bash
DB_DRIVER=mysql
DB_PASSWORD=your_secure_password
DB_DSN="mysql://easyssh:${DB_PASSWORD:-your_secure_password}@mysql.example.com:3306/easyssh_db?charset=utf8mb4&parseTime=true"
```

常用应用配置：

```bash
ENV=production
BACKEND_URL=http://localhost:8520
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
```

## 常用命令

```bash
# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 拉取最新镜像并重启
docker compose pull
docker compose up -d

# 使用开发配置本地构建
docker compose -f docker-compose.dev.yml up -d --build
```

## 发布镜像到 Docker Hub

项目的 Docker 镜像由 GitHub Actions 工作流 `.github/workflows/docker-build.yml` 构建并推送到 Docker Hub。推送前需要在 GitHub 仓库中配置以下 secret：

| Secret 名称 | 用途 | 说明 |
|-------------|------|------|
| `DOCKERHUB_TOKEN` | Docker Hub 登录令牌 | 在 Docker Hub 生成 Access Token 后填入，当前工作流使用账号 `shanhee` 推送 `shanhee/easyssh` |

配置路径：GitHub 仓库 `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`。

触发方式：

- 推送 `v*` tag（推荐使用 `./scripts/bump-version.sh <version>`）触发发布流水线 `.github/workflows/release.yml`，依次执行版本校验、镜像构建（默认 `linux/amd64`，含 Trivy 安全扫描）、Windows 桌面端构建（默认 x86）和 GitHub Release 创建。
- 在 GitHub Actions 页面手动运行 `Build EasySSH Docker Image`，可指定版本号、是否更新 `latest`、构建平台（用于紧急重建镜像或构建其他架构，不会创建 Release）。
- 在 GitHub Actions 页面手动运行 `Build EasySSH Desktop`，可选择 Windows 架构（amd64 / arm64），产物以 artifact 形式上传。

如需更换 Docker Hub 账号或镜像名，需要同步修改 `.github/workflows/docker-build.yml` 中的 `DOCKER_IMAGE` 和登录用户名。

## 数据备份

SQLite 默认部署下，最直接的文件级备份方式是停止容器后复制 `docker/data/easyssh.db`。也可以在系统管理页面使用统一备份导出 JSON 文件。

```bash
# 文件级备份
docker compose stop easyssh
tar -czf easyssh-data-$(date +%Y%m%d).tar.gz data
docker compose start easyssh
```

使用 PostgreSQL/MySQL 时，建议优先使用数据库自身的备份工具；EasySSH 统一备份 `3.0` 保留跨 SQLite、PostgreSQL、MySQL 的表级逻辑迁移与恢复能力。完整备份中的敏感数据使用标准 age 格式，可选择 Scrypt 口令或 X25519 Recipient 加密。

## 故障排查

```bash
# 查看服务健康状态
docker compose ps

# 查看应用日志
docker compose logs -f easyssh

# 手动检查健康接口
curl http://localhost:8520/api/v1/health

# 进入容器
docker exec -it easyssh sh
```

如果应用无法写入 SQLite 文件，请检查 `docker/data/` 目录权限，或删除目录后让 Docker Compose 重新创建。

## 安全建议

- 生产环境务必设置强随机 `OAUTH_GLOBAL_SECRET` 和 `ENCRYPTION_KEY`，并将 `OAUTH_ISSUER`、`OAUTH_LOGIN_URL`、`OAUTH_WEB_REDIRECT_URIS` 改为实际 HTTPS 地址。
- 使用 HTTPS 时设置 `COOKIE_SECURE=true`。
- 默认 SQLite 适合单实例部署；多实例或高并发场景建议使用 PostgreSQL/MySQL。
- OAuth 授权记录、登录挑战和一次性 ticket 均持久化到数据库；接口限流计数仍是进程内状态，应用重启后会清空。

## 版本号管理

项目使用根目录 `VERSION` 文件管理版本号，更新后会触发 GitHub Actions 构建新镜像。

```bash
./scripts/bump-version.sh 1.0.1
```

## 许可证

Apache License 2.0
