/**
 * 系统监控控制器 - 重构版
 * 专门处理前端监控状态检查和初始化的API
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
 * 检查监控状态 - 重构版（仅用于初始状态获取）
 */
exports.checkStatus = async (req, res) => {
  try {
    const { hostname } = req.query;

    if (!hostname) {
      // 返回所有活跃前端会话的状态
      const sessions = getAllSessions();
      const activeSessions = sessions.map(session => ({
        sessionId: session.id,
        clientIp: session.clientIp,
        connectedAt: session.connectedAt,
        lastActivity: session.lastActivity,
        subscribedServers: session.subscribedServers || [],
        status: 'connected'
      }));

      return res.json({
        success: true,
        status: 'active',
        message: `当前有 ${activeSessions.length} 个活跃的前端监控会话`,
        sessions: activeSessions,
        count: activeSessions.length
      });
    }

    // 检查特定主机的监控数据可用性
    const monitoringData = getSessionByHostname(hostname);

    if (monitoringData) {
      return res.json({
        success: true,
        status: 'connected',
        message: `主机 ${hostname} 的监控数据可用`,
        client: {
          hostname: hostname,
          lastUpdated: monitoringData.lastUpdated,
          hasData: true,
          dataAge: Date.now() - (monitoringData.lastUpdated || 0)
        }
      });
    } else {
      return res.json({
        success: true,
        status: 'disconnected',
        installed: false,
        message: `主机 ${hostname} 的监控数据不可用`
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
 * 获取所有活跃的前端监控会话 - 重构版
 */
exports.getSessions = async (req, res) => {
  try {
    // 获取所有前端会话
    const sessions = getAllSessions();

    // 格式化会话信息
    const formattedSessions = sessions.map(session => ({
      id: session.id,
      clientIp: session.clientIp,
      connectedAt: session.connectedAt,
      lastActivity: session.lastActivity,
      subscribedServers: session.subscribedServers || [],
      messageStats: session.stats
    }));

    return res.json({
      success: true,
      sessions: formattedSessions,
      count: formattedSessions.length,
      timestamp: Date.now(),
      message: '获取前端监控会话成功'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: '获取前端监控会话失败',
      error: error.message
    });
  }
};

/**
 * 更新监控数据 - 新增API端点
 * 用于接收外部监控数据并广播给前端
 */
exports.updateMonitoringData = async (req, res) => {
  try {
    const { hostname, monitoringData } = req.body;

    if (!hostname || !monitoringData) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: hostname 和 monitoringData'
      });
    }

    // 这里可以添加认证逻辑，确保只有授权的来源可以更新监控数据

    // 通过WebSocket广播监控数据更新
    // 注意：这里需要访问WebSocket服务，可能需要重构架构

    return res.json({
      success: true,
      message: '监控数据更新成功',
      hostname,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('更新监控数据失败:', error);
    return res.status(500).json({
      success: false,
      message: '更新监控数据失败',
      error: error.message
    });
  }
};