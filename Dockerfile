# ===== 极致优化版 Dockerfile =====
# 特点：预构建前端、最小化层数、最大化缓存利用

# 构建参数
ARG BUILD_DATE
ARG GIT_SHA
ARG GIT_REF
ARG BUILDKIT_INLINE_CACHE=1

# 阶段1: 后端构建（只构建后端，前端已预构建）
FROM node:20-bullseye AS backend-builder

# 设置环境变量（一次性设置）
ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_PROGRESS=false

# 一次性安装所有依赖并清理
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# 复制并安装后端依赖（利用缓存）
COPY server/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund && \
    npm rebuild better-sqlite3 && \
    npm cache clean --force

# 复制后端源代码
COPY server/ .

# 阶段2: 最终运行时镜像（极致优化）
FROM node:20-slim AS runtime

# 一次性设置所有环境变量
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=8000 \
    USER=appuser

# 一次性完成所有系统配置（最小化层数）
RUN apt-get update && apt-get install -y \
    sqlite3 \
    libsqlite3-0 \
    nginx \
    wget \
    iputils-ping \

    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && chmod u+s /bin/ping \
    && groupadd -r appuser \
    && useradd -r -g appuser appuser \
    && mkdir -p /var/log/nginx /var/cache/nginx /var/lib/nginx /run/nginx

WORKDIR /app

# 复制预构建的前端文件（本地构建）
COPY dist/ ./public/

# 复制配置文件
COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /start.sh

# 复制后端应用
COPY --from=backend-builder /app ./server

# 创建必要目录并设置权限
RUN chmod +x /start.sh && \
    mkdir -p /app/server/data /app/server/logs && \
    chown -R appuser:appuser /app /var/log/nginx /var/cache/nginx /var/lib/nginx /run/nginx

# 元数据
LABEL maintainer="EasySSH Team" \
      version="1.0.0" \
      description="现代化的SSH客户端，提供高效、安全、易用的远程服务器管理体验" \
      build-date="${BUILD_DATE}" \
      git-sha="${GIT_SHA}" \
      git-ref="${GIT_REF}"

# 保持root用户，在启动脚本中处理权限

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8520/health || exit 1

# 启动命令
CMD ["/start.sh"]
