/**
 * 初始化脚本库数据
 * 创建一些默认的系统脚本
 */

const { connectDatabase } = require('../config/database');
const Script = require('../models/Script');

/**
 * 获取公网IP地址
 */
async function getPublicIP() {
  const http = require('http');
  const https = require('https');

  return new Promise((resolve) => {
    // 尝试多个公网IP获取服务
    const services = [
      'http://api.ipify.org',
      'http://icanhazip.com',
      'http://ipinfo.io/ip'
    ];

    let completed = false;

    services.forEach(url => {
      if (completed) return;

      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, (res) => {
        if (completed) return;

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (completed) return;
          completed = true;
          const ip = data.trim();
          // 验证IP格式
          if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
            resolve(ip);
          } else {
            resolve(null);
          }
        });
      });

      req.on('error', () => {
        // 忽略错误，尝试下一个服务
      });

      req.setTimeout(3000, () => {
        req.destroy();
      });
    });

    // 3秒后如果还没有结果，返回null
    setTimeout(() => {
      if (!completed) {
        completed = true;
        resolve(null);
      }
    }, 3000);
  });
}

/**
 * 获取服务器地址
 */
async function getServerAddress() {
  // 监控服务端口配置，默认8520
  const monitorPort = process.env.VITE_PORT || 8520;

  // 首先检查.env中是否配置了SERVER_ADDRESS
  const configuredAddress = process.env.SERVER_ADDRESS;
  if (configuredAddress && configuredAddress.trim()) {
    console.log('使用配置的服务器地址:', configuredAddress);
    // 如果配置的地址已包含端口，直接使用；否则添加端口
    if (configuredAddress.includes(':')) {
      return configuredAddress;
    } else {
      return `${configuredAddress}:${monitorPort}`;
    }
  }

  // 如果没有配置，尝试获取公网IP
  console.log('未配置服务器地址，正在获取公网IP...');
  try {
    const publicIP = await getPublicIP();
    if (publicIP) {
      console.log('获取到公网IP+端口:', publicIP+  `:${monitorPort}`);
      return `${publicIP}:${monitorPort}`;
    }
  } catch (error) {
    console.warn('获取公网IP失败:', error.message);
  }

  // 如果获取公网IP失败，尝试获取内网IP
  console.log('获取公网IP失败，尝试获取内网IP...');
  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();

    // 查找第一个非回环的IPv4地址
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log('使用内网IP:', iface.address);
          return `${iface.address}:${monitorPort}`;
        }
      }
    }
  } catch (error) {
    console.warn('获取网络接口失败:', error.message);
  }

  // 最后的备选方案
  console.warn('无法获取IP地址，使用默认地址');
  return `localhost:${monitorPort}`;
}

