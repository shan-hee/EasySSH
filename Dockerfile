# syntax=docker/dockerfile:1

# 构建参数（可从CI传入）
ARG BUILD_DATE
ARG GIT_SHA
ARG GIT_REF

# 阶段1：安装后端依赖（含dev，供构建使用）
FROM node:20-bullseye AS backend-deps
WORKDIR /app/server
# 为原生模块（如 better-sqlite3）准备构建工具
RUN apt-get update && apt-get install -y \
      python3 \
      make \
      g++ \
      libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/* && apt-get clean
COPY server/package*.json ./
RUN npm install --no-audit --no-fund

# 阶段2：构建后端（TypeScript -> dist）
FROM node:20-bullseye AS backend-builder
WORKDIR /app/server
COPY --from=backend-deps /app/server/node_modules ./node_modules
COPY server/ .
RUN npm run build

# 阶段3：仅生产依赖（更小体积）
FROM node:20-bullseye AS backend-prod-deps
WORKDIR /app/server
COPY --from=backend-deps /app/server/node_modules ./node_modules
COPY server/package*.json ./
RUN npm prune --omit=dev && npm cache clean --force

# 阶段4：运行时镜像
FROM node:20-slim AS runtime

ENV NODE_ENV=production \
    PORT=8000 \
    NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_PROGRESS=false

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

# 复制由CI预构建的前端产物
COPY dist/ ./public/

# 配置文件与启动脚本
COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /start.sh
RUN chmod +x /start.sh

# 复制后端运行所需文件（dist + 生产依赖）
COPY --from=backend-builder /app/server/dist ./server/dist
COPY --from=backend-prod-deps /app/server/node_modules ./server/node_modules
COPY server/package*.json ./server/

# 目录与权限
RUN mkdir -p /app/server/data /app/server/logs \
    && chown -R appuser:appuser /app /var/log/nginx /var/cache/nginx /var/lib/nginx /run/nginx

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8520/health || exit 1

# 启动
CMD ["/start.sh"]
