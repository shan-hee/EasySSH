/**
 * SFTP基础操作模块
 * 处理非传输相关的SFTP操作（列表、创建、删除、重命名等）
 */

const path = require('path');
const logger = require('../utils/logger');

// 导入二进制SFTP工具函数
const { sendBinarySftpSuccess, sendBinarySftpError } = require('./utils');

// 存储SFTP会话
const sftpSessions = new Map();

/**
 * 获取文件MIME类型
 */
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.txt': 'text/plain',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.html': 'text/html',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}


/**
 * 处理SFTP初始化
 */
function handleSftpInit(ws, data, sshSessions) {
  const { sessionId, operationId } = data;

  try {
    logger.debug('SFTP初始化请求', {
      sessionId,
      operationId,
      availableSessions: Array.from(sshSessions.keys())
    });

    const sshSession = sshSessions.get(sessionId);
    if (!sshSession) {
      logger.error('SSH会话不存在', {
        sessionId,
        availableSessions: Array.from(sshSessions.keys())
      });
      throw new Error('SSH会话不存在');
    }

    if (!sshSession.conn) {
      logger.error('SSH连接不存在', {
        sessionId,
        sessionKeys: Object.keys(sshSession)
      });
      throw new Error('SSH连接未建立');
    }

    logger.debug('开始创建SFTP会话', { sessionId });

    sshSession.conn.sftp((err, sftp) => {
      if (err) {
        logger.error('SFTP初始化失败', { sessionId, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `SFTP初始化失败: ${err.message}`, 'SFTP_INIT_ERROR');
        return;
      }

      // 保存SFTP会话
      sftpSessions.set(sessionId, {
        sftp,
        sessionId,
        createdAt: new Date()
      });

      logger.info('SFTP会话已建立', { sessionId });
      sendBinarySftpSuccess(ws, sessionId, operationId, { message: 'SFTP会话已建立' });
    });
  } catch (error) {
    logger.error('SFTP初始化错误', { sessionId, error: error.message });
    sendBinarySftpError(ws, sessionId, operationId, error.message, 'SFTP_INIT_ERROR');
  }
}

/**
 * 处理SFTP列表目录
 */
function handleSftpList(ws, data) {
  const { sessionId, path: remotePath, operationId } = data;
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;
    
    sftp.readdir(remotePath, (err, list) => {
      if (err) {
        logger.error('SFTP列表目录失败', { sessionId, path: remotePath, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `列表目录失败: ${err.message}`, 'SFTP_LIST_ERROR');
        return;
      }

      // 格式化文件列表
      const formattedList = list.map(item => ({
        name: item.filename,
        isDirectory: item.attrs.isDirectory(),
        size: item.attrs.size,
        modifiedTime: new Date(item.attrs.mtime * 1000),
        permissions: item.attrs.mode
      }));

      logger.debug('SFTP已列出目录', { path: remotePath, fileCount: formattedList.length });
      
      // 将目录数据作为payload发送
      const responseData = {
        files: formattedList,
        path: remotePath
      };
      const payloadBuffer = Buffer.from(JSON.stringify(responseData), 'utf-8');
      
      sendBinarySftpSuccess(ws, sessionId, operationId, {}, payloadBuffer);
    });
  } catch (error) {
    logger.error('SFTP列表目录错误', { sessionId, error: error.message });
    sendBinarySftpError(ws, sessionId, operationId, error.message, 'SFTP_LIST_ERROR');
  }
}

/**
 * 处理SFTP创建目录
 */
function handleSftpMkdir(ws, data) {
  const { sessionId, path: remotePath, operationId } = data;
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;
    
    sftp.mkdir(remotePath, (err) => {
      if (err) {
        logger.error('SFTP创建目录失败', { sessionId, path: remotePath, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `创建目录失败: ${err.message}`, 'SFTP_MKDIR_ERROR');
        return;
      }

      logger.info('SFTP目录已创建', { path: remotePath });
      sendBinarySftpSuccess(ws, sessionId, operationId, { 
        message: '目录创建成功',
        path: remotePath
      });
    });
  } catch (error) {
    logger.error('SFTP创建目录错误', { sessionId, error: error.message });
    sendBinarySftpError(ws, sessionId, operationId, error.message, 'SFTP_MKDIR_ERROR');
  }
}

/**
 * 处理SFTP删除
 */
function handleSftpDelete(ws, data) {
  const { sessionId, path: remotePath, operationId } = data;
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;
    
    // 递归删除函数
    function recursiveDelete(path, callback) {
      sftp.stat(path, (err, stats) => {
        if (err) {
          return callback(err);
        }

        if (stats.isDirectory()) {
          sftp.readdir(path, (err, list) => {
            if (err) {
              return callback(err);
            }

            if (list.length === 0) {
              // 空目录，直接删除
              sftp.rmdir(path, callback);
            } else {
              // 先删除所有子项
              let completed = 0;
              let hasError = false;

              list.forEach(item => {
                const itemPath = `${path}/${item.filename}`;
                recursiveDelete(itemPath, (err) => {
                  if (err && !hasError) {
                    hasError = true;
                    return callback(err);
                  }
                  
                  completed++;
                  if (completed === list.length && !hasError) {
                    // 所有子项删除完成，删除目录
                    sftp.rmdir(path, callback);
                  }
                });
              });
            }
          });
        } else {
          // 删除文件
          sftp.unlink(path, callback);
        }
      });
    }

    // 使用递归删除
    recursiveDelete(remotePath, (err) => {
      if (err) {
        logger.error('SFTP删除失败', { sessionId, path: remotePath, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `删除失败: ${err.message}`, 'SFTP_DELETE_ERROR');
        return;
      }

      logger.info('SFTP删除成功', { path: remotePath });
      sendBinarySftpSuccess(ws, sessionId, operationId, { 
        message: '删除成功',
        path: remotePath
      });
    });
  } catch (error) {
    logger.error('SFTP删除错误', { sessionId, error: error.message });
    sendBinarySftpError(ws, sessionId, operationId, error.message, 'SFTP_DELETE_ERROR');
  }
}

/**
 * 处理SFTP快速删除（递归删除目录）
 */
function handleSftpFastDelete(ws, data) {
  const { sessionId, path: remotePath, operationId } = data;
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;
    
    // 递归删除函数
    function recursiveDelete(path, callback) {
      sftp.stat(path, (err, stats) => {
        if (err) {
          return callback(err);
        }

        if (stats.isDirectory()) {
          sftp.readdir(path, (err, list) => {
            if (err) {
              return callback(err);
            }

            if (list.length === 0) {
              // 空目录，直接删除
              sftp.rmdir(path, callback);
            } else {
              // 先删除所有子项
              let completed = 0;
              let hasError = false;

              list.forEach(item => {
                const itemPath = `${path}/${item.filename}`;
                recursiveDelete(itemPath, (err) => {
                  if (err && !hasError) {
                    hasError = true;
                    return callback(err);
                  }
                  
                  completed++;
                  if (completed === list.length && !hasError) {
                    // 所有子项删除完成，删除目录
                    sftp.rmdir(path, callback);
                  }
                });
              });
            }
          });
        } else {
          // 删除文件
          sftp.unlink(path, callback);
        }
      });
    }

    recursiveDelete(remotePath, (err) => {
      if (err) {
        logger.error('SFTP快速删除失败', { sessionId, path: remotePath, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `快速删除失败: ${err.message}`, 'SFTP_FAST_DELETE_ERROR');
        return;
      }

      logger.info('SFTP快速删除完成', { path: remotePath });
      sendBinarySftpSuccess(ws, sessionId, operationId, { 
        message: '快速删除成功',
        path: remotePath
      });
    });
  } catch (error) {
    logger.error('SFTP快速删除错误', { sessionId, error: error.message });
    sendBinarySftpError(ws, sessionId, operationId, error.message, 'SFTP_FAST_DELETE_ERROR');
  }
}

/**
 * 处理SFTP权限修改
 */
function handleSftpChmod(ws, data) {
  const { sessionId, path: remotePath, mode, operationId } = data;
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;
    
    sftp.chmod(remotePath, mode, (err) => {
      if (err) {
        logger.error('SFTP权限修改失败', { sessionId, path: remotePath, mode, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `权限修改失败: ${err.message}`, 'SFTP_CHMOD_ERROR');
        return;
      }

      logger.info('SFTP权限已修改', { path: remotePath, mode });
      sendBinarySftpSuccess(ws, sessionId, operationId, { 
        message: '权限修改成功',
        path: remotePath,
        mode
      });
    });
  } catch (error) {
    logger.error('SFTP权限修改错误', { sessionId, error: error.message });
    sendBinarySftpError(ws, sessionId, operationId, error.message, 'SFTP_CHMOD_ERROR');
  }
}

/**
 * 处理SFTP重命名
 */
function handleSftpRename(ws, data) {
  const { sessionId, oldPath, newPath, operationId } = data;
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;
    
    sftp.rename(oldPath, newPath, (err) => {
      if (err) {
        logger.error('SFTP重命名失败', { sessionId, oldPath, newPath, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `重命名失败: ${err.message}`, 'SFTP_RENAME_ERROR');
        return;
      }

      logger.info('SFTP重命名成功', { oldPath, newPath });
      sendBinarySftpSuccess(ws, sessionId, operationId, { 
        message: '重命名成功',
        oldPath,
        newPath
      });
    });
  } catch (error) {
    logger.error('SFTP重命名错误', { sessionId, error: error.message });
    sendBinarySftpError(ws, sessionId, operationId, error.message, 'SFTP_RENAME_ERROR');
  }
}

/**
 * 处理SFTP关闭
 */
function handleSftpClose(ws, data) {
  const { sessionId, operationId } = data;
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (sftpSession) {
      sftpSession.sftp.end();
      sftpSessions.delete(sessionId);
      logger.info('SFTP会话已关闭', { sessionId });
    }

    sendBinarySftpSuccess(ws, sessionId, operationId, { message: 'SFTP会话已关闭' });
  } catch (error) {
    logger.error('SFTP关闭错误', { sessionId, error: error.message });
    sendBinarySftpError(ws, sessionId, operationId, error.message, 'SFTP_CLOSE_ERROR');
  }
}

module.exports = {
  sftpSessions,
  handleSftpInit,
  handleSftpList,
  handleSftpMkdir,
  handleSftpDelete,
  handleSftpFastDelete,
  handleSftpChmod,
  handleSftpRename,
  handleSftpClose,
  getMimeType
};
