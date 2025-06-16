# ===== 修复版多阶段构建 =====

# 构建参数
ARG BUILD_DATE
ARG GIT_SHA
ARG GIT_REF
ARG BUILDKIT_INLINE_CACHE=1

# 阶段1: 前端构建（使用bullseye完整环境）
FROM node:20-bullseye AS frontend-builder

# 设置非交互式安装
ENV DEBIAN_FRONTEND=noninteractive

# 安装构建依赖（bullseye已包含大部分工具）
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制依赖文件并安装
COPY package*.json ./
RUN npm install --legacy-peer-deps --no-audit

# 复制源代码并构建
COPY . .
RUN NODE_ENV=production npm run build

# 阶段2: 后端构建（使用bullseye编译原生模块）
FROM node:20-bullseye AS backend-builder

# 设置非交互式安装
ENV DEBIAN_FRONTEND=noninteractive

# 安装构建依赖（包含SQLite开发库）
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制后端依赖文件并安装
COPY server/package*.json ./
RUN npm install --omit=dev --legacy-peer-deps --no-audit && \
    npm rebuild better-sqlite3

# 复制后端源代码
COPY server/ .

# 阶段3: Nginx静态文件服务
FROM nginx:alpine AS nginx-server

# 复制前端构建产物
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# 复制nginx配置
COPY nginx.conf /etc/nginx/nginx.conf

# 阶段4: 最终运行时镜像（使用node:20-slim）
FROM node:20-slim AS runtime

# 设置非交互式安装，避免debconf警告
ENV DEBIAN_FRONTEND=noninteractive

# 只安装运行时必需的依赖
RUN apt-get update && apt-get install -y \
    sqlite3 \
    libsqlite3-0 \
    nginx \
    wget \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# 创建非root用户
RUN groupadd -r appuser && useradd -r -g appuser appuser

# 创建应用目录
WORKDIR /app

# 复制预编译的后端应用（包含已编译的better-sqlite3）
COPY --from=backend-builder /app ./server
COPY --from=nginx-server /usr/share/nginx/html ./public
COPY --from=nginx-server /etc/nginx/nginx.conf /etc/nginx/nginx.conf

# 复制启动脚本
COPY start.sh /start.sh
RUN chmod +x /start.sh

# 设置权限和nginx目录
RUN chown -R appuser:appuser /app && \
    mkdir -p /var/log/nginx /var/cache/nginx /var/lib/nginx /run/nginx && \
    chown -R appuser:appuser /var/log/nginx /var/cache/nginx /var/lib/nginx /run/nginx

# 暴露端口
EXPOSE 3000 8000

# 设置环境变量和标签
ENV NODE_ENV=production \
    PORT=8000 \
    USER=appuser

# 添加构建信息标签
LABEL maintainer="EasySSH Team" \
      version="1.0.0" \
      description="现代化的SSH客户端，提供高效、安全、易用的远程服务器管理体验" \
      build-date="${BUILD_DATE}" \
      git-sha="${GIT_SHA}" \
      git-ref="${GIT_REF}"

# 切换到非root用户
USER appuser

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# 启动命令
CMD ["/start.sh"]
