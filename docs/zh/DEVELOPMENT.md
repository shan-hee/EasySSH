# EasySSH 开发指南

<div align="center">
  <img src="../../src/assets/icons/logo.svg" alt="EasySSH Logo" width="50" />
  <h2>🛠️ 开发指南</h2>
  <p>
    <a href="../en/DEVELOPMENT.md">🇺🇸 English</a> | 
    <a href="../README.md">📚 文档中心</a>
  </p>
</div>

## 项目简介

EasySSH 是一个现代化的 SSH 客户端，提供高效、安全、易用的远程服务器管理体验。项目采用前后端分离架构，前端基于 Vue.js，后端基于 Node.js 的 Express 框架，并使用 SQLite 和 node-cache 作为数据存储。

## 运行环境要求

- Node.js >= 16.0.0
- SQLite >= 3.0.0
- 支持现代浏览器 (Chrome, Firefox, Edge, Safari)
- OpenSSH 客户端 (可选，用于一些高级功能)

## 快速开始

按照以下步骤设置和运行项目：

### 克隆仓库

```bash
git clone https://github.com/yourusername/easyssh.git
cd easyssh
```

### 环境配置

1. 复制环境变量示例文件：

```bash
cp .env.example .env
```

2. 编辑 `.env` 文件，配置以下重要参数：

- `PORT`: 服务器端口，默认为 3000
- `JWT_SECRET`: JWT 令牌密钥，用于用户认证
- `ENCRYPTION_KEY`: 敏感数据加密密钥
- `SQLITE_PATH`: SQLite 数据库路径，默认为 './server/data/easyssh.sqlite'

### 安装依赖

```bash
# 安装前端依赖
npm install

# 安装服务器依赖
cd server
npm install
cd ..
```

### 准备数据库

SQLite 数据库会在首次启动时自动创建，无需额外配置。

### 启动应用

```bash
# 开发模式启动前端
npm run dev

# 另一个终端中启动服务器
cd server
npm run dev
```

访问 `http://localhost:3000` 打开应用。

## 开发流程

### 项目结构

```
easyssh/
├── server/               # 后端代码
│   ├── config/           # 配置文件
│   ├── controllers/      # API控制器
│   ├── data/             # SQLite数据库文件
│   ├── middleware/       # 中间件
│   ├── models/           # 数据模型
│   ├── routes/           # API路由
│   ├── services/         # 业务逻辑服务
│   └── ssh/              # SSH连接管理
├── src/                  # 前端源代码
│   ├── assets/           # 静态资源
│   ├── components/       # Vue组件
│   ├── store/            # Pinia状态管理
│   ├── views/            # 页面视图
│   └── router/           # 路由配置
└── public/               # 公共资源
```

### 前端开发

1. 在 `src/components` 目录中创建新组件
2. 使用 `src/views` 组装页面
3. 在 `src/router` 中定义路由
4. 使用 `src/store` 中的Pinia存储管理状态

### 后端开发

1. 在 `server/models` 中定义数据模型
2. 在 `server/services` 中实现业务逻辑
3. 在 `server/controllers` 中定义API控制器
4. 在 `server/routes` 中注册API路由

## 常见问题解决

1. **SQLite连接失败**
- 检查data目录是否存在且有写入权限
- 确认SQLite驱动程序已正确安装

2. **缓存未正常工作**
- 检查node-cache配置是否正确
- 确认缓存键值设置正确

3. **SSH连接问题**
- 确认SSH凭据正确
- 检查防火墙设置
- 尝试使用telnet测试连接: `telnet hostname port`

4. **内存使用过高**
- 减少缓存TTL
- 优化查询逻辑减少内存使用

## 部署指南

### 生产环境设置

1. 设置环境变量：
```
NODE_ENV=production
JWT_SECRET=your_secure_jwt_secret
ENCRYPTION_KEY=your_secure_encryption_key
```

2. 构建前端：
```bash
npm run build
```

3. 配置反向代理 (Nginx 示例):
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 使用 Docker 部署

```bash
docker build -t easyssh .
docker run -p 3000:3000 -v sqlite-data:/app/server/data easyssh
```

## 🚀 使用指南

### 常用命令

```bash
# 开发环境
npm run dev                    # 启动开发服务器
npm run dev:debug             # 调试模式启动

# 构建相关
npm run build                 # 生产构建
npm run build:analyze         # 构建分析
npm run build:optimize        # 优化构建流程
npm run preview               # 预览构建结果

# 代码质量
npm run lint                  # 代码检查
npm run lint:fix              # 自动修复
npm run format                # 代码格式化
npm run format:check          # 格式检查

# 依赖管理
npm run deps:check            # 检查过时依赖
npm run deps:update           # 更新依赖
npm run deps:manage           # 依赖管理工具
npm run deps:sync             # 同步前后端依赖

# 清理相关
npm run clean                 # 清理缓存
npm run clean:all             # 完全清理
npm run reinstall             # 重新安装
```

### 服务端命令

```bash
cd server

# 开发环境
npm run dev                   # 开发模式
npm run dev:debug             # 调试模式
npm run prod                  # 生产模式

# 数据库管理
npm run db:backup             # 备份数据库
npm run db:restore            # 恢复数据库

# 代码质量
npm run lint                  # 代码检查
npm run lint:fix              # 自动修复
```

## 📊 性能监控

### 构建分析
- 运行 `npm run build:analyze` 查看详细的包分析
- 查看 `dist/stats.html` 了解包大小分布
- 检查 `dist/build-report.json` 获取构建信息

### 包大小监控
- 运行 `npm run size` 检查包大小
- 配置在 `package.json` 的 `bundlesize` 字段
- 自动检查是否超过阈值

### 依赖分析
- 运行 `npm run deps:manage` 检查依赖状态
- 自动检测版本不一致问题
- 生成依赖报告

## 🔧 配置文件说明

### 环境配置
- `.env.example` - 环境变量配置模板
- `.env` - 实际使用的环境变量文件（从模板复制并修改）

### 构建配置
- `vite.config.js` - 主要构建配置
- `vite.config.analyze.js` - 分析专用配置
- `performance.config.js` - 性能配置

### 代码质量
- `.eslintrc.js` - ESLint 规则
- `.prettierrc` - Prettier 配置
- `server/.eslintrc.js` - 服务端 ESLint

## 🎯 最佳实践

### 开发流程
1. 使用 `npm run dev` 启动开发服务器
2. 定期运行 `npm run lint:fix` 修复代码问题
3. 提交前运行 `npm run format` 格式化代码
4. 使用 `npm run test` 确保测试通过

### 构建流程
1. 运行 `npm run build:optimize` 进行优化构建
2. 使用 `npm run build:analyze` 分析包大小
3. 检查 `npm run size` 确保包大小合理
4. 运行 `npm run preview` 预览构建结果

### 依赖管理
1. 定期运行 `npm run deps:check` 检查更新
2. 使用 `npm run deps:manage` 管理依赖版本
3. 重要更新前备份数据库 `npm run db:backup`

## 技术栈

- 前端：Vue 3, Pinia, Vue Router, Element Plus
- 后端：Node.js, Express, SQLite, node-cache
- SSH连接：ssh2, xterm.js
- 加密：bcrypt, crypto-js, jsonwebtoken

## 贡献指南

1. Fork 项目仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到远程分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

## 开源协议

本项目基于 Apache License 2.0 许可证开源，详情请参阅 [LICENSE](../../LICENSE) 文件。
