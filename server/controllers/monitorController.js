/**
 * 系统监控控制器 - 重构版
 * 专门处理监控客户端主动连接模式的API
 */

const path = require('path');
const fs = require('fs');
const { getAllSessions, getSessionByHostname } = require('../monitoring');

/**
 * 获取系统监控安装脚本
 */
exports.getInstallScript = async (req, res) => {
  try {
    const { host } = req.query;
    
    if (!host) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: host'
      });
    }
    
    // 获取服务器地址
    const serverAddr = process.env.SERVER_ADDRESS || req.get('host') || 'localhost:3000';
    
    // 创建安装命令
    const installCommand = `curl -sSL http://${serverAddr}/api/monitor/download-script | sudo env EASYSSH_SERVER=${serverAddr} bash`;
    
    return res.json({
      success: true,
      installCommand,
      serverAddress: serverAddr,
      message: '获取安装命令成功'
    });
  } catch (error) {
    console.error('获取安装脚本失败:', error);
    return res.status(500).json({
      success: false,
      message: '获取安装脚本失败',
      error: error.message
    });
  }
};

/**
 * 检查监控客户端连接状态 - 重构版
 */
exports.checkStatus = async (req, res) => {
  try {
    const { hostname } = req.query;

    if (!hostname) {
      // 返回所有活跃监控客户端的状态
      const sessions = getAllSessions();
      const activeClients = sessions.map(session => ({
        hostname: session.hostInfo?.hostname || '未知',
        clientIp: session.clientIp,
        connectedAt: session.connectedAt,
        lastActivity: session.lastActivity,
        status: 'connected'
      }));

      return res.json({
        success: true,
        status: 'active',
        message: `当前有 ${activeClients.length} 个活跃的监控客户端`,
        clients: activeClients,
        count: activeClients.length
      });
    }

    // 检查特定主机的连接状态
    const session = getSessionByHostname(hostname);

    if (session) {
      return res.json({
        success: true,
        status: 'connected',
        message: `监控客户端 ${hostname} 已连接`,
        client: {
          hostname: session.hostInfo?.hostname,
          clientIp: session.clientIp,
          connectedAt: session.connectedAt,
          lastActivity: session.lastActivity,
          systemStats: session.systemStats
        }
      });
    } else {
      return res.json({
        success: false,
        status: 'disconnected',
        message: `监控客户端 ${hostname} 未连接`
      });
    }

  } catch (error) {
    console.error('检查监控状态失败:', error);
    return res.status(500).json({
      success: false,
      message: '检查监控状态失败',
      error: error.message
    });
  }
};



/**
 * 下载监控服务安装脚本
 */
exports.downloadInstallScript = async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // 脚本路径
    const scriptPath = path.join(__dirname, '../scripts/easyssh-monitor-install.sh');
    
    // 检查脚本是否存在
    if (!fs.existsSync(scriptPath)) {
      return res.status(404).json({
        success: false,
        message: '安装脚本不存在'
      });
    }
    
    // 读取脚本内容
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    
    // 设置响应头
    res.set('Content-Type', 'text/plain');
    res.set('Content-Disposition', 'attachment; filename=easyssh-monitor-install.sh');
    
    // 返回脚本内容
    return res.send(scriptContent);
  } catch (error) {
    console.error('下载安装脚本失败:', error);
    return res.status(500).json({
      success: false,
      message: '下载安装脚本失败',
      error: error.message
    });
  }
};

/**
 * 获取所有活跃的监控会话 - 重构版
 */
exports.getSessions = async (req, res) => {
  try {
    // 获取所有会话
    const sessions = getAllSessions();

    // 格式化会话信息
    const formattedSessions = sessions.map(session => ({
      id: session.id,
      hostname: session.hostInfo?.hostname || '未知',
      clientIp: session.clientIp,
      connectedAt: session.connectedAt,
      lastActivity: session.lastActivity,
      platform: session.hostInfo?.platform,
      arch: session.hostInfo?.arch,
      hasSystemStats: !!session.systemStats
    }));

    return res.json({
      success: true,
      sessions: formattedSessions,
      count: formattedSessions.length,
      timestamp: Date.now()
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: '获取监控会话失败',
      error: error.message
    });
  }
};