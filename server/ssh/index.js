/**
 * SSH WebSocket服务
 * 用于处理SSH连接和WebSocket通信
 */

const WebSocket = require('ws');

// 导入SSH、SFTP和工具模块
const ssh = require('./ssh');
const sftp = require('./sftp');
const utils = require('./utils');

/**
 * 初始化WebSocket服务器
 * @param {Object} server HTTP服务器实例
 */
function initWebSocketServer(server) {
  const wss = new WebSocket.Server({ 
    server,
    path: '/ssh'
  });
  
  wss.on('connection', (ws) => {
    console.log(utils.logMessage('新的WebSocket连接', '已建立'));
    let sessionId = null;
    
    ws.on('message', async (message) => {
      try {
        const msg = JSON.parse(message);
        const { type, data } = msg;
        
        switch (type) {
          case 'connect':
            // 处理连接请求
            sessionId = await ssh.handleConnect(ws, data);
            break;
            
          case 'data':
            // 处理数据传输
            ssh.handleData(ws, data);
            break;
            
          case 'resize':
            // 处理终端调整大小
            ssh.handleResize(ws, data);
            break;
            
          case 'disconnect':
            // 处理断开连接
            ssh.handleDisconnect(ws, data);
            break;
            
          case 'ping':
            // 处理保活消息
            ssh.handlePing(ws, data);
            break;
            
          case 'sftp_init':
            // 处理SFTP初始化
            sftp.handleSftpInit(ws, data, ssh.sessions);
            break;
            
          case 'sftp_list':
            // 处理SFTP列表目录
            sftp.handleSftpList(ws, data);
            break;
            
          case 'sftp_upload':
            // 处理SFTP上传
            sftp.handleSftpUpload(ws, data);
            break;
            
          case 'sftp_download':
            // 处理SFTP下载
            sftp.handleSftpDownload(ws, data);
            break;
            
          case 'sftp_mkdir':
            // 处理SFTP创建目录
            sftp.handleSftpMkdir(ws, data);
            break;
            
          case 'sftp_delete':
            // 处理SFTP删除
            sftp.handleSftpDelete(ws, data);
            break;
            
          case 'sftp_rename':
            // 处理SFTP重命名
            sftp.handleSftpRename(ws, data);
            break;
            
          case 'sftp_close':
            // 处理SFTP关闭
            sftp.handleSftpClose(ws, data);
            break;
            
          case 'ssh_exec':
            // 处理SSH命令执行请求
            ssh.handleSshExec(ws, data);
            break;
            
          default:
            utils.sendError(ws, '未知的消息类型', sessionId);
        }
      } catch (err) {
        console.error(utils.logMessage('处理消息', 'WebSocket', '错误', err.message));
        utils.sendError(ws, `处理消息错误: ${err.message}`, sessionId);
      }
    });
    
    ws.on('close', () => {
      console.log(utils.logMessage('WebSocket连接', '已关闭'));
      
      // 清理资源
      if (sessionId && ssh.sessions.has(sessionId)) {
        const session = ssh.sessions.get(sessionId);
        session.ws = null;
        
        // 如果客户端意外断开，先保留SSH连接一段时间
        // 允许客户端重新连接，延长保留时间到24小时
        clearTimeout(session.cleanupTimeout);
        session.cleanupTimeout = setTimeout(() => {
          if (ssh.sessions.has(sessionId) && !ssh.sessions.get(sessionId).ws) {
            ssh.cleanupSession(sessionId);
          }
        }, 24 * 60 * 60 * 1000); // 24小时后清理，实际上几乎相当于永久保留
      }
    });
    
    ws.on('error', (err) => {
      console.error(utils.logMessage('WebSocket', '', '错误', err.message));
    });
  });
}

module.exports = {
  initWebSocketServer
}; 
