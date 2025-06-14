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
        SERVER_PORT="3000"  # EasySSH默认端口
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
    cat /tmp/config.json
else
    echo "❌ 配置文件格式错误，请检查服务器地址格式"
    cat /tmp/config.json
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
  console.log('配置加载成功:', config);

  // 验证服务器配置
  if (!config.serverHost || !config.serverPort || !config.wsProtocol) {
    console.error('错误: 服务器配置不完整');
    console.error('需要的配置项: serverHost, serverPort, wsProtocol');
    console.error('当前配置:', config);
    process.exit(1);
  }
} catch (err) {
  console.error('配置文件读取失败:', err);
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
          console.error('处理服务器消息失败:', err);
        }
      });

      this.ws.on('close', () => {
        console.log('与EasySSH服务器的连接已断开');
        this.connected = false;
        this.stopHeartbeat();
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
      default:
        console.log('收到服务器消息:', message.type);
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
      if (!this.send({ type: 'ping', timestamp: Date.now() })) {
        console.log('心跳发送失败，连接可能已断开');
      }
    }, this.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.maxReconnectAttempts !== -1 && this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('达到最大重连次数，停止重连');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1), 60000);

    console.log(`${delay/1000}秒后尝试第${this.reconnectAttempts}次重连...`);
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  startDataTransmission() {
    // 立即发送一次系统信息
    this.sendSystemInfo();

    // 每1.5秒发送一次系统信息
    this.dataTimer = setInterval(() => {
      this.sendSystemInfo();
    }, 1500);
  }

  async sendSystemInfo() {
    if (!this.connected) return;

    try {
      const systemInfo = await getSystemInfo();
      this.send({
        type: 'system_stats',
        payload: systemInfo
      });
    } catch (err) {
      console.error('获取系统信息失败:', err);
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

// 获取IP地址信息
async function getIpInfo() {
  return new Promise((resolve) => {
    exec('hostname -I', (error, stdout) => {
      if (error) {
        resolve({ internal: '获取失败', public: '获取失败' });
        return;
      }

      const ips = stdout.trim().split(' ');
      const internal = ips[0] || '获取失败';

      // 获取公网IP
      const req = http.get('http://api.ipify.org', (resp) => {
        let data = '';
        resp.on('data', (chunk) => {
          data += chunk;
        });
        resp.on('end', () => {
          resolve({
            internal,
            public: data || '获取失败'
          });
        });
      });

      req.on('error', () => {
        resolve({
          internal,
          public: '获取失败'
        });
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve({
          internal,
          public: '获取失败'
        });
      });
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

console.log('WebSocket连接地址:', wsUrl);
const client = new WebSocketClient(wsUrl);

// 启动监控客户端
console.log('启动EasySSH监控客户端...');
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
    echo "❌ 卸载服务: sudo ./easyssh-monitor-uninstall.sh"
else
    echo "❌ 服务启动失败，请检查日志: sudo journalctl -u easyssh-monitor -n 20"
    exit 1
fi
echo ""