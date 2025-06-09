# 多阶段构建 - 前端构建阶段
FROM node:18-alpine AS frontend-builder

WORKDIR /app

# 复制前端依赖文件
COPY package*.json ./

# 安装依赖
RUN npm ci --silent

# 复制前端源代码
COPY . .

# 构建前端
RUN npm run build

# 后端构建阶段
FROM node:18-alpine AS backend-builder

WORKDIR /app

# 复制后端依赖文件
COPY server/package*.json ./

# 安装生产依赖
RUN npm ci --only=production --silent

# 复制后端代码
COPY server/ .

# 最终生产镜像
FROM nginx:alpine

# 安装 Node.js
RUN apk add --no-cache nodejs npm

# 创建应用目录
WORKDIR /app

# 复制后端应用
COPY --from=backend-builder /app ./server

# 复制前端构建产物到 nginx 目录
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# 复制 nginx 配置
COPY nginx.conf /etc/nginx/nginx.conf

# 复制启动脚本
COPY start.sh /start.sh
RUN chmod +x /start.sh

# 暴露端口
EXPOSE 80 8000

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=8000

# 启动命令
CMD ["/start.sh"]
