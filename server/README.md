# EasySSH 服务器端文档

## 混合存储架构详解 (SQLite + node-cache)

EasySSH服务器端采用SQLite + node-cache混合存储架构，为用户数据管理提供高性能、高可靠性的解决方案。本文档详细说明混合存储的实现原理、数据流设计和关键组件。

### 架构概述

```
                  ┌──────────────┐
                  │ 客户端请求   │
                  └───────┬──────┘
                          │
                          ▼
                  ┌──────────────┐
                  │ Express 服务 │
                  └───────┬──────┘
                          │
         ┌────────────────┴────────────────┐
         │                                 │
         ▼                                 ▼
┌─────────────────┐              ┌──────────────────┐
│  数据访问层     │              │  WebSocket服务   │
└────────┬────────┘              └────────┬─────────┘
         │                                │
         ▼                                ▼
    ┌─────────┐                     ┌──────────┐
    │node-cache│◄────────────────►  │ SSH连接  │
    └────┬────┘                     └──────────┘
         │
         ▼
    ┌─────────┐
    │ SQLite  │
    └─────────┘
```

### 关键组件

1. **node-cache**: 高速内存缓存系统，用于存储临时数据和会话信息
2. **SQLite**: 轻量级本地数据库，用于持久化存储用户信息和服务器配置
3. **数据访问层**: 管理混合存储逻辑，协调缓存和持久化操作
4. **Express服务**: 提供RESTful API接口和静态资源服务
5. **WebSocket服务**: 处理SSH终端连接的实时双向通信

### 数据流程

#### 读取操作流程

1. **请求接收** - API接收客户端请求
2. **权限验证** - 验证用户身份和权限
3. **缓存查询** - 首先尝试从node-cache获取数据
4. **缓存命中处理** - 如果数据存在于node-cache中，直接返回
5. **缓存未命中处理** - 如果node-cache中没有数据，查询SQLite
6. **数据加载与缓存** - 从SQLite获取数据，并写入node-cache缓存
7. **响应返回** - 将数据返回给客户端

#### 写入操作流程

1. **请求验证** - 验证请求合法性和数据有效性
2. **权限检查** - 确认用户有权执行写操作
3. **SQLite存储** - 将数据写入SQLite进行持久化
4. **缓存处理** - 使相关node-cache缓存失效或更新
5. **响应生成** - 生成成功/失败响应
6. **返回结果** - 向客户端返回操作结果

## 数据模型设计

### 用户模型 (User)

```javascript
// User类定义
class User {
  constructor(data = {}) {
    this.id = data.id;
    this.username = data.username;
    this.email = data.email;
    this.password = data.password;
    this.profile = data.profile ? (typeof data.profile === 'string' ? JSON.parse(data.profile) : data.profile) : {
      displayName: '',
      avatar: '',
      bio: '',
      location: ''
    };
    this.settings = data.settings ? (typeof data.settings === 'string' ? JSON.parse(data.settings) : data.settings) : {
      theme: 'light',
      fontSize: 14,
      sshConfig: {
        defaultTimeout: 10000,
        keepAliveInterval: 30000
      }
    };
    this.isAdmin = data.isAdmin || false;
    this.status = data.status || 'active';
    this.lastLogin = data.lastLogin;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  // ...方法实现
}
```

### 服务器模型 (Server)

```javascript
// Server类定义
class Server {
  constructor(data = {}) {
    this.id = data.id;
    this.name = data.name;
    this.host = data.host;
    this.port = data.port || 22;
    this.username = data.username;
    this.password = data.password;
    this.privateKey = data.privateKey;
    this.usePrivateKey = data.usePrivateKey || false;
    this.description = data.description || '';
    this.tags = data.tags || [];
    this.timeout = data.timeout || 10000;
    this.lastConnected = data.lastConnected;
    this.connectionCount = data.connectionCount || 0;
    this.owner = data.owner;
    this.shared = {
      isShared: data.shared || false,
      sharedWith: data.sharedWith ? JSON.parse(data.sharedWith) : []
    };
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  // ...方法实现
}
```

## node-cache数据结构

node-cache作为内存缓存系统，存储多种类型的临时数据：

### 用户数据缓存

- **键**: `user:{userId}`
- **值**: 用户完整信息(不含敏感字段)
- **过期时间**: 24小时

### 服务器配置缓存

- **键**: `server:{serverId}`
- **值**: 服务器配置(不含密码和密钥)
- **过期时间**: 1小时

### 用户服务器列表缓存

- **键**: `servers:user:{userId}`
- **值**: 用户所有服务器列表
- **过期时间**: 1小时

### 会话令牌

- **键**: `token:{tokenString}`
- **值**: { userId, valid: true/false }
- **过期时间**: 24小时

### 用户会话集合

- **键**: `user:sessions:{userId}`
- **值**: 活动会话令牌数组
- **过期时间**: 30天

## 数据库配置

SQLite数据库在服务启动时自动创建和初始化。数据库文件存储在`server/data`目录中。

### 表结构

#### 用户表(users)

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  profile TEXT,
  settings TEXT,
  isAdmin INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  lastLogin TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)
```

#### 服务器表(servers)

```sql
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER DEFAULT 22,
  username TEXT NOT NULL,
  password TEXT,
  privateKey TEXT,
  usePrivateKey INTEGER DEFAULT 0,
  description TEXT,
  tags TEXT,
  timeout INTEGER DEFAULT 10000,
  lastConnected TEXT,
  connectionCount INTEGER DEFAULT 0,
  owner INTEGER NOT NULL,
  shared INTEGER DEFAULT 0,
  sharedWith TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (owner) REFERENCES users (id)
)
```

## 数据库连接配置

```javascript
// 数据库连接配置
const connectDatabase = () => {
  if (dbConnected && db) return db;
  
  try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = DELETE'); // 直接写入主库（不使用WAL）
    dbConnected = true;
    
    // 创建表结构...
    
    return db;
  } catch (error) {
    console.error('SQLite数据库连接失败:', error);
    throw error;
  }
};
```

## Connections API（连接管理接口）

以下为与“我的连接/收藏/历史/置顶”相关的主要接口说明（全部需登录鉴权）。

- GET `/api/connections`
  - 返回当前用户的连接配置列表。

- POST `/api/connections`
  - 新建连接配置。

- PUT `/api/connections/:id`
  - 更新连接配置。

- DELETE `/api/connections/:id`
  - 删除连接配置（同时清理关联的收藏、历史、置顶）。

- GET `/api/connections/favorites`
  - 返回收藏连接的 ID 列表。

- POST `/api/connections/favorites`
  - 全量更新收藏列表（传入 ID 数组）。

- GET `/api/connections/history`
  - 返回最近 20 条历史连接，按时间倒序。
  - 字段：
    - `entryId` 历史记录自增 ID（用于单条删除）
    - `id` 连接配置 ID（connection_id）
    - `name`、`host`、`port`、`username`、`description`、`group`、`authType`、`timestamp`

- POST `/api/connections/history`
  - 新增历史记录。请求体仅需携带一条最近新增的历史（数组第 1 项被处理）：
  
  ```json
  {
    "history": [
      { "id": "<connection_id>", "host": "...", "username": "...", "port": 22, "name": "...", "description": "...", "timestamp": 1710000000000 }
    ]
  }
  ```
  
  - 服务器无条件 `INSERT` 一条新历史，并仅保留最近 20 条。
  - 响应包含新记录的 `entryId`：
  
  ```json
  { "success": true, "message": "已添加到历史记录", "entryId": 123 }
  ```

- DELETE `/api/connections/history/entry/:entryId`
  - 按单条历史记录自增 ID 删除（推荐）。

- DELETE `/api/connections/history`
  - 清空当前用户的所有历史记录。

- GET `/api/connections/pinned`
  - 返回置顶映射 `{ [connectionId]: pinnedAt }`。

- POST `/api/connections/pinned`
  - 全量更新置顶映射（pinnedAt 为毫秒时间戳）。

- GET `/api/connections/overview`
  - 汇总返回 connections/favorites/history/pinned 四类数据，用于减少首屏往返；`history` 条目同样包含 `entryId`。

变更记录（历史逻辑）
- 历史记录改为“无条件新增”模式：每次发起连接都会插入一条；仅保留最近 20 条。
- 历史查询新增 `entryId` 字段；新增按条删除接口 `DELETE /api/connections/history/entry/:entryId`。
- 旧的 `DELETE /api/connections/history/:id`（按 connection_id 删除全部历史）已移除。

## 服务层实现

## User Settings API（用户设置接口）

为满足“最小化数据获取”的要求，新增了一个仅用于终端初始化场景的最小设置接口：

- GET `/api/users/settings/terminal/minimal`
  - 说明：仅返回创建终端会话必需的用户终端设置字段，并包含 AI 启用状态与终端背景设置；避免多拿数据。
  - 鉴权：需要登录（与其它设置接口一致）。
  - 返回结构：
    - `data.terminal`: 严格白名单的终端字段：`fontFamily`, `fontSize`, `lineHeight`, `cursorStyle`, `cursorBlink`, `scrollback`, `rendererType`, `fallbackRenderer`, `copyOnSelect`, `rightClickSelectsWord`, `theme`
    - `data.terminalBackground`: 终端背景设置（仅白名单字段）：`enabled`, `url`, `opacity`, `mode`
    - `data.ai.enabled`: 布尔值，仅表示 AI 启用/禁用（无敏感字段）
  - 响应示例：
  ```json
  {
    "success": true,
    "data": {
      "terminal": {
        "fontFamily": "'JetBrains Mono'",
        "fontSize": 16,
        "cursorStyle": "block",
        "cursorBlink": true,
        "theme": "dark"
      },
      "terminalBackground": {
        "enabled": true,
        "url": "https://example.com/wallpaper.jpg",
        "opacity": 0.5,
        "mode": "cover"
      },
      "ai": { "enabled": false }
    }
  }
  ```


### 用户服务

```javascript
// 用户服务示例片段

// 获取用户 (node-cache缓存 -> SQLite)
async getUserById(userId) {
  // 优先从node-cache缓存获取
  // 缓存未命中则从SQLite获取并缓存
}

// 创建用户会话 (存储在node-cache)
async createUserSession(userId, token) {
  // 将会话数据和令牌映射存储到node-cache
}

// 更新用户 (更新SQLite，删除node-cache缓存)
async updateUser(userId, userData) {
  // 更新SQLite数据
  // 删除相关node-cache缓存
}
```

### 服务器配置服务

```javascript
// 服务器配置服务示例片段

// 获取服务器列表 (node-cache缓存 -> SQLite)
async getServersByUser(userId) {
  // 优先从node-cache缓存获取
  // 缓存未命中则从SQLite获取并缓存
}

// 获取单个服务器 (node-cache缓存 -> SQLite)
async getServerById(serverId, includeCredentials) {
  // 优先从node-cache缓存获取(当不需要凭证时)
  // 缓存未命中则从SQLite获取
  // 需要凭证时直接从SQLite获取并解密
}
```

## 身份验证流程

1. **登录请求** - 用户提交用户名和密码
2. **凭证验证** - 与数据库中的哈希密码比较
3. **生成令牌** - 创建包含用户ID的JWT令牌
4. **存储会话** - 在node-cache中存储会话信息
5. **返回令牌** - 将令牌返回给客户端

### 中间件验证

```javascript
// 验证令牌并检查node-cache中的会话状态
const authMiddleware = async (req, res, next) => {
  // 从请求头中提取令牌
  // 验证JWT签名和有效期
  // 检查node-cache中的会话状态
  // 加载用户信息并附加到请求对象
};
```

## WebSocket SSH连接管理

WebSocket服务器处理SSH终端连接请求：

1. **连接验证** - 验证WebSocket连接中的令牌
2. **服务器信息获取** - 从SQLite中获取服务器信息和解密凭证
3. **SSH连接建立** - 使用ssh2库建立与远程服务器的连接
4. **数据转发** - 在WebSocket客户端和SSH连接之间转发数据
5. **会话管理** - 管理连接生命周期和资源释放

## 系统安全设计

### 数据安全

- **密码存储**: 使用bcrypt进行密码哈希
- **敏感信息加密**: 使用AES-256加密存储服务器密码和私钥
- **令牌安全**: 短期JWT令牌，支持失效和刷新
- **令牌信息存储在node-cache中，支持即时失效

### API安全

- **输入验证**: 所有API输入进行严格验证
- **权限控制**: 基于用户ID和角色的细粒度权限控制
- **限流措施**: 防止暴力攻击和DoS攻击
- **CORS配置**: 限制跨域请求来源

## 性能优化

### 查询优化

- **索引使用**: 为频繁查询的字段创建索引
- **查询简化**: 减少不必要的连接操作
- **结果投影**: 只查询需要的字段

### 缓存优化

- **TTL自动过期**: 通过node-cache的过期机制自动清理过期数据
- **选择性缓存**: 根据访问频率和数据量确定缓存策略
- **缓存预热**: 对热点数据进行预加载

### SQLite优化

- **预备语句**: 使用预备语句减少解析开销
- **事务处理**: 批量操作使用事务提高性能
- **日志模式**: 使用DELETE模式直接写入主库

### node-cache优化

- **缓存命中率**: 监控缓存命中率，优化缓存策略
- **数据压缩**: 大对象考虑压缩处理
- **克隆关闭**: 关闭数据克隆提高性能

## 容错与高可用

- **graceful退出**: 优雅处理进程退出，确保数据完整性
- **自动重连**: 数据库连接中断自动重新连接
- **写操作保障**: 确保写入操作优先持久化到SQLite
- **缓存失效**: node-cache连接失败时优雅降级至直接查询SQLite

## 监控与调试

- **日志分级**: 使用不同级别的日志记录系统状态
- **性能指标收集**: 记录关键操作的性能指标
- **缓存命中率**: 监控缓存效率
- **错误跟踪**: 详细记录异常情况，支持问题排查

## 测试策略

- **单元测试**: 测试关键组件功能
- **集成测试**: 测试组件间交互
- **模拟SQLite**: 使用内存SQLite进行测试
- **模拟node-cache接口**: 测试缓存逻辑
- **压力测试**: 验证系统在高负载下的性能表现

## 环境要求

- Node.js >= 16.0.0
- SQLite >= 3.0.0

## 环境变量配置

```
# 基本配置
NODE_ENV=development
PORT=8520

# 安全配置
JWT_SECRET=your_jwt_secret_key
ENCRYPTION_KEY=your_encryption_key

# SQLite配置
SQLITE_PATH=./data/easyssh.sqlite
```

## 安装与运行

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 生产模式运行
npm start
```

## 系统监控功能

EasySSH提供了基于SSH的零安装系统监控功能，可以实时监控远程服务器的CPU、内存、磁盘等资源使用情况。无需在远程服务器上安装任何额外组件。

### 监控数据指标

- **CPU信息**：使用率、核心数、型号、负载平均值
- **内存信息**：使用情况、总量、可用量、使用率
- **交换分区信息**：使用情况、总量、可用量、使用率
- **磁盘信息**：使用情况、总量、可用量、使用率
- **网络状态**：实时流量传输统计、网络接口信息
- **操作系统信息**：类型、平台、版本、运行时间、发行版信息
- **IP地址**：内网IP、公网IP
- **进程信息**：总进程数、运行状态统计

### 工作原理

1. **SSH集成**：基于现有SSH连接，无需安装额外组件
2. **命令收集**：通过SSH执行系统命令获取监控数据
3. **数据传输**：通过专用WebSocket通道传输监控数据
4. **实时更新**：每秒自动更新一次系统数据（可配置）
5. **智能缓存**：IP地址等信息采用智能缓存策略，减少系统负载
6. **自动启停**：SSH连接建立/断开时自动启动/停止监控

### 技术优势

- **零安装**：无需在服务器上安装任何额外组件
- **安全可靠**：基于现有SSH安全通道
- **轻量级**：通过系统命令收集数据，资源占用极少
- **即开即用**：SSH连接后立即可用监控功能
- **高性能**：优化的数据收集和传输机制
- **容错性强**：具备完善的错误处理和重试机制

### 使用方法

1. **建立SSH连接**：在EasySSH中连接到远程服务器
2. **自动启动监控**：SSH连接成功后，监控数据收集自动开始
3. **查看监控数据**：在工具栏中查看实时系统监控信息
4. **监控面板**：点击监控按钮可查看详细的系统监控面板

### 技术实现

- **数据收集**：通过SSH执行系统命令（如free、df、cat /proc/*等）获取监控数据
- **数据传输**：通过专用WebSocket通道（/monitor）传输监控数据
- **实时更新**：默认每秒更新一次监控数据，支持动态调整间隔
- **智能缓存**：静态信息（如CPU型号）和IP地址采用智能缓存策略
- **安全传输**：基于现有SSH安全通道，无需额外认证
- **性能优化**：并行数据收集、批量传输、错误重试等优化机制
