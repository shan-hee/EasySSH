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

EasySSH 系统监控采用"客户端主动连接，服务端被动接受"的轻量级工作模式：

1. **客户端模式**：监控客户端主动连接到EasySSH服务器的WebSocket端点
2. **服务端模式**：EasySSH服务器提供WebSocket监控端点，接收客户端连接
3. **数据传输**：连接建立后，客户端每3秒自动推送一次系统数据
4. **心跳检测**：双向心跳机制，确保连接稳定性
5. **智能重连**：断线自动重连，采用指数退避策略，最大程度保证连接可靠性
6. **极致轻量**：零第三方依赖系统信息收集，最小资源占用

这种设计具有以下优势：
- **更好的网络兼容性**：客户端主动连接，更容易穿透防火墙和NAT
- **极致性能**：使用原生系统命令收集数据，无第三方库依赖
- **资源友好**：内存占用 < 128MB，CPU限制 < 50%
- **面向中小型群体**：简化部署，降低维护成本

### 安全特性

轻量级监控客户端具有以下安全特性：

1. **主动连接验证**：客户端仅连接到配置文件中指定的EasySSH服务器地址
2. **连接加密**：支持WebSocket over TLS (WSS) 加密传输
3. **数据隔离**：监控数据仅发送到指定的EasySSH服务器
4. **资源限制**：系统服务配置了内存和CPU使用限制，防止资源滥用
5. **日志审计**：所有连接和错误信息都记录到系统日志中

> **注意**：客户端会主动连接到您指定的EasySSH服务器。请确保服务器地址正确且可访问。

### 安装监控客户端

#### 方式一：从EasySSH服务器安装（推荐）

在远程服务器终端中执行以下命令：

```bash
curl -sSL http://你的EasySSH服务器地址:端口/api/monitor/download-script -o easyssh-monitor-install.sh && \
chmod +x easyssh-monitor-install.sh && \
sudo env EASYSSH_SERVER=你的EasySSH服务器地址:端口 ./easyssh-monitor-install.sh
```

#### 方式二：从GitHub直接安装

您也可以从GitHub获取最新的安装脚本：

```bash
curl -L https://raw.githubusercontent.com/shan-hee/EasySSH/main/server/scripts/easyssh-monitor-install.sh -o easyssh-monitor-install.sh && \
chmod +x easyssh-monitor-install.sh && \
sudo env EASYSSH_SERVER=你的EasySSH服务器地址:端口 ./easyssh-monitor-install.sh
```

#### 环境变量说明

> **必须设置 `EASYSSH_SERVER` 环境变量**，否则安装将会失败。
>
> 服务器地址支持两种格式：
> - 纯域名/IP格式：`example.com` 或 `192.168.1.1`（将使用默认端口3000）
> - 域名/IP+端口格式：`example.com:3000` 或 `192.168.1.1:8080`

### 卸载监控客户端

若需卸载监控客户端，执行以下命令：

```bash
# 方式一：从EasySSH服务器获取卸载脚本
curl -sSL http://你的EasySSH服务器地址:端口/api/monitor/uninstall-script | sudo bash

# 方式二：从GitHub获取卸载脚本
curl -L https://raw.githubusercontent.com/shan-hee/EasySSH/main/server/scripts/easyssh-monitor-uninstall.sh -o easyssh-monitor-uninstall.sh && \
chmod +x easyssh-monitor-uninstall.sh && \
sudo ./easyssh-monitor-uninstall.sh
```

### 查看监控日志

监控服务安装后会作为系统服务运行，您可以通过以下命令查看监控服务的运行状态和日志：

#### 查看服务状态
```bash
sudo systemctl status easyssh-monitor
```

#### 查看实时日志
```bash
sudo journalctl -u easyssh-monitor -f
```

#### 查看历史日志
```bash
# 查看最近100行日志
sudo journalctl -u easyssh-monitor -n 100

# 查看今天的日志
sudo journalctl -u easyssh-monitor --since today

# 查看最近1小时的日志
sudo journalctl -u easyssh-monitor --since "1 hour ago"

# 查看指定时间范围的日志
sudo journalctl -u easyssh-monitor --since "2024-01-01 00:00:00" --until "2024-01-01 23:59:59"
```

#### 重启监控服务
```bash
sudo systemctl restart easyssh-monitor
```

#### 停止监控服务
```bash
sudo systemctl stop easyssh-monitor
```

#### 启动监控服务
```bash
sudo systemctl start easyssh-monitor
```

### 环境变量说明

| 变量名 | 说明 | 是否必填 | 默认值 | 示例值 |
|-------|------|---------|--------|-------|
| EASYSSH_SERVER | EasySSH服务器地址（可带可不带端口） | **必填** | 无 | `example.com:3000` 或 `192.168.1.1` |

### 配置文件说明

安装完成后，配置文件位于 `/opt/easyssh-monitor/config.json`：

```json
{
  "serverHost": "your-easyssh-server.com",
  "serverPort": 3000,
  "reconnectInterval": 5000,
  "maxReconnectAttempts": -1,
  "heartbeatInterval": 30000
}
```

| 配置项 | 说明 | 默认值 |
|-------|------|--------|
| serverHost | EasySSH服务器主机地址 | 从环境变量解析 |
| serverPort | EasySSH服务器端口 | 3000 |
| reconnectInterval | 重连间隔（毫秒） | 5000 |
| maxReconnectAttempts | 最大重连次数（-1为无限） | -1 |
| heartbeatInterval | 心跳间隔（毫秒） | 30000 |