# 基础镜像 - 共享系统依赖
FROM node:20 AS base
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    make \
    g++ \
    git \
    && ln -sf python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/* \
    && npm config set registry https://registry.npmmirror.com

# 前端构建阶段
FROM base AS frontend-builder
WORKDIR /app

# 优化：先复制依赖文件，利用Docker缓存
COPY package*.json ./
RUN npm ci --only=production --prefer-offline --no-audit --legacy-peer-deps

# 复制源代码并构建
COPY src/ ./src/
COPY public/ ./public/
COPY index.html vite.config.js ./
RUN NODE_ENV=production npm run build

# 后端构建阶段
FROM base AS backend-builder
RUN apt-get update && apt-get install -y \
    sqlite3 \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 优化：先复制依赖文件，利用Docker缓存
COPY server/package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit --legacy-peer-deps

# 复制后端代码
COPY server/ .
RUN npm rebuild better-sqlite3

# 最终生产镜像 - 使用更轻量的基础镜像
FROM node:20-slim

# 安装运行时依赖
RUN apt-get update && apt-get install -y \
    nginx \
    sqlite3 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# 创建应用目录
WORKDIR /app

# 复制后端应用（只复制必要文件）
COPY --from=backend-builder /app/node_modules ./server/node_modules
COPY --from=backend-builder /app/*.js ./server/
COPY --from=backend-builder /app/package.json ./server/
COPY server/config ./server/config
COPY server/routes ./server/routes
COPY server/middleware ./server/middleware
COPY server/services ./server/services
COPY server/utils ./server/utils
COPY server/models ./server/models
COPY server/controllers ./server/controllers

# 复制前端构建产物
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# 复制配置文件
COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /start.sh
RUN chmod +x /start.sh

# 暴露端口
EXPOSE 3000 8000

# 设置环境变量
ENV NODE_ENV=production \
    PORT=8000 \
    PATH=/app/server/node_modules/.bin:$PATH

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# 启动命令
CMD ["/start.sh"]
