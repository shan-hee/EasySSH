/**
 * 初始化脚本库数据
 * 创建一些默认的系统脚本
 */

const { connectDatabase } = require('../config/database');
const Script = require('../models/Script');

// 默认脚本数据生成函数
function getDefaultScripts() {
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
      name: 'Docker Compose 服务状态',
      description: '查看当前目录下 compose.yml 或 docker-compose.yml 中所有服务的运行状态。',
      command: 'docker compose ps',
      author: '容器管理员',
      tags: ['Docker', '监控'],
      keywords: ['docker', 'compose', 'ps', '状态', '服务'],
      category: '容器管理',
      isSystem: true
    },
    {
      name: 'Docker Compose 启动服务',
      description: '启动 compose.yml 或 docker-compose.yml 中定义的所有服务，如果镜像不存在会自动拉取。',
      command: 'docker compose up -d',
      author: '容器管理员',
      tags: ['Docker', '启动'],
      keywords: ['docker', 'compose', 'up', '启动', '服务'],
      category: '容器管理',
      isSystem: true
    },
    {
      name: 'Docker Compose 停止服务',
      description: '停止 compose.yml 或 docker-compose.yml 中所有正在运行的服务，但保留容器。',
      command: 'docker compose stop',
      author: '容器管理员',
      tags: ['Docker', '停止'],
      keywords: ['docker', 'compose', 'stop', '停止', '服务'],
      category: '容器管理',
      isSystem: true
    },
    {
      name: 'Docker Compose 重启服务',
      description: '重启 compose.yml 或 docker-compose.yml 中的所有服务。',
      command: 'docker compose restart',
      author: '容器管理员',
      tags: ['Docker', '重启'],
      keywords: ['docker', 'compose', 'restart', '重启', '服务'],
      category: '容器管理',
      isSystem: true
    },
    {
      name: 'Docker Compose 查看日志',
      description: '查看所有服务的实时日志输出，按 Ctrl+C 退出。',
      command: 'docker compose logs -f',
      author: '容器管理员',
      tags: ['Docker', '日志'],
      keywords: ['docker', 'compose', 'logs', '日志', '实时'],
      category: '容器管理',
      isSystem: true
    },
    {
      name: 'Docker Compose 完全清理',
      description: '停止并删除当前 compose 项目所有容器、网络和卷，完全清理环境。',
      command: 'docker compose down -v --remove-orphans',
      author: '容器管理员',
      tags: ['Docker', '清理'],
      keywords: ['docker', 'compose', 'down', '清理', '删除', '卷'],
      category: '容器管理',
      isSystem: true
    },
    {
      name: '网络连接状态',
      description: '查看系统网络连接状态和端口监听情况。',
      command: 'netstat -tuln | head -20',
      author: '系统管理员',
      tags: ['网络', '监控'],
      keywords: ['网络', '端口', 'netstat', '连接'],
      category: '系统监控',
      isSystem: true
    },
    {
      name: '进程监控',
      description: '查看系统进程状态，按CPU使用率排序。',
      command: 'ps aux --sort=-%cpu | head -15',
      author: '系统管理员',
      tags: ['进程', '监控'],
      keywords: ['进程', 'ps', 'cpu', '监控'],
      category: '系统监控',
      isSystem: true
    },
    {
      name: '磁盘IO状态',
      description: '查看磁盘IO统计信息。',
      command: 'iostat -x 1 3',
      author: '系统管理员',
      tags: ['磁盘', 'IO', '监控'],
      keywords: ['磁盘', 'io', 'iostat', '性能'],
      category: '系统监控',
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

    console.log('\n脚本库初始化完成:');
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
