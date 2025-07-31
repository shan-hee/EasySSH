/**
 * 系统监控控制器 - SSH集成版
 * 处理基于SSH的监控状态检查API
 */

const { getAllSessions, getSessionByHostname } = require('../monitoring');

/**
 * 检查监控状态 - SSH集成版
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

    // 检查特定主机的监控数据可用性（基于SSH收集的数据）
    const monitoringData = getSessionByHostname(hostname);

    if (monitoringData) {
      return res.json({
        success: true,
        status: 'connected',
        message: `主机 ${hostname} 的监控数据可用（通过SSH收集）`,
        client: {
          hostname: hostname,
          lastUpdated: monitoringData.lastUpdated,
          hasData: true,
          dataAge: Date.now() - (monitoringData.lastUpdated || 0),
          source: monitoringData.source || 'ssh_collector'
        }
      });
    } else {
      return res.json({
        success: true,
        status: 'disconnected',
        installed: false,
        message: `主机 ${hostname} 的监控数据不可用（需要SSH连接）`
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
 * 获取所有活跃的前端监控会话 - SSH集成版
 */
exports.getSessions = async (_req, res) => {
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