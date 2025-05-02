## 系统监控功能

EasySSH 提供了强大的系统监控功能，可以实时查看远程服务器的系统状态。

### 支持的监控指标

- **CPU使用率**：实时显示CPU使用率百分比
- **内存使用情况**：显示系统内存使用量、总量和使用率百分比
- **交换分区**：显示交换分区使用情况和百分比
- **磁盘使用情况**：显示主分区的使用情况、总量和可用空间
- **网络状态**：显示网络连接数和实时流量传输统计
- **系统信息**：显示操作系统类型、版本、主机名和运行时间
- **进程信息**：显示系统中占用资源最多的进程列表
- **磁盘IO**：显示磁盘读写性能监控(Linux系统)
- **用户登录信息**：显示当前登录系统的用户列表(Linux系统)

### 监控工作模式

EasySSH 系统监控采用"服务端主动连接，客户端被动接受"的工作模式：

1. **客户端模式**：安装后在客户端启动WebSocket服务器，等待服务端的连接
2. **服务端模式**：主动连接到客户端的WebSocket服务器，接收监控数据
3. **数据传输**：连接建立后，客户端每1.5秒自动推送一次系统数据
4. **心跳检测**：服务端发送ping消息，客户端响应pong消息
5. **安全机制**：客户端仅接受来自指定服务器IP的连接请求，拒绝未授权的访问
6. **健康检查**：提供公开访问的健康检查端点(/health)，用于验证服务状态

这种设计避免了客户端需要主动穿透防火墙连接服务端的问题，提高了连接的可靠性。同时，IP验证机制确保监控数据只发送给授权的服务器，防止敏感信息泄露。

### 安全特性

系统监控组件具有以下安全特性，保护您的监控数据：

1. **IP地址验证**：客户端将验证连接请求的来源IP是否与安装时指定的服务器地址匹配
2. **连接拒绝**：对于来自未授权IP的连接请求，客户端会自动拒绝并断开连接
3. **错误日志**：未授权的连接尝试会被记录到日志中，方便管理员审计
4. **健康检查**：健康检查端点(/health)支持跨域访问，方便外部服务监控
5. **数据隔离**：监控数据仅通过WebSocket传输，且仅接受来自授权服务器的连接

> **注意**：请确保您提供的服务器地址是准确的，且具有静态IP。如果服务器IP发生变化，客户端将拒绝连接请求。

### 安装监控服务

#### 使用环境变量安装（推荐）

在远程服务器终端中执行以下命令，通过环境变量指定监控服务器地址（必填）：

```bash
curl -sSL http://你的服务器地址:端口/api/monitor/install-script -o easyssh-monitor-install.sh && \
chmod +x easyssh-monitor-install.sh && \
sudo env EASYSSH_SERVER=你的服务器地址 ./easyssh-monitor-install.sh
```

> **注意**：必须设置 `EASYSSH_SERVER` 环境变量，否则安装将会失败。
> 
> 服务器地址支持两种格式：
> - 纯域名/IP格式：`example.com` 或 `192.168.1.1`（将使用默认端口9527）
> - 域名/IP+端口格式：`example.com:3000` 或 `192.168.1.1:8080`

#### 从GitHub直接安装

您也可以从GitHub获取最新的安装脚本：

```bash
curl -L https://raw.githubusercontent.com/shan-hee/EasySSH/main/server/scripts/easyssh-monitor-install.sh -o easyssh-monitor-install.sh && \
chmod +x easyssh-monitor-install.sh && \
sudo env EASYSSH_SERVER=你的服务器地址 ./easyssh-monitor-install.sh
```

### 卸载监控服务

若需卸载监控服务，执行以下命令：

```bash
curl -sSL http://你的服务器地址:端口/api/monitor/uninstall-script | sudo bash
```

或者从GitHub获取卸载脚本：

```bash
curl -L https://raw.githubusercontent.com/shan-hee/EasySSH/main/server/scripts/easyssh-monitor-uninstall.sh -o easyssh-monitor-uninstall.sh && \
chmod +x easyssh-monitor-uninstall.sh && \
sudo ./easyssh-monitor-uninstall.sh
```


### 环境变量说明

| 变量名 | 说明 | 是否必填 | 示例值 |
|-------|------|---------|-------|
| EASYSSH_SERVER | 监控服务器地址（可带可不带端口） | **必填** | example.com 或 192.168.1.1:3000 |

