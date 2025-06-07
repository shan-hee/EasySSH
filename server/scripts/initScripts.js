/**
 * 初始化脚本库数据
 * 创建一些默认的系统脚本
 */

const { connectDatabase } = require('../config/database');
const Script = require('../models/Script');

// 默认脚本数据
const defaultScripts = [
  {
    name: '系统信息收集脚本',
    description: '收集服务器系统信息，包括CPU、内存、磁盘使用情况等。',
    command: 'free -h && df -h && cat /proc/cpuinfo | grep "model name" | head -1',
    author: '系统管理员',
    tags: ['系统', '监控', '信息收集'],
    keywords: ['系统', '信息', '内存', '磁盘', 'cpu', 'free', 'df'],
    category: '系统监控',
    isSystem: true
  },
  {
    name: '网络连接检测',
    description: '检测服务器与指定目标的网络连接状态。',
    command: 'ping -c 4 google.com && traceroute baidu.com',
    author: '网络管理员',
    tags: ['网络', '诊断', '连接测试'],
    keywords: ['网络', '连接', '检测', 'ping', 'traceroute'],
    category: '网络诊断',
    isSystem: true
  },
  {
    name: '进程监控',
    description: '查看系统进程状态和资源使用情况。',
    command: 'ps aux | head -20 && top -bn1 | head -20',
    author: '系统管理员',
    tags: ['进程', '监控', '性能'],
    keywords: ['进程', '监控', 'ps', 'top', '性能'],
    category: '系统监控',
    isSystem: true
  },
  {
    name: '磁盘空间清理',
    description: '清理系统临时文件和日志文件，释放磁盘空间。',
    command: 'sudo apt-get clean && sudo journalctl --vacuum-time=7d && sudo find /tmp -type f -atime +7 -delete',
    author: '系统管理员',
    tags: ['清理', '磁盘', '维护'],
    keywords: ['清理', '磁盘', '空间', 'clean', 'tmp'],
    category: '系统维护',
    isSystem: true
  },
  {
    name: '服务状态检查',
    description: '检查系统关键服务的运行状态。',
    command: 'systemctl status nginx && systemctl status mysql && systemctl status ssh',
    author: '系统管理员',
    tags: ['服务', '状态', '检查'],
    keywords: ['服务', '状态', 'systemctl', 'nginx', 'mysql', 'ssh'],
    category: '服务管理',
    isSystem: true
  },
  {
    name: '日志查看',
    description: '查看系统日志和应用日志的最新记录。',
    command: 'tail -50 /var/log/syslog && journalctl -n 20',
    author: '系统管理员',
    tags: ['日志', '查看', '调试'],
    keywords: ['日志', 'log', 'tail', 'journalctl', 'syslog'],
    category: '日志管理',
    isSystem: true
  },
  {
    name: '用户登录信息',
    description: '查看用户登录历史和当前在线用户。',
    command: 'who && last | head -10 && w',
    author: '系统管理员',
    tags: ['用户', '登录', '安全'],
    keywords: ['用户', '登录', 'who', 'last', 'w'],
    category: '用户管理',
    isSystem: true
  },
  {
    name: '防火墙状态',
    description: '检查防火墙状态和规则配置。',
    command: 'sudo ufw status verbose && sudo iptables -L',
    author: '安全管理员',
    tags: ['防火墙', '安全', '网络'],
    keywords: ['防火墙', '安全', 'ufw', 'iptables'],
    category: '安全管理',
    isSystem: true
  },
  {
    name: '文件权限检查',
    description: '检查重要文件和目录的权限设置。',
    command: 'ls -la /etc/passwd /etc/shadow /etc/ssh/ && find /home -type f -perm 777',
    author: '安全管理员',
    tags: ['权限', '安全', '文件'],
    keywords: ['权限', '安全', 'ls', 'find', 'chmod'],
    category: '安全管理',
    isSystem: true
  },
  {
    name: '数据库备份',
    description: '创建MySQL数据库的备份文件。',
    command: 'mysqldump -u root -p --all-databases > backup_$(date +%Y%m%d_%H%M%S).sql',
    author: '数据库管理员',
    tags: ['备份', '数据库', 'MySQL'],
    keywords: ['备份', '数据库', 'mysqldump', 'mysql'],
    category: '数据库管理',
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
    name: 'Git仓库状态',
    description: '查看Git仓库的状态和最近提交记录。',
    command: 'git status && git log --oneline -10 && git branch -a',
    author: '开发管理员',
    tags: ['Git', '版本控制', '开发'],
    keywords: ['git', '版本控制', 'status', 'log', 'branch'],
    category: '开发工具',
    isSystem: true
  }
];

async function initializeScripts() {
  try {
    // 连接数据库
    connectDatabase();
    
    console.log('开始初始化脚本库数据...');
    
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

module.exports = { initializeScripts, defaultScripts };