// 默认脚本数据生成函数
async function getDefaultScripts() {
  const serverAddress = await getServerAddress();

  return [
  {
    name: '系统信息',
    description: '收集服务器系统信息，包括CPU、内存、磁盘使用情况等。',
    command: 'free -h && df -h && cat /proc/cpuinfo | grep "model name" | head -1',
    author: '系统管理员',
    tags: ['系统', '监控'],
    keywords: ['系统', '信息', '内存', '磁盘', 'cpu', 'free', 'df'],
    category: '系统监控',
    isSystem: true
  },
  {
    name: 'Docker容器状态',
    description: '查看Docker容器和镜像的状态信息。',
    command: 'docker ps -a && docker images && docker system df',
    author: '容器管理员',
    tags: ['Docker', '监控'],
    keywords: ['docker', '容器', 'ps', 'images'],
    category: '容器管理',
    isSystem: true
  },
  {
    name: 'Docker全面清理（包括卷）',
    description: '清理所有未使用的Docker镜像和卷。',
    command: 'docker system prune -af --volumes',
    author: '容器管理员',
    tags: ['Docker', '清理'],
    keywords: ['docker', '镜像', 'prune'],
    category: '容器管理',
    isSystem: true
  },
  {
    name: 'EasySSH监控服务安装',
    description: `一键安装EasySSH监控服务，支持系统资源监控、网络监控等功能。`,
    command: `curl -L https://raw.githubusercontent.com/shan-hee/EasySSH/main/server/scripts/easyssh-monitor-install.sh -o easyssh-monitor-install.sh && chmod +x easyssh-monitor-install.sh && sudo env EASYSSH_SERVER=${serverAddress} ./easyssh-monitor-install.sh`,
    author: 'EasySSH团队',
    tags: ['EasySSH', '安装'],
    keywords: ['easyssh', 'monitor', 'install', '监控', '安装'],
    category: 'EasySSH监控',
    isSystem: true
  },
  {
    name: 'EasySSH监控服务卸载',
    description: '一键卸载EasySSH监控服务及其所有相关文件，包括服务、配置文件、日志等。',
    command: 'curl -L https://raw.githubusercontent.com/shan-hee/EasySSH/main/server/scripts/easyssh-monitor-uninstall.sh -o easyssh-monitor-uninstall.sh && chmod +x easyssh-monitor-uninstall.sh && sudo ./easyssh-monitor-uninstall.sh',
    author: 'EasySSH团队',
    tags: ['EasySSH', '卸载'],
    keywords: ['easyssh', 'monitor', 'uninstall', '监控', '卸载', '清理'],
    category: 'EasySSH监控',
    isSystem: true
  },
  {
    name: 'Docker Compose 服务状态',
    description: '查看当前目录下 docker-compose.yml 中所有服务的运行状态。',
    command: 'docker-compose ps',
    author: '容器管理员',
    tags: ['Docker', '监控'],
    keywords: ['docker-compose', 'ps', '状态', '服务'],
    category: '容器管理',
    isSystem: true
  },
  {
    name: 'Docker Compose 启动服务',
    description: '启动 docker-compose.yml 中定义的所有服务，如果镜像不存在会自动拉取。',
    command: 'docker-compose up -d',
    author: '容器管理员',
    tags: ['Docker', '启动'],
    keywords: ['docker-compose', 'up', '启动', '服务'],
    category: '容器管理',
    isSystem: true
  },
  {
    name: 'Docker Compose 停止服务',
    description: '停止 docker-compose.yml 中所有正在运行的服务，但保留容器。',
    command: 'docker-compose stop',
    author: '容器管理员',
    tags: ['Docker', '停止'],
    keywords: ['docker-compose', 'stop', '停止', '服务'],
    category: '容器管理',
    isSystem: true
  },
  {
    name: 'Docker Compose 重启服务',
    description: '重启 docker-compose.yml 中的所有服务。',
    command: 'docker-compose restart',
    author: '容器管理员',
    tags: ['Docker', '重启'],
    keywords: ['docker-compose', 'restart', '重启', '服务'],
    category: '容器管理',
    isSystem: true
  },
  {
    name: 'Docker Compose 查看日志',
    description: '查看所有服务的实时日志输出，按 Ctrl+C 退出。',
    command: 'docker-compose logs -f',
    author: '容器管理员',
    tags: ['Docker', '日志'],
    keywords: ['docker-compose', 'logs', '日志', '实时'],
    category: '容器管理',
    isSystem: true
  },
  {
    name: 'Docker Compose 完全清理',
    description: '停止并删除当前 compose 项目所有容器、网络和卷，完全清理 docker-compose 环境。',
    command: 'docker-compose down -v --remove-orphans',
    author: '容器管理员',
    tags: ['Docker', '清理'],
    keywords: ['docker-compose', 'down', '清理', '删除', '卷'],
    category: '容器管理',
    isSystem: true
  }
  ];
}

async function initializeScripts() {
  try {
    // 连接数据库
    connectDatabase();

    console.log('开始初始化脚本库数据...');

    // 获取脚本数据
    const defaultScripts = await getDefaultScripts();

    let createdCount = 0;
    let skippedCount = 0;

    for (const scriptData of defaultScripts) {
      try {
        // 检查脚本是否已存在
        const existingScripts = await Script.search(scriptData.name, { limit: 1 });
        const exists = existingScripts.some(script => 
          script.name === scriptData.name && script.isSystem
        );
        
        if (exists) {
          console.log(`脚本 "${scriptData.name}" 已存在，跳过创建`);
          skippedCount++;
          continue;
        }
        
        // 创建新脚本
        const script = new Script({
          ...scriptData,
          is_system: scriptData.isSystem,
          is_public: true,
          created_by: null // 系统脚本没有创建者
        });
        
        await script.save();
        console.log(`创建脚本: ${scriptData.name}`);
        createdCount++;
        
      } catch (error) {
        console.error(`创建脚本 "${scriptData.name}" 失败:`, error.message);
        skippedCount++;
      }
    }
    
    console.log(`\n脚本库初始化完成:`);
    console.log(`- 成功创建: ${createdCount} 个脚本`);
    console.log(`- 跳过/失败: ${skippedCount} 个脚本`);
    console.log(`- 总计: ${defaultScripts.length} 个脚本`);
    
  } catch (error) {
    console.error('初始化脚本库失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  initializeScripts()
    .then(() => {
      console.log('脚本库初始化完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('初始化失败:', error);
      process.exit(1);
    });
}

module.exports = { initializeScripts, getDefaultScripts };
