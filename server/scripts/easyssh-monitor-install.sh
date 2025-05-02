#!/bin/bash

echo "正在安装系统监控组件..."

# 从环境变量获取服务器地址
if [ -z "$EASYSSH_SERVER" ]; then
    echo "错误: 必须设置EASYSSH_SERVER环境变量"
    echo "请使用以下格式重新运行安装脚本:"
    echo "sudo env EASYSSH_SERVER=你的服务器地址[:端口] ./easyssh-monitor-install.sh"
    exit 1
fi

SERVER_ADDR=${EASYSSH_SERVER}

echo "监控服务将连接到: $SERVER_ADDR"

# 检查是否已安装 node 和 npm
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "检测到未安装 Node.js 和 npm，正在安装..."
    
    # 检测操作系统类型
    if [ -f /etc/debian_version ]; then
        # Debian/Ubuntu
        sudo apt-get update
        sudo apt-get install -y curl
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [ -f /etc/redhat-release ]; then
        # CentOS/RHEL
        sudo yum install -y curl
        curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
        sudo yum install -y nodejs
    else
        echo "不支持的操作系统，请手动安装 Node.js 18+"
        exit 1
    fi
fi

# 创建监控程序目录
MONITOR_DIR="/opt/easyssh-monitor"
sudo mkdir -p $MONITOR_DIR

# 创建配置文件
cat > /tmp/config.json << EOL
{
  "server": "${SERVER_ADDR}",
  "port": 9527
}
EOL

# 复制配置文件到监控目录
sudo cp /tmp/config.json $MONITOR_DIR/

# 创建监控程序文件
cat > /tmp/monitor.js << 'EOL'
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const http = require('http'); // Only used for getting public IP
const WebSocket = require('ws');
const osu = require('node-os-utils');

// 读取配置文件
let config;
try {
  const configData = fs.readFileSync('./config.json');
  config = JSON.parse(configData);
  console.log('配置加载成功:', config);
  
  // 验证服务器地址
  if (!config.server) {
    console.error('错误: 未指定服务器地址');
    process.exit(1);
  }
} catch (err) {
  console.error('配置文件读取失败:', err);
  process.exit(1);
}

// 处理服务器地址格式
function normalizeServerAddress(address) {
  // 如果地址中不包含冒号，表示没有指定端口
  if (address && !address.includes(':')) {
    // 添加默认端口9527
    const defaultPort = '9527';
    console.log(`服务器地址未指定端口，使用默认端口 ${defaultPort}`);
    return `${address}:${defaultPort}`;
  }
  return address;
}

// 规范化服务器地址
config.server = normalizeServerAddress(config.server);
console.log(`规范化后的服务器地址: ${config.server}`);

const cpu = osu.cpu;
const mem = osu.mem;
const netstat = osu.netstat;
const drive = osu.drive;
const osInfo = osu.os;

// 系统信息缓存
let systemInfo = {
  cpu: {},
  memory: {},
  swap: {},
  disk: {},
  network: {},
  os: {},
  ip: {},
  location: {},
  timestamp: Date.now(),
  machineId: ''
};

// 提取服务器地址和端口，用于安全验证
function extractServerInfo(serverAddress) {
  const parts = serverAddress.split(':');
  return {
    host: parts[0],
    port: parts.length > 1 ? parts[1] : '9527'
  };
}

// 解析授权服务器信息
const authServer = extractServerInfo(config.server);
console.log(`授权服务器: ${authServer.host}:${authServer.port}`);

// 直接创建WebSocket服务器
const wss = new WebSocket.Server({ 
  port: config.port,     // 直接监听端口
  path: '/monitor',      // WebSocket连接路径设为/monitor
  handleProtocols: (protocols, request) => {
    // 处理WebSocket协议请求
    return protocols[0] || '';
  }
});

// WebSocket连接升级事件处理
wss.on('headers', (headers, request) => {
  // 为WebSocket握手添加CORS头
  headers.push('Access-Control-Allow-Origin: *');
  headers.push('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  headers.push('Access-Control-Allow-Headers: Content-Type, Authorization');
});

console.log(`WebSocket服务器已启动，监听端口 ${config.port}，路径 /monitor`);

// 获取机器唯一标识
async function getMachineId() {
  return new Promise((resolve) => {
    if (process.platform === 'linux') {
      exec('cat /etc/machine-id || cat /var/lib/dbus/machine-id', (error, stdout) => {
        if (!error && stdout) {
          systemInfo.machineId = stdout.trim();
        } else {
          systemInfo.machineId = `${os.hostname()}-${os.cpus()[0].model}`;
        }
        resolve();
      });
    } else {
      systemInfo.machineId = `${os.hostname()}-${os.cpus()[0].model}`;
      resolve();
    }
  });
}

// 获取IP地址信息
async function getIpInfo() {
  return new Promise((resolve) => {
    exec('hostname -I', (error, stdout, stderr) => {
      if (error) {
        systemInfo.ip = { internal: '获取失败', public: '获取失败' };
        resolve();
        return;
      }
      
      const ips = stdout.trim().split(' ');
      systemInfo.ip.internal = ips[0] || '获取失败';
      
      // 获取公网IP
      http.get('http://api.ipify.org', (resp) => {
        let data = '';
        resp.on('data', (chunk) => {
          data += chunk;
        });
        resp.on('end', () => {
          systemInfo.ip.public = data || '获取失败';
          // 获取IP地理位置信息
          getLocationInfo(data);
          resolve();
        });
      }).on('error', () => {
        systemInfo.ip.public = '获取失败';
        resolve();
      });
    });
  });
}

// 获取IP地理位置信息
function getLocationInfo(ip) {
  if (!ip || ip === '获取失败') {
    systemInfo.location = { status: '获取失败' };
    return;
  }
  
  http.get(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon,timezone,isp`, (resp) => {
    let data = '';
    resp.on('data', (chunk) => {
      data += chunk;
    });
    resp.on('end', () => {
      try {
        const locationData = JSON.parse(data);
        if (locationData.status === 'success') {
          systemInfo.location = {
            country: locationData.country,
            region: locationData.regionName,
            city: locationData.city,
            lat: locationData.lat,
            lon: locationData.lon,
            timezone: locationData.timezone,
            isp: locationData.isp
          };
        } else {
          systemInfo.location = { status: '获取失败' };
        }
      } catch (e) {
        systemInfo.location = { status: '解析失败', error: e.message };
      }
    });
  }).on('error', (err) => {
    systemInfo.location = { status: '请求失败', error: err.message };
  });
}

// 定义网络状态存储变量（用于计算速率）
let lastNetworkStats = {
  rx_bytes: 0,
  tx_bytes: 0,
  timestamp: Date.now()
};

// 更新系统信息
async function updateSystemInfo() {
  try {
    // 更新时间戳
    systemInfo.timestamp = Date.now();
    
    // CPU信息
    systemInfo.cpu.usage = await cpu.usage();
    systemInfo.cpu.cores = cpu.count();
    systemInfo.cpu.model = os.cpus()[0].model;
    
    // 内存信息
    const memInfo = await mem.info();
    systemInfo.memory = {
      total: memInfo.totalMemMb,
      used: memInfo.usedMemMb,
      free: memInfo.freeMemMb,
      usedPercentage: memInfo.usedMemPercentage
    };
    
    // 增强的交换分区信息获取 - 多种方法综合
    await new Promise((resolve) => {
      // 方法1: /proc/swaps
      exec('cat /proc/swaps 2>/dev/null', (error, stdout) => {
        if (!error && stdout && stdout.trim().length > 0 && stdout.split('\n').length > 1) {
          try {
            let total = 0;
            let used = 0;
            
            // 跳过标题行
            const lines = stdout.trim().split('\n').slice(1);
            for (const line of lines) {
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 3) {
                // 通常第三列是大小（以KB为单位）
                const size = parseInt(parts[2]) || 0;
                total += size / 1024; // 转换为MB
              }
            }
            
            // 使用额外命令获取已用空间
            exec('free -m', (err, output) => {
              if (!err && output) {
                const freeLines = output.trim().split('\n');
                for (const line of freeLines) {
                  if (line.toLowerCase().includes('swap')) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 3) {
                      // 查找"used"列的数值
                      for (let i = 0; i < parts.length; i++) {
                        if (parts[i].toLowerCase() === 'used' && i+1 < parts.length) {
                          used = parseInt(parts[i+1]) || 0;
                          break;
                        }
                      }
                      
                      // 如果无法通过列名找到，尝试使用固定位置
                      if (used === 0 && !isNaN(parseInt(parts[2]))) {
                        used = parseInt(parts[2]);
                      }
                    }
                    break;
                  }
                }
                
                // 设置交换分区信息
                if (total > 0) {
                  const free = total - used;
                  systemInfo.swap = {
                    total: Math.round(total),
                    used: Math.round(used),
                    free: Math.round(free),
                    usedPercentage: total > 0 ? (used / total * 100).toFixed(2) : 0
                  };
                  resolve();
                  return;
                }
              }
              
              // 如果free命令失败或无法解析，继续尝试其他方法
              tryMethod2();
            });
          } catch (e) {
            tryMethod2();
          }
        } else {
          tryMethod2();
        }
      });
      
      // 方法2: swapon --show
      function tryMethod2() {
        exec('swapon --show 2>/dev/null', (error, stdout) => {
          if (!error && stdout && stdout.trim().length > 0) {
            try {
              let total = 0;
              let used = 0;
              
              const lines = stdout.trim().split('\n');
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                // 查找包含SIZE和USED的列
                if (i === 0 && line.includes('SIZE') && line.includes('USED')) {
                  // 找到标题行中SIZE和USED的位置
                  const headers = line.trim().split(/\s+/);
                  const sizeIndex = headers.findIndex(h => h === 'SIZE');
                  const usedIndex = headers.findIndex(h => h === 'USED');
                  
                  if (sizeIndex >= 0 && usedIndex >= 0) {
                    // 处理数据行
                    for (let j = 1; j < lines.length; j++) {
                      const dataParts = lines[j].trim().split(/\s+/);
                      if (dataParts.length > Math.max(sizeIndex, usedIndex)) {
                        // 解析大小
                        const sizeStr = dataParts[sizeIndex];
                        let size = parseFloat(sizeStr.replace(/[^0-9.]/g, ''));
                        if (sizeStr.includes('G')) size *= 1024; // 转换为MB
                        
                        // 解析已用
                        const usedStr = dataParts[usedIndex];
                        let usedVal = parseFloat(usedStr.replace(/[^0-9.]/g, ''));
                        if (usedStr.includes('G')) usedVal *= 1024; // 转换为MB
                        
                        total += size;
                        used += usedVal;
                      }
                    }
                  }
                }
              }
              
              if (total > 0) {
                const free = total - used;
                systemInfo.swap = {
                  total: Math.round(total),
                  used: Math.round(used),
                  free: Math.round(free),
                  usedPercentage: total > 0 ? (used / total * 100).toFixed(2) : 0
                };
                resolve();
                return;
              } else {
                tryMethod3();
              }
            } catch (e) {
              tryMethod3();
            }
          } else {
            tryMethod3();
          }
        });
      }
      
      // 方法3: free -m (最基本的方法)
      function tryMethod3() {
        exec('free -m', (error, stdout) => {
          if (!error && stdout) {
            try {
              const lines = stdout.trim().split('\n');
              for (const line of lines) {
                if (line.toLowerCase().includes('swap')) {
                  const parts = line.trim().split(/\s+/);
                  if (parts.length >= 3) {
                    // 找到带有数字的部分
                    let numValues = [];
                    for (const part of parts) {
                      if (!isNaN(parseInt(part))) {
                        numValues.push(parseInt(part));
                      }
                    }
                    
                    if (numValues.length >= 3) {
                      const total = numValues[0];
                      const used = numValues[1];
                      const free = numValues[2];
                      
                      systemInfo.swap = {
                        total: total,
                        used: used,
                        free: free,
                        usedPercentage: total > 0 ? (used / total * 100).toFixed(2) : 0
                      };
                      resolve();
                      return;
                    }
                  }
                }
              }
              
              // 如果解析失败
              systemInfo.swap = { total: 0, used: 0, free: 0, usedPercentage: 0 };
              resolve();
            } catch (e) {
              systemInfo.swap = { total: 0, used: 0, free: 0, usedPercentage: 0 };
              resolve();
            }
          } else {
            systemInfo.swap = { total: 0, used: 0, free: 0, usedPercentage: 0 };
            resolve();
          }
        });
      }
    });
    
    // 磁盘信息
    const driveInfo = await drive.info();
    systemInfo.disk = {
      total: driveInfo.totalGb,
      used: driveInfo.usedGb,
      free: driveInfo.freeGb,
      usedPercentage: driveInfo.usedPercentage
    };
    
    // 简化的网络状态 - 只获取总接收和发送速度
    await new Promise((resolve) => {
      exec('cat /proc/net/dev', (error, stdout) => {
        if (!error && stdout) {
          try {
            const lines = stdout.trim().split('\n').slice(2); // 跳过前两行标题
            const currentTime = Date.now();
            
            let totalRxBytes = 0;
            let totalTxBytes = 0;
            
            // 累计所有接口的流量
            lines.forEach(line => {
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 10) {
                const interfaceName = parts[0].replace(':', '');
                // 忽略lo接口
                if (interfaceName !== 'lo') {
                  totalRxBytes += parseInt(parts[1]) || 0;
                  totalTxBytes += parseInt(parts[9]) || 0;
                }
              }
            });
            
            // 计算网络速率
            const timeDiff = (currentTime - lastNetworkStats.timestamp) / 1000; // 转换为秒
            let rxSpeed = 0;
            let txSpeed = 0;
            
            if (timeDiff > 0 && lastNetworkStats.rx_bytes > 0) {
              // 计算每秒接收字节数（KB/s）
              const rxDiff = totalRxBytes - lastNetworkStats.rx_bytes;
              rxSpeed = (rxDiff / timeDiff / 1024).toFixed(2);
              
              // 计算每秒发送字节数（KB/s）
              const txDiff = totalTxBytes - lastNetworkStats.tx_bytes;
              txSpeed = (txDiff / timeDiff / 1024).toFixed(2);
            }
            
            // 更新上次的网络状态
            lastNetworkStats = {
              rx_bytes: totalRxBytes,
              tx_bytes: totalTxBytes,
              timestamp: currentTime
            };
            
            // 获取活动连接数
            exec('netstat -an | grep ESTABLISHED | wc -l', (err, stdout) => {
              const connectionCount = !err ? parseInt(stdout.trim()) : 0;
              
              systemInfo.network = {
                connections: connectionCount,
                total_rx_speed: rxSpeed, // 总下载速度 KB/s
                total_tx_speed: txSpeed  // 总上传速度 KB/s
              };
              
              resolve();
            });
          } catch (e) {
            systemInfo.network = { 
              connections: 0,
              total_rx_speed: "0.00",
              total_tx_speed: "0.00"
            };
            resolve();
          }
        } else {
          // 如果无法获取网络信息
          systemInfo.network = { 
            connections: 0,
            total_rx_speed: "0.00",
            total_tx_speed: "0.00"
          };
          resolve();
        }
      });
    });
    
    // 操作系统信息
    systemInfo.os = {
      type: osInfo.type(),
      platform: osInfo.platform(),
      arch: os.arch(),
      release: os.release(),
      uptime: os.uptime(),
      hostname: os.hostname(),
      machineId: systemInfo.machineId
    };
    
  } catch (err) {
    console.error('更新系统信息时出错:', err);
  }
}

// 定期更新IP地址信息（每10分钟）
setInterval(getIpInfo, 10 * 60 * 1000);

// 初始化信息
async function initialize() {
  await getMachineId();
  await getIpInfo();
  await updateSystemInfo();
}

// WebSocket连接状态
let wsConnected = false;
let activeConnection = null;
let dataSendInterval = null;

// 监听连接
wss.on('connection', (ws, req) => {
  // 获取连接请求的远程地址
  const remoteAddress = req.socket.remoteAddress;
  const clientIP = remoteAddress.replace(/^.*:/, ''); // 处理IPv6格式
  
  console.log(`收到来自 ${clientIP} 的连接请求`);
  
  // 暂时不做权限控制，接受所有连接
  // 原来的权限检查代码被注释掉:
  /*
  // 安全验证：检查连接是否来自授权服务器
  const isAuthorized = clientIP === authServer.host || 
                       clientIP === '127.0.0.1' || // 允许本地连接（测试用）
                       authServer.host === 'localhost';
  
  if (!isAuthorized) {
    console.error(`拒绝未授权连接: ${clientIP} 不是授权服务器 ${authServer.host}`);
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: '未授权连接，请求被拒绝' 
    }));
    ws.terminate();
    return;
  }
  */
  
  console.log('服务端已连接');
  
  // 如果已有连接，关闭旧连接
  if (activeConnection) {
    try {
      activeConnection.terminate();
    } catch (e) {
      console.error('关闭旧连接时出错:', e);
    }
  }
  
  // 设置新的活动连接
  activeConnection = ws;
  wsConnected = true;
  
  // 连接时立即开始定时发送数据
  startDataTransmission(ws);
  
  // 接收消息处理
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('收到服务器消息:', message.type);
      
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    } catch (err) {
      console.error('处理服务器消息时出错:', err);
    }
  });
  
  // 连接关闭处理
  ws.on('close', () => {
    console.log('服务端连接已关闭');
    wsConnected = false;
    if (activeConnection === ws) {
      activeConnection = null;
    }
    
    // 清除数据发送定时器
    if (dataSendInterval) {
      clearInterval(dataSendInterval);
      dataSendInterval = null;
    }
  });
  
  // 错误处理
  ws.on('error', (error) => {
    console.error('WebSocket连接错误:', error.message);
    wsConnected = false;
    if (activeConnection === ws) {
      try {
        ws.terminate();
      } catch (e) {}
      activeConnection = null;
    }
  });
});

// 启动数据传输
function startDataTransmission(ws) {
  // 清除之前的计时器
  if (dataSendInterval) {
    clearInterval(dataSendInterval);
  }
  
  // 立即发送第一次系统信息
  sendSystemInfo(ws);
  
  // 定期发送系统信息（每1.5秒）
  dataSendInterval = setInterval(() => {
    sendSystemInfo(ws);
  }, 1500);
}

// 发送系统信息
async function sendSystemInfo(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  
  // 更新系统信息
  await updateSystemInfo();
  
  // 发送到服务器
  ws.send(JSON.stringify({
    type: 'system-info',
    data: systemInfo
  }));
}

// 初始化并启动服务
initialize();

// 优雅关闭
process.on('SIGINT', () => {
  console.log('正在关闭监控服务...');
  
  // 关闭WebSocket服务器
  if (wss) {
    wss.close(() => {
      console.log('WebSocket服务器已关闭');
      
      // 关闭活动连接
      if (activeConnection) {
        activeConnection.terminate();
      }
      
      console.log('监控服务已关闭');
      process.exit(0);
    });
  } else {
    console.log('监控服务已关闭');
    process.exit(0);
  }
});
EOL

# 创建 package.json
cat > /tmp/package.json << 'EOL'
{
  "name": "easyssh-monitor",
  "version": "1.0.0",
  "description": "EasySSH系统监控服务",
  "main": "monitor.js",
  "scripts": {
    "start": "node monitor.js"
  },
  "dependencies": {
    "node-os-utils": "^1.3.7",
    "ws": "^8.13.0"
  }
}
EOL

# 复制文件到监控目录
sudo cp /tmp/monitor.js $MONITOR_DIR/
sudo cp /tmp/package.json $MONITOR_DIR/

# 安装依赖
cd $MONITOR_DIR
sudo npm install --production

# 创建系统服务文件
cat > /tmp/easyssh-monitor.service << EOL
[Unit]
Description=EasySSH系统监控服务
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/easyssh-monitor/monitor.js
Restart=always
User=root
Environment=NODE_ENV=production
Environment=EASYSSH_SERVER=${SERVER_ADDR}
WorkingDirectory=/opt/easyssh-monitor

[Install]
WantedBy=multi-user.target
EOL

sudo cp /tmp/easyssh-monitor.service /etc/systemd/system/

# 启用并启动服务
sudo systemctl daemon-reload
sudo systemctl enable easyssh-monitor
sudo systemctl start easyssh-monitor

echo "系统监控组件安装完成！服务运行在端口9527"
echo ""
echo "注意：如需卸载监控服务，请执行以下命令："
echo "sudo ./monitor-uninstall.sh"
echo "" 