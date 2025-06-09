# EasySSH

<div align="center">
  <img src="src/assets/icons/logo.svg" alt="EasySSH Logo" width="50" />
  <h3>现代化Web终端 · 高效服务器管理 · 安全远程访问</h3>

  <p>
    <a href="#在线演示">在线演示</a> •
    <a href="#核心特性">核心特性</a> •
    <a href="#快速开始">快速开始</a> •
    <a href="#技术实现">技术实现</a> •
    <a href="#部署指南">部署指南</a> •
    <a href="#未来规划">未来规划</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="version" />
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="license" />
    <img src="https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen" alt="node" />
    <img src="https://github.com/shanheee/easyssh/workflows/Build%20and%20Publish%20Docker%20Image/badge.svg" alt="Docker Build" />
    <img src="https://img.shields.io/docker/pulls/shanheee/easyssh" alt="Docker Pulls" />
  </p>

  <p>
    <strong>🌐 多语言支持 | Multi-language Support</strong><br/>
    <a href="docs/zh/README.md">🇨🇳 中文</a> |
    <a href="docs/en/README.md">🇺🇸 English</a> |
    <a href="docs/README.md">📚 文档中心</a>
  </p>
</div>

## 产品介绍

**EasySSH**是一款强大的基于Web的SSH终端客户端，为开发者、系统管理员和DevOps团队提供高效、安全、易用的远程服务器管理体验。无需安装额外软件，只需一个浏览器，即可随时随地管理您的所有服务器。

## 在线演示

- [EasySSH在线体验](https://easyssh.example.com)
- 体验账号: `demo@example.com` / 密码: `admin`

<div align="center">
  <img src="src/assets/images/Preview.png" alt="EasySSH界面预览" width="80%" />
</div>

## 核心特性

<table>
  <tr>
    <td>🌐 <b>浏览器SSH终端</b></td>
    <td>通过任何现代浏览器访问远程服务器，无需安装额外软件</td>
  </tr>
  <tr>
    <td>⚡ <b>高性能架构</b></td>
    <td>采用WebSocket实时通信，确保命令响应迅速，支持上千并发连接</td>
  </tr>
  <tr>
    <td>🔐 <b>安全凭证管理</b></td>
    <td>所有服务器凭证通过军事级AES-256加密存储，保障数据安全</td>
  </tr>
  <tr>
    <td>🔄 <b>会话持久化</b></td>
    <td>支持断线重连和会话恢复，保持工作连续性</td>
  </tr>
  <tr>
    <td>📱 <b>响应式设计</b></td>
    <td>完美适配从手机到大屏显示器的各种屏幕尺寸</td>
  </tr>
  <tr>
    <td>🎨 <b>多主题支持</b></td>
    <td>丰富的终端主题选择，包括深色模式和护眼模式</td>
  </tr>
  <tr>
    <td>📑 <b>多标签管理</b></td>
    <td>在单一界面中并行连接和管理多台服务器</td>
  </tr>
  <tr>
    <td>🚀 <b>混合存储引擎</b></td>
    <td>SQLite + node-cache混合存储架构，平衡性能和可靠性</td>
  </tr>
</table>

## 使用场景

- **开发团队**: 多人协作管理开发、测试和生产服务器
- **系统管理员**: 集中监控和管理大量服务器
- **DevOps工程师**: 在CI/CD流程中快速执行部署和维护操作
- **远程工作**: 随时随地安全地访问工作环境
- **教育机构**: 为学生提供统一的Linux学习环境

## 快速开始

### 🐳 Docker 快速启动（推荐）

```bash
# Docker 快速启动
docker run -d \
  --name easyssh \
  -p 80:80 \
  -p 8000:8000 \
  shanheee/easyssh:latest
```

### 💻 本地开发安装

```bash
# 克隆仓库
git clone https://github.com/shanheee/easyssh.git
cd easyssh

# 安装依赖
npm install

# 配置环境
# 开发环境
cp .env.example .env.development
# 编辑.env.development文件设置开发环境参数

# 生产环境
cp .env.example .env.production
# 编辑.env.production文件设置生产环境参数

# 启动开发服务器
npm run dev
```

### 使用方法

1. 访问 http://localhost:3000
2. 注册账号或使用默认管理员账号登录
3. 添加您的第一台服务器
4. 点击连接按钮，开始远程管理！

## 技术实现

### 系统架构

```
┌─────────────┐       ┌─────────────────────┐
│   客户端     │◄─────►│  SSH WebSocket代理  │
│ (Vue.js SPA)│       │     (Node.js)       │
└─────────────┘       └─────────┬───────────┘
                                │
                     ┌──────────┴──────────┐
                     │                     │
               ┌─────▼─────┐       ┌───────▼─────┐       ┌──────────────┐
               │  SQLite   │       │ node-cache  │◄──────►│ SSH 服务器   │
               │(持久化层) │       │(缓存层)    │       │(远程主机)    │
               └───────────┘       └─────────────┘       └──────────────┘
```

### 技术栈

<table>
  <tr>
    <th>前端</th>
    <th>后端</th>
    <th>数据存储</th>
  </tr>
  <tr>
    <td>
      • Vue.js 3<br/>
      • Pinia<br/>
      • Xterm.js<br/>
      • Element Plus<br/>
      • Vite
    </td>
    <td>
      • Node.js<br/>
      • Express<br/>
      • WebSocket<br/>
      • JWT认证<br/>
      • SSH2
    </td>
    <td>
      • SQLite<br/>
      • node-cache<br/>
      • bcrypt<br/>
      • crypto-js
    </td>
  </tr>
</table>

### 性能优势

- **实时通信**: WebSocket建立持久连接，确保命令执行响应迅速
- **高速缓存**: node-cache减少了70%以上的数据库查询，平均API响应时间降低了150ms
- **安全保障**: 所有敏感数据通过AES-256加密，密码使用bcrypt哈希存储
- **可伸缩性**: 分布式架构设计，支持水平扩展

## 部署指南

### 🐳 使用Docker Compose

```bash
# 克隆项目
git clone https://github.com/shanheee/easyssh.git
cd easyssh

# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 🐳 生产环境部署

```bash
# 拉取最新镜像
docker pull shanheee/easyssh:latest

# 启动生产容器（带数据持久化）
docker run -d \
  --name easyssh-prod \
  --restart unless-stopped \
  -p 80:80 \
  -p 8000:8000 \
  -v $(pwd)/data:/app/server/data \
  -v $(pwd)/logs:/var/log/supervisor \
  shanheee/easyssh:latest
```

#### Docker部署配置

**端口说明：**
- `80`: Nginx前端服务端口
- `8000`: Node.js后端API端口

**环境变量：**
- `NODE_ENV`: 运行环境（development/production）
- `PORT`: 后端服务端口（默认8000）

**数据持久化：**
- `/app/server/data`: SQLite数据库存储目录
- `/var/log/supervisor`: 应用日志目录

### 传统部署

```bash
# 前端构建
npm run build

# 后端部署
cd server
npm install --production
pm2 start index.js --name easyssh-server

# 配置Nginx反向代理
# 参考开发指南中的Nginx配置示例
```

### 云平台部署

EasySSH支持一键部署到主流云平台:

- [部署到Vercel](https://vercel.com/import/project?template=https://github.com/shan-hee/easyssh)
- [部署到Heroku](https://heroku.com/deploy?template=https://github.com/shan-hee/easyssh)

## 未来规划

<table>
  <tr>
    <td>📂 <b>文件管理器</b></td>
    <td>集成SFTP功能，提供直观的文件上传下载和管理</td>
  </tr>
  <tr>
    <td>👥 <b>团队协作</b></td>
    <td>多用户权限管理和实时协作能力</td>
  </tr>
  <tr>
    <td>📹 <b>会话录制</b></td>
    <td>记录和回放终端会话，用于审计和培训</td>
  </tr>
  <tr>
    <td>🔑 <b>WebAuthn支持</b></td>
    <td>集成硬件安全密钥的无密码认证</td>
  </tr>
  <tr>
    <td>📱 <b>移动应用</b></td>
    <td>原生iOS和Android客户端</td>
  </tr>
  <tr>
    <td>🔌 <b>协议扩展</b></td>
    <td>支持更多协议如Telnet、RDP和VNC</td>
  </tr>
</table>

## 社区与支持

- [用户文档](https://docs.easyssh.example.com)
- [问题报告](https://github.com/shan-hee/easyssh/issues)

## 贡献

欢迎贡献代码、提出问题或建议！请查看[CONTRIBUTING.md](CONTRIBUTING.md)了解如何参与项目。

## 许可证

本项目采用[Apache License 2.0](LICENSE)开源。

---

<div align="center">
  <strong>EasySSH</strong> - 让远程服务器管理变得简单高效
  <br/>
  由❤️打造
</div> 