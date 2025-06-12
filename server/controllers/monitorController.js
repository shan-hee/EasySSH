/**
 * 系统监控控制器
 */

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');
const { getAllSessions } = require('../monitoring');

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
 * 检查系统监控服务状态
 */
exports.checkStatus = async (req, res) => {
  try {
    const { host, port = 9527 } = req.body;
    
    if (!host) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: host'
      });
    }
    
    // 尝试直接连接到WebSocket
    try {
      // 引入监控服务
      const { connectToHost } = require('../monitoring');
      
      // 尝试连接WebSocket
      const connected = await connectToHost(host, port);
      
      if (connected) {
        return res.json({
          success: true,
          status: 'running',
          message: '监控服务正在运行',
          connection: {
            host,
            port
          }
        });
      } else {
        return res.json({
          success: false,
          status: 'not_running',
          message: '监控服务未运行或无法访问',
          error: 'WebSocket连接失败'
        });
      }
    } catch (error) {
      return res.json({
        success: false,
        status: 'not_running',
        message: '监控服务未运行或无法访问',
        error: error.message
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
 * 主动连接到远程主机的监控服务
 */
exports.connectToMonitor = async (req, res) => {
  try {
    const { host, port = 9527 } = req.body;
    
    if (!host) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: host'
      });
    }
    
    // 引入监控服务
    const { connectToHost } = require('../monitoring');
    
    const connected = await connectToHost(host, port);
    
    if (connected) {
      return res.json({
        success: true,
        message: `已成功连接到 ${host} 的监控服务`,
        connection: {
          host,
          port,
          timestamp: Date.now()
        }
      });
    } else {
      return res.json({
        success: false,
        message: `无法连接到 ${host} 的监控服务`,
        error: '连接失败'
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: '连接监控服务失败',
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
 * 获取所有活跃的监控会话
 */
exports.getSessions = async (req, res) => {
  try {
    // 引入监控服务
    const { getAllSessions } = require('../monitoring');
    
    // 获取所有会话
    const sessions = getAllSessions();
    
    return res.json({
      success: true,
      sessions,
      count: sessions.length,
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