#!/bin/bash

echo "正在安装EasySSH轻量级监控组件..."

# 从环境变量获取服务器地址
if [ -z "$EASYSSH_SERVER" ]; then
    echo "错误: 必须设置EASYSSH_SERVER环境变量"
    echo "请使用以下格式重新运行安装脚本:"
    echo "sudo env EASYSSH_SERVER=你的服务器地址[:端口] ./easyssh-monitor-install.sh"
    exit 1
fi

SERVER_ADDR=${EASYSSH_SERVER}

# 检查是否已安装 node (只需要node，不需要npm)
if ! command -v node &> /dev/null; then
    echo "检测到未安装 Node.js，正在安装..."

    # 检测操作系统类型
    if [ -f /etc/debian_version ]; then
        # Debian/Ubuntu
        sudo apt-get update
        sudo apt-get install -y curl
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [ -f /etc/redhat-release ]; then
        # CentOS/RHEL
        sudo yum install -y curl
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo yum install -y nodejs
    else
        echo "不支持的操作系统，请手动安装 Node.js 20+"
        exit 1
    fi
fi

# 创建监控程序目录
MONITOR_DIR="/opt/easyssh-monitor"
sudo mkdir -p $MONITOR_DIR

# 初始化变量
SERVER_PROTOCOL=""
SERVER_HOST=""
SERVER_PORT=""
WS_PROTOCOL=""

# 检查是否包含协议
if [[ "$SERVER_ADDR" == http://* ]]; then
    SERVER_PROTOCOL="http"
    WS_PROTOCOL="ws"
    # 移除 http:// 前缀
    ADDR_WITHOUT_PROTOCOL="${SERVER_ADDR#http://}"
elif [[ "$SERVER_ADDR" == https://* ]]; then
    SERVER_PROTOCOL="https"
    WS_PROTOCOL="wss"
    # 移除 https:// 前缀
    ADDR_WITHOUT_PROTOCOL="${SERVER_ADDR#https://}"
else
    # 没有协议，默认为http
    SERVER_PROTOCOL="http"
    WS_PROTOCOL="ws"
    ADDR_WITHOUT_PROTOCOL="$SERVER_ADDR"
fi

# 解析主机名和端口
if [[ "$ADDR_WITHOUT_PROTOCOL" == *":"* ]]; then
    # 包含端口
    SERVER_HOST=$(echo "$ADDR_WITHOUT_PROTOCOL" | cut -d':' -f1)
    SERVER_PORT=$(echo "$ADDR_WITHOUT_PROTOCOL" | cut -d':' -f2)
    # 移除可能的路径部分
    SERVER_PORT=$(echo "$SERVER_PORT" | cut -d'/' -f1)
else
    # 不包含端口，使用默认端口
    SERVER_HOST=$(echo "$ADDR_WITHOUT_PROTOCOL" | cut -d'/' -f1)
    if [[ "$SERVER_PROTOCOL" == "https" ]]; then
        SERVER_PORT="443"
    else
        SERVER_PORT="8520"  # EasySSH前端服务默认端口
    fi
fi

# 创建配置文件
cat > /tmp/config.json << EOL
{
  "serverProtocol": "${SERVER_PROTOCOL}",
  "serverHost": "${SERVER_HOST}",
  "serverPort": ${SERVER_PORT},
  "wsProtocol": "${WS_PROTOCOL}",
  "reconnectInterval": 5000,
  "maxReconnectAttempts": -1,
  "heartbeatInterval": 30000
}
EOL

if node -e "JSON.parse(require('fs').readFileSync('/tmp/config.json', 'utf8'));" 2>/dev/null; then
    echo "✅ 配置文件生成成功"
else
    echo "❌ 配置文件格式错误，请检查服务器地址格式"
    exit 1
fi

# 复制配置文件到监控目录
sudo cp /tmp/config.json $MONITOR_DIR/

# 创建轻量级监控程序文件
cat > /tmp/monitor.js << 'EOL'
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const http = require('http');
const https = require('https');

// 读取配置文件
let config;
try {
  const configData = fs.readFileSync('./config.json');
  config = JSON.parse(configData);

  // 验证服务器配置
  if (!config.serverHost || !config.serverPort || !config.wsProtocol) {
    console.error('错误: 服务器配置不完整，需要的配置项: serverHost, serverPort, wsProtocol');
    process.exit(1);
  }
} catch (err) {
  console.error('配置文件读取失败:', err.message);
  process.exit(1);
}

// WebSocket客户端实现（原生）
class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = config.maxReconnectAttempts || -1;
    this.reconnectInterval = config.reconnectInterval || 5000;
    this.heartbeatInterval = config.heartbeatInterval || 30000;
    this.heartbeatTimer = null;
    this.hostIdLogged = false; // 用于控制主机标识符日志只输出一次
  }

  connect() {
    try {
      // 使用原生WebSocket (Node.js 内置)
      const WebSocket = require('ws');
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        console.log(`已连接到EasySSH服务器: ${this.url}`);
        this.connected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.startDataTransmission();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (err) {
          console.error('处理服务器消息失败:', err.message);
        }
      });

      this.ws.on('close', () => {
        if (this.connected) {
          console.log('与EasySSH服务器的连接已断开');
        }
        this.connected = false;
        this.stopHeartbeat();
        this.stopDataTransmission();
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket连接错误:', error.message);
        this.connected = false;
      });

    } catch (err) {
      console.error('创建WebSocket连接失败:', err);
      this.scheduleReconnect();
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case 'ping':
        this.send({ type: 'pong', timestamp: Date.now() });
        break;
      case 'get_system_stats':
        this.sendSystemInfo();
        break;
      case 'stats_received':
        // 处理后端发送的数据接收确认消息
        // 这表明后端已成功接收并处理了我们发送的系统统计信息
        // 可以在这里添加统计信息或调试日志
        break;
      case 'session_created':
        // 处理后端发送的会话创建确认消息
        // 这表明监控客户端与后端的连接已成功建立
        // 消息包含sessionId和connectionType等信息
        if (message.data && message.data.sessionId) {
          console.log(`监控会话已创建: ${message.data.sessionId}`);
        }
        break;
      default:
        // 只记录未知消息类型
        if (message.type !== 'pong') {
          console.log('收到未知消息类型:', message.type);
        }
    }
  }

  send(data) {
    if (this.connected && this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping', timestamp: Date.now() });
    }, this.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  stopDataTransmission() {
    if (this.dataTimer) {
      clearInterval(this.dataTimer);
      this.dataTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.maxReconnectAttempts !== -1 && this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('达到最大重连次数，停止重连');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1), 60000);

    // 只在前几次重连时输出日志，避免日志过多
    if (this.reconnectAttempts <= 3) {
      console.log(`${delay/1000}秒后尝试第${this.reconnectAttempts}次重连...`);
    }
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  startDataTransmission() {
    // 确保清理之前的定时器
    this.stopDataTransmission();

    // 立即发送一次系统信息
    this.sendSystemInfo();

    // 每3秒发送一次系统信息
    this.dataTimer = setInterval(() => {
      this.sendSystemInfo();
    }, 3000);
  }

  async sendSystemInfo() {
    if (!this.connected) return;

    try {
      const systemInfo = await getSystemInfo();

      // 生成唯一的主机标识符 (hostname@ip)
      const hostname = systemInfo.os.hostname;
      const ipAddress = systemInfo.ip.internal;
      const hostId = `${hostname}@${ipAddress}`;

      // 首次连接时输出主机标识符信息
      if (!this.hostIdLogged) {
        console.log(`主机标识符: ${hostId} (hostname: ${hostname}, ip: ${ipAddress})`);
        this.hostIdLogged = true;
      }

      this.send({
        type: 'system_stats',
        hostId: hostId,  // 添加唯一主机标识符
        payload: {
          ...systemInfo,
          hostId: hostId  // 在payload中也包含hostId
        }
      });
    } catch (err) {
      console.error('获取系统信息失败:', err.message);
    }
  }
}

// 轻量级系统信息收集模块
async function getSystemInfo() {
  const info = {
    timestamp: Date.now(),
    machineId: await getMachineId(),
    cpu: await getCpuInfo(),
    memory: await getMemoryInfo(),
    swap: await getSwapInfo(),
    disk: await getDiskInfo(),
    network: await getNetworkInfo(),
    os: getOsInfo(),
    ip: await getIpInfo(),
    location: await getLocationInfo()
  };

  return info;
}

// 获取机器唯一标识
async function getMachineId() {
  return new Promise((resolve) => {
    if (process.platform === 'linux') {
      exec('cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null || echo ""', (error, stdout) => {
        if (!error && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          resolve(`${os.hostname()}-${os.cpus()[0].model.replace(/\s+/g, '-')}`);
        }
      });
    } else {
      resolve(`${os.hostname()}-${os.cpus()[0].model.replace(/\s+/g, '-')}`);
    }
  });
}

// 获取CPU信息
async function getCpuInfo() {
  return new Promise((resolve) => {
    // 获取CPU使用率
    exec('top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk \'{print 100 - $1}\'', (error, stdout) => {
      const usage = error ? 0 : parseFloat(stdout.trim()) || 0;

      const cpus = os.cpus();
      resolve({
        usage: Math.round(usage * 100) / 100,
        cores: cpus.length,
        model: cpus[0].model
      });
    });
  });
}

// 获取内存信息
async function getMemoryInfo() {
  return new Promise((resolve) => {
    exec('free -m', (error, stdout) => {
      if (error) {
        resolve({ total: 0, used: 0, free: 0, usedPercentage: 0 });
        return;
      }

      const lines = stdout.trim().split('\n');
      const memLine = lines.find(line => line.startsWith('Mem:'));

      if (memLine) {
        const parts = memLine.split(/\s+/);
        const total = parseInt(parts[1]) || 0;
        const used = parseInt(parts[2]) || 0;
        const free = parseInt(parts[3]) || 0;

        resolve({
          total,
          used,
          free,
          usedPercentage: total > 0 ? Math.round((used / total) * 100 * 100) / 100 : 0
        });
      } else {
        resolve({ total: 0, used: 0, free: 0, usedPercentage: 0 });
      }
    });
  });
}

// 获取交换分区信息
async function getSwapInfo() {
  return new Promise((resolve) => {
    exec('free -m', (error, stdout) => {
      if (error) {
        resolve({ total: 0, used: 0, free: 0, usedPercentage: 0 });
        return;
      }

      const lines = stdout.trim().split('\n');
      const swapLine = lines.find(line => line.startsWith('Swap:'));

      if (swapLine) {
        const parts = swapLine.split(/\s+/);
        const total = parseInt(parts[1]) || 0;
        const used = parseInt(parts[2]) || 0;
        const free = parseInt(parts[3]) || 0;

        resolve({
          total,
          used,
          free,
          usedPercentage: total > 0 ? Math.round((used / total) * 100 * 100) / 100 : 0
        });
      } else {
        resolve({ total: 0, used: 0, free: 0, usedPercentage: 0 });
      }
    });
  });
}

// 获取磁盘信息
async function getDiskInfo() {
  return new Promise((resolve) => {
    exec('df -h / | tail -1', (error, stdout) => {
      if (error) {
        resolve({ total: 0, used: 0, free: 0, usedPercentage: 0 });
        return;
      }

      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 5) {
        const total = parseFloat(parts[1].replace('G', '')) || 0;
        const used = parseFloat(parts[2].replace('G', '')) || 0;
        const free = parseFloat(parts[3].replace('G', '')) || 0;
        const usedPercentage = parseFloat(parts[4].replace('%', '')) || 0;

        resolve({
          total: Math.round(total * 100) / 100,
          used: Math.round(used * 100) / 100,
          free: Math.round(free * 100) / 100,
          usedPercentage
        });
      } else {
        resolve({ total: 0, used: 0, free: 0, usedPercentage: 0 });
      }
    });
  });
}

// 网络状态缓存
let lastNetworkStats = { rx_bytes: 0, tx_bytes: 0, timestamp: Date.now() };

// IP地址缓存
let ipCache = {
  internal: null,
  public: null,
  lastInternalUpdate: 0,
  lastPublicUpdate: 0,
  publicUpdateInterval: 10 * 60 * 1000, // 公网IP每10分钟更新一次
  internalUpdateInterval: 30 * 1000     // 内网IP每30秒更新一次
};

// 获取网络信息
async function getNetworkInfo() {
  return new Promise((resolve) => {
    exec('cat /proc/net/dev', (error, stdout) => {
      if (error) {
        resolve({ connections: 0, total_rx_speed: "0.00", total_tx_speed: "0.00" });
        return;
      }

      const lines = stdout.trim().split('\n').slice(2);
      const currentTime = Date.now();
      let totalRxBytes = 0;
      let totalTxBytes = 0;

      lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 10) {
          const interfaceName = parts[0].replace(':', '');
          if (interfaceName !== 'lo') {
            totalRxBytes += parseInt(parts[1]) || 0;
            totalTxBytes += parseInt(parts[9]) || 0;
          }
        }
      });

      const timeDiff = (currentTime - lastNetworkStats.timestamp) / 1000;
      let rxSpeed = 0;
      let txSpeed = 0;

      if (timeDiff > 0 && lastNetworkStats.rx_bytes > 0) {
        const rxDiff = totalRxBytes - lastNetworkStats.rx_bytes;
        rxSpeed = (rxDiff / timeDiff / 1024).toFixed(2);

        const txDiff = totalTxBytes - lastNetworkStats.tx_bytes;
        txSpeed = (txDiff / timeDiff / 1024).toFixed(2);
      }

      lastNetworkStats = { rx_bytes: totalRxBytes, tx_bytes: totalTxBytes, timestamp: currentTime };

      // 获取连接数
      exec('netstat -an | grep ESTABLISHED | wc -l', (err, stdout) => {
        const connections = !err ? parseInt(stdout.trim()) : 0;
        resolve({
          connections,
          total_rx_speed: rxSpeed,
          total_tx_speed: txSpeed
        });
      });
    });
  });
}

// 获取操作系统信息
function getOsInfo() {
  return {
    type: os.type(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    uptime: os.uptime(),
    hostname: os.hostname()
  };
}

// 获取IP地址信息（带缓存机制）
async function getIpInfo() {
  const now = Date.now();

  // 检查是否需要更新内网IP
  const needUpdateInternal = !ipCache.internal ||
    (now - ipCache.lastInternalUpdate) > ipCache.internalUpdateInterval;

  // 检查是否需要更新公网IP
  const needUpdatePublic = !ipCache.public ||
    (now - ipCache.lastPublicUpdate) > ipCache.publicUpdateInterval;

  // 如果都不需要更新，直接返回缓存
  if (!needUpdateInternal && !needUpdatePublic) {
    return {
      internal: ipCache.internal,
      public: ipCache.public
    };
  }

  return new Promise((resolve) => {
    // 获取内网IP（如果需要更新）
    if (needUpdateInternal) {
      exec('ip route get 8.8.8.8 | grep -oP "src \\K\\S+" 2>/dev/null || hostname -I | awk \'{print $1}\'', (error, stdout) => {
        let internal = ipCache.internal || '获取失败';

        if (!error && stdout.trim()) {
          internal = stdout.trim().split(' ')[0];
        } else {
          // 备用方法
          exec('ifconfig | grep -Eo "inet (addr:)?([0-9]*\\.){3}[0-9]*" | grep -Eo "([0-9]*\\.){3}[0-9]*" | grep -v "127.0.0.1" | head -1', (err, stdout2) => {
            if (!err && stdout2.trim()) {
              internal = stdout2.trim();
            }
          });
        }

        // 更新内网IP缓存
        if (ipCache.internal !== internal) {
          console.log(`内网IP更新: ${ipCache.internal} -> ${internal}`);
        }
        ipCache.internal = internal;
        ipCache.lastInternalUpdate = now;

        // 处理公网IP
        handlePublicIp(resolve, needUpdatePublic);
      });
    } else {
      // 不需要更新内网IP，直接处理公网IP
      handlePublicIp(resolve, needUpdatePublic);
    }
  });
}

// 处理公网IP获取
function handlePublicIp(resolve, needUpdate) {
  if (!needUpdate) {
    // 不需要更新公网IP，直接返回
    resolve({
      internal: ipCache.internal,
      public: ipCache.public
    });
    return;
  }

  // 需要更新公网IP
  const req = http.get('http://api.ipify.org', (resp) => {
    let data = '';
    resp.on('data', (chunk) => {
      data += chunk;
    });
    resp.on('end', () => {
      // 更新公网IP缓存
      const newPublicIp = data || ipCache.public || '获取失败';
      if (ipCache.public !== newPublicIp) {
        console.log(`公网IP更新: ${ipCache.public} -> ${newPublicIp}`);
      }
      ipCache.public = newPublicIp;
      ipCache.lastPublicUpdate = Date.now();

      resolve({
        internal: ipCache.internal,
        public: ipCache.public
      });
    });
  });

  req.on('error', () => {
    // 获取失败，使用缓存值或默认值
    ipCache.public = ipCache.public || '获取失败';
    resolve({
      internal: ipCache.internal,
      public: ipCache.public
    });
  });

  req.setTimeout(3000, () => {
    req.destroy();
    // 超时，使用缓存值或默认值
    ipCache.public = ipCache.public || '获取失败';
    resolve({
      internal: ipCache.internal,
      public: ipCache.public
    });
  });
}

// 获取地理位置信息
async function getLocationInfo() {
  return new Promise((resolve) => {
    // 简化实现，避免外部API依赖
    resolve({
      country: '未知',
      region: '未知',
      city: '未知',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '未知'
    });
  });
}

// 创建WebSocket客户端并连接
let wsUrl;
if (config.serverPort === "443" || config.serverPort === 443) {
  // HTTPS默认端口，不显示端口号
  wsUrl = `${config.wsProtocol}://${config.serverHost}/monitor`;
} else if (config.serverPort === "80" || config.serverPort === 80) {
  // HTTP默认端口，不显示端口号
  wsUrl = `${config.wsProtocol}://${config.serverHost}/monitor`;
} else {
  // 非默认端口，显示端口号
  wsUrl = `${config.wsProtocol}://${config.serverHost}:${config.serverPort}/monitor`;
}

console.log('启动EasySSH监控客户端...');
console.log('连接地址:', wsUrl);
const client = new WebSocketClient(wsUrl);
client.connect();

// 优雅关闭处理
process.on('SIGINT', () => {
  console.log('正在关闭监控客户端...');

  if (client.connected && client.ws) {
    client.ws.close();
  }

  if (client.dataTimer) {
    clearInterval(client.dataTimer);
  }

  if (client.heartbeatTimer) {
    clearInterval(client.heartbeatTimer);
  }

  console.log('监控客户端已关闭');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在关闭...');
  process.exit(0);
});


EOL

# 创建轻量级 package.json
cat > /tmp/package.json << 'EOL'
{
  "name": "easyssh-monitor",
  "version": "2.0.0",
  "description": "EasySSH轻量级系统监控客户端",
  "main": "monitor.js",
  "scripts": {
    "start": "node monitor.js"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOL

# 复制文件到监控目录
sudo cp /tmp/monitor.js $MONITOR_DIR/
sudo cp /tmp/package.json $MONITOR_DIR/

# 安装依赖
cd $MONITOR_DIR
sudo npm install --production --no-audit --no-fund

# 创建系统服务文件
cat > /tmp/easyssh-monitor.service << EOL
[Unit]
Description=EasySSH轻量级监控客户端
After=network.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node /opt/easyssh-monitor/monitor.js
Restart=always
RestartSec=10
User=root
Environment=NODE_ENV=production
WorkingDirectory=/opt/easyssh-monitor
StandardOutput=journal
StandardError=journal
SyslogIdentifier=easyssh-monitor

# 资源限制
LimitNOFILE=65536
MemoryMax=128M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
EOL

sudo cp /tmp/easyssh-monitor.service /etc/systemd/system/

# 启用并启动服务
sudo systemctl daemon-reload
sudo systemctl enable easyssh-monitor
sudo systemctl start easyssh-monitor

# 检查服务状态
sleep 2
if sudo systemctl is-active --quiet easyssh-monitor; then
    echo "✅ EasySSH监控客户端安装成功！"
    echo "📊 监控客户端将主动连接到: $SERVER_ADDR"
    echo "🔄 服务状态: 运行中"
    echo ""
    echo "📝 查看日志: sudo journalctl -u easyssh-monitor -f"
    echo "🔧 重启服务: sudo systemctl restart easyssh-monitor"
    echo "❌ 卸载服务: curl -L https://raw.githubusercontent.com/shan-hee/EasySSH/main/server/scripts/easyssh-monitor-uninstall.sh -o easyssh-monitor-uninstall.sh && chmod +x easyssh-monitor-uninstall.sh && sudo ./easyssh-monitor-uninstall.sh"
else
    echo "❌ 服务启动失败，请检查日志: sudo journalctl -u easyssh-monitor -n 20"
    exit 1
fi
echo ""