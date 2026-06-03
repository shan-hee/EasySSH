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
JWT_SECRET=$(openssl rand -base64 48)
ENCRYPTION_KEY=$(openssl rand -base64 32)
```

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

- 推送到 `main` 分支且修改了 `VERSION`、`Dockerfile` 或 `.github/workflows/docker-build.yml` 时自动构建并推送。
- 在 GitHub Actions 页面手动运行 `Build EasySSH Docker Image`，可指定版本号、是否更新 `latest`、构建平台。

如需更换 Docker Hub 账号或镜像名，需要同步修改 `.github/workflows/docker-build.yml` 中的 `DOCKER_IMAGE` 和登录用户名。

## 数据备份

SQLite 默认部署下，最直接的文件级备份方式是停止容器后复制 `docker/data/easyssh.db`。也可以在系统管理页面使用统一备份导出 JSON 文件。

```bash
# 文件级备份
docker compose stop easyssh
tar -czf easyssh-data-$(date +%Y%m%d).tar.gz data
docker compose start easyssh
```

使用 PostgreSQL/MySQL 时，建议优先使用数据库自身的备份工具；EasySSH 的统一备份导出可作为轻量迁移与恢复入口。

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

- 生产环境务必设置强随机 `JWT_SECRET` 和 `ENCRYPTION_KEY`。
- 使用 HTTPS 时设置 `COOKIE_SECURE=true`。
- 默认 SQLite 适合单实例部署；多实例或高并发场景建议使用 PostgreSQL/MySQL。
- 进程内短期状态会在应用重启后清空，包括临时验证码、一次性 ticket、token 黑名单和接口限流计数。

## 版本号管理

项目使用根目录 `VERSION` 文件管理版本号，更新后会触发 GitHub Actions 构建新镜像。

```bash
./scripts/bump-version.sh 1.0.1
```

## 许可证

Apache License 2.0
