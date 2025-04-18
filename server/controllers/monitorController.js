/**
 * 系统监控控制器
 */

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');

/**
 * 获取系统监控安装脚本
 */
exports.getInstallScript = (req, res) => {
  try {
    const scriptPath = path.join(__dirname, '../scripts/monitor-install.sh');
    
    // 检查脚本文件是否存在
    if (!fs.existsSync(scriptPath)) {
      return res.status(404).json({
        success: false,
        message: '监控安装脚本不存在'
      });
    }
    
    // 读取脚本内容
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="monitor-install.sh"');
    return res.send(scriptContent);
  } catch (error) {
    console.error('获取监控安装脚本失败:', error);
    return res.status(500).json({
      success: false,
      message: '获取监控安装脚本失败',
      error: error.message
    });
  }
};

/**
 * 检查系统监控服务状态
 */
exports.checkStatus = async (req, res) => {
  try {
    const { host, port = 9528 } = req.body;
    
    if (!host) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: host'
      });
    }
    
    // 尝试连接监控服务
    try {
      await axios.get(`http://${host}:${port}`, { 
        timeout: 3000,
        headers: {
          'Connection': 'close'
        }
      });
      
      return res.json({
        success: true,
        status: 'running',
        message: '监控服务正在运行',
        connection: {
          host,
          port
        }
      });
    } catch (error) {
      // 如果是连接被拒绝或超时，可能服务正在运行但不接受HTTP请求
      // 这是正常的，因为我们的服务只提供Socket.IO连接
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        return res.json({
          success: false,
          status: 'not_running',
          message: '监控服务未运行或无法访问',
          error: error.message
        });
      }
      
      // 其他情况下，服务可能在运行，但返回了不同的响应
      return res.json({
        success: true,
        status: 'running',
        message: '监控服务可能正在运行',
        connection: {
          host,
          port
        }
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