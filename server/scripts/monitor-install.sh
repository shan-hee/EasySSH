#!/bin/bash

echo "正在安装系统监控组件..."

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

# 创建监控程序文件
cat > /tmp/monitor.js << 'EOL'
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const http = require('http');
const socketIO = require('socket.io');
const osu = require('node-os-utils');

// 创建HTTP服务器
const server = http.createServer();
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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
  ip: {}
};

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
          resolve();
        });
      }).on('error', () => {
        systemInfo.ip.public = '获取失败';
        resolve();
      });
    });
  });
}

// 更新系统信息
async function updateSystemInfo() {
  try {
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
    
    // 交换分区信息
    try {
      exec('free -m | grep Swap', (error, stdout) => {
        if (!error && stdout) {
          const parts = stdout.trim().split(/\s+/);
          if (parts.length >= 3) {
            systemInfo.swap = {
              total: parseInt(parts[1]),
              used: parseInt(parts[2]),
              free: parseInt(parts[3] || 0),
              usedPercentage: parts[1] > 0 ? (parseInt(parts[2]) / parseInt(parts[1]) * 100).toFixed(2) : 0
            };
          }
        }
      });
    } catch (err) {
      systemInfo.swap = { error: '获取交换分区信息失败' };
    }
    
    // 磁盘信息
    const driveInfo = await drive.info();
    systemInfo.disk = {
      total: driveInfo.totalGb,
      used: driveInfo.usedGb,
      free: driveInfo.freeGb,
      usedPercentage: driveInfo.usedPercentage
    };
    
    // 网络状态
    try {
      const netInfo = await netstat.stats();
      systemInfo.network = netInfo;
    } catch (err) {
      systemInfo.network = { error: '获取网络信息失败' };
    }
    
    // 操作系统信息
    systemInfo.os = {
      type: osInfo.type(),
      platform: osInfo.platform(),
      arch: os.arch(),
      release: os.release(),
      uptime: os.uptime(),
      hostname: os.hostname()
    };
    
  } catch (err) {
    console.error('更新系统信息时出错:', err);
  }
}

// 定期更新IP地址信息（每10分钟）
setInterval(getIpInfo, 10 * 60 * 1000);

// 初始化信息
getIpInfo();
updateSystemInfo();

// 定期更新系统信息（每1.5秒）
setInterval(updateSystemInfo, 1500);

// 处理连接
io.on('connection', (socket) => {
  console.log('客户端已连接');
  
  // 立即发送一次系统信息
  socket.emit('system-info', systemInfo);
  
  // 设置定时器，每1.5秒推送一次数据
  const interval = setInterval(() => {
    socket.emit('system-info', systemInfo);
  }, 1500);
  
  // 断开连接时清除定时器
  socket.on('disconnect', () => {
    clearInterval(interval);
    console.log('客户端已断开连接');
  });
});

// 启动服务器
const PORT = 9528;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`系统监控服务运行在端口 ${PORT}，同时监听IPv4和IPv6地址`);
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
    "socket.io": "^4.6.1"
  }
}
EOL

# 复制文件到监控目录
sudo cp /tmp/monitor.js $MONITOR_DIR/
sudo cp /tmp/package.json $MONITOR_DIR/

# 安装依赖
cd $MONITOR_DIR
sudo npm install --production

# 创建系统服务
cat > /tmp/easyssh-monitor.service << 'EOL'
[Unit]
Description=EasySSH系统监控服务
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/easyssh-monitor/monitor.js
Restart=always
User=root
Environment=NODE_ENV=production
WorkingDirectory=/opt/easyssh-monitor

[Install]
WantedBy=multi-user.target
EOL

sudo cp /tmp/easyssh-monitor.service /etc/systemd/system/

# 启用并启动服务
sudo systemctl daemon-reload
sudo systemctl enable easyssh-monitor
sudo systemctl start easyssh-monitor

echo "系统监控组件安装完成！服务运行在端口9528"
echo ""
echo "注意：如需卸载监控服务，请执行以下命令："
echo "sudo ./monitor-uninstall.sh"
echo "" 