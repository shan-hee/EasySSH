# syntax=docker/dockerfile:1.7

# ============================================
# EasySSH 统一 Dockerfile
# 多阶段构建：Vite 前端静态构建 + Go 后端
# ============================================

# Stage 1: 在构建机原生架构上打包前端，静态产物由各目标架构共用
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend-builder

WORKDIR /app/web

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# 使用固定 pnpm 版本，保证构建一致性
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# 先复制完整依赖配置（包含 overrides 和工作区包清单），再利用缓存安装
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
COPY web/packages/ssh-workspace/package.json ./packages/ssh-workspace/package.json
RUN --mount=type=cache,id=easyssh-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store

# 复制源码并执行 Vite 静态构建
COPY VERSION /app/VERSION
COPY web/ ./
COPY shared/syncjs/ /app/shared/syncjs/
RUN pnpm run build

# Automerge runs as a private stdio worker managed by the Go service.
FROM node:24-alpine AS sync-runtime-builder
WORKDIR /app/server/sync-runtime
COPY server/sync-runtime/package.json server/sync-runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server/sync-runtime/engine.mjs ./

# Stage 2: 在构建机原生架构上交叉编译 Go，避免通过 QEMU 执行编译器
FROM --platform=$BUILDPLATFORM golang:1.26.10-alpine AS backend-builder

WORKDIR /app/server

# git 用于拉取 go modules；ca/tz 提供基础运行能力
RUN apk add --no-cache git ca-certificates tzdata

# 先下载依赖，提升增量构建速度
COPY shared/go.mod shared/go.sum /app/shared/
COPY server/go.mod server/go.sum ./
RUN --mount=type=cache,id=easyssh-go-mod,target=/go/pkg/mod \
    go mod download && go mod verify

# 后端编译不依赖前端静态产物，两个构建阶段可独立执行
COPY shared/ /app/shared/
COPY server/ ./

# BuildKit 根据目标平台提供 GOOS/GOARCH；CGO=0 支持跨架构构建
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,id=easyssh-go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=easyssh-go-build,target=/root/.cache/go-build \
    CGO_ENABLED=0 \
    GOOS=$TARGETOS \
    GOARCH=$TARGETARCH \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o easyssh-api ./cmd/api

# Stage 3: 运行时镜像
FROM alpine:3.22

WORKDIR /app

# 运行时组件：证书与时区；健康检查使用 Alpine 自带的 BusyBox wget
RUN apk --no-cache add ca-certificates tzdata nodejs postgresql-client mariadb-client tini

# 使用非 root 用户运行
ARG APP_UID=1001
ARG APP_GID=1001
RUN addgroup -S -g ${APP_GID} appuser \
    && adduser -S -u ${APP_UID} appuser -G appuser \
    && mkdir -p /app/data /app/backups /app/instance-state \
    && chown -R appuser:appuser /app/data /app/backups /app/instance-state

# 默认环境（可在运行容器时覆盖）
ENV TZ=Asia/Shanghai \
    ENV=production \
    BACKEND_URL=http://localhost:8520 \
    EASYSSH_SYNC_ENGINE=/app/server/sync-runtime/engine.mjs \
    EASYSSH_BACKUP_DIR=/app/backups \
    EASYSSH_INSTANCE_STATE_DIR=/app/instance-state \
    DB_DRIVER=sqlite \
    DB_DSN=/app/data/easyssh.db

# 复制后端二进制与前端静态资源
COPY --from=sync-runtime-builder --chown=appuser:appuser /app/server/sync-runtime ./server/sync-runtime
COPY --chown=appuser:appuser shared/syncjs/ ./shared/syncjs/
COPY --from=backend-builder --chown=appuser:appuser /app/server/easyssh-api ./
COPY --from=frontend-builder --chown=appuser:appuser /app/web/dist ./static
COPY --from=frontend-builder --chown=appuser:appuser /app/VERSION ./VERSION

USER appuser

EXPOSE 8520

# 健康检查：命中后端健康接口
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD busybox wget -q -O /dev/null http://127.0.0.1:8520/api/v1/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./easyssh-api"]
