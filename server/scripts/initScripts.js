/**
 * 初始化脚本库数据
 * 创建一些默认的系统脚本
 */

const { connectDatabase } = require('../config/database');
const Script = require('../models/Script');

/**
 * 获取服务器地址
 */
function getServerAddress() {
  // 监控服务使用9527端口
  const monitorPort = process.env.MONITOR_PORT || 9527;
  const serverHost = process.env.SERVER_HOST || 'localhost';

  // 如果是localhost，尝试获取实际IP
  if (serverHost === 'localhost' || serverHost === '127.0.0.1') {
    try {
      const os = require('os');
      const interfaces = os.networkInterfaces();

      // 查找第一个非回环的IPv4地址
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            return `${iface.address}:${monitorPort}`;
          }
        }
      }
    } catch (error) {
      console.warn('获取网络接口失败，使用默认地址');
    }
  }

  return `${serverHost}:${monitorPort}`;
}

// 默认脚本数据生成函数
function getDefaultScripts() {
  const serverAddress = getServerAddress();

  return [
  {
    name: '系统信息',
    description: '收集服务器系统信息，包括CPU、内存、磁盘使用情况等。',
    command: 'free -h && df -h && cat /proc/cpuinfo | grep "model name" | head -1',
    author: '系统管理员',
    tags: ['系统', '监控', '信息收集'],
    keywords: ['系统', '信息', '内存', '磁盘', 'cpu', 'free', 'df'],
    category: '系统监控',
    isSystem: true
  },
  {
    name: 'Docker容器状态',
    description: '查看Docker容器和镜像的状态信息。',
    command: 'docker ps -a && docker images && docker system df',
    author: '容器管理员',
    tags: ['Docker', '容器', '监控'],
    keywords: ['docker', '容器', 'ps', 'images'],
    category: '容器管理',
    isSystem: true
  },
  {
    name: 'Docker全面清理（包括卷）',
    description: '清理所有未使用的Docker镜像和卷。',
    command: 'docker system prune -af --volumes',
    author: '容器管理员',
    tags: ['Docker', '镜像', '清理'],
    keywords: ['docker', '镜像', 'prune'],
    category: '容器管理',
    isSystem: true
  },
  {
    name: 'EasySSH监控服务安装',
    description: `一键安装EasySSH监控服务，支持系统资源监控、网络监控等功能。`,
    command: `curl -L https://raw.githubusercontent.com/shan-hee/EasySSH/main/server/scripts/easyssh-monitor-install.sh -o easyssh-monitor-install.sh && chmod +x easyssh-monitor-install.sh && sudo env EASYSSH_SERVER=${serverAddress} ./easyssh-monitor-install.sh`,
    author: 'EasySSH团队',
    tags: ['监控', '安装', 'EasySSH', '系统监控', '一键安装'],
    keywords: ['easyssh', 'monitor', 'install', '监控', '安装'],
    category: 'EasySSH监控',
    isSystem: true
  },
  {
    name: 'EasySSH监控服务卸载',
    description: '一键卸载EasySSH监控服务及其所有相关文件，包括服务、配置文件、日志等。',
    command: 'curl -L https://raw.githubusercontent.com/shan-hee/EasySSH/main/server/scripts/easyssh-monitor-uninstall.sh -o easyssh-monitor-uninstall.sh && chmod +x easyssh-monitor-uninstall.sh && sudo ./easyssh-monitor-uninstall.sh',
    author: 'EasySSH团队',
    tags: ['监控', '卸载', 'EasySSH', '清理'],
    keywords: ['easyssh', 'monitor', 'uninstall', '监控', '卸载', '清理'],
    category: 'EasySSH监控',
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
    const defaultScripts = getDefaultScripts();

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
