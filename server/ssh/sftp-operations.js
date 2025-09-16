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

function isNotFoundError(err) {
  if (!err) return false;
  if (err.code === 2 || err.code === 'ENOENT') return true;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  return message.includes('no such file') || message.includes('no such path');
}

// 通用递归删除实现，允许目标在删除过程中被其他操作清理
function recursiveDeletePath(sftp, targetPath, callback) {
  sftp.stat(targetPath, (err, stats) => {
    if (err) {
      if (isNotFoundError(err)) {
        return callback(null);
      }
      err.path = err.path || targetPath;
      return callback(err);
    }

    if (stats.isDirectory()) {
      sftp.readdir(targetPath, (err, list) => {
        if (err) {
          if (isNotFoundError(err)) {
            return callback(null);
          }
          err.path = err.path || targetPath;
          return callback(err);
        }

        const entries = list.filter(item => item && item.filename && item.filename !== '.' && item.filename !== '..');

        if (entries.length === 0) {
          return sftp.rmdir(targetPath, (rmdirErr) => {
            if (rmdirErr && !isNotFoundError(rmdirErr)) {
              rmdirErr.path = rmdirErr.path || targetPath;
              return callback(rmdirErr);
            }
            logger.debug('SFTP目录已删除', { path: targetPath });
            callback(null);
          });
        }

        let completed = 0;
        let hasError = false;

        entries.forEach(item => {
          const itemPath = `${targetPath}/${item.filename}`;
          recursiveDeletePath(sftp, itemPath, (childErr) => {
            if (childErr) {
              if (!hasError) {
                hasError = true;
                childErr.path = childErr.path || itemPath;
                callback(childErr);
              }
              return;
            }

            if (hasError) {
              return;
            }

            completed++;
            if (completed === entries.length) {
              sftp.rmdir(targetPath, (rmdirErr) => {
                if (rmdirErr && !isNotFoundError(rmdirErr)) {
                  rmdirErr.path = rmdirErr.path || targetPath;
                  return callback(rmdirErr);
                }
                logger.debug('SFTP目录已删除', { path: targetPath });
                callback(null);
              });
            }
          });
        });
      });
    } else {
      sftp.unlink(targetPath, (unlinkErr) => {
        if (unlinkErr && !isNotFoundError(unlinkErr)) {
          unlinkErr.path = unlinkErr.path || targetPath;
          return callback(unlinkErr);
        }
        logger.debug('SFTP文件已删除', { path: targetPath });
        callback(null);
      });
    }
  });
}

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

    logger.debug('SFTP删除请求', { sessionId, path: remotePath, isDirectory: !!data.isDirectory });

    // 使用通用递归删除逻辑
    recursiveDeletePath(sftp, remotePath, (err) => {
      if (err) {
        logger.error('SFTP删除失败', { sessionId, path: remotePath, errorPath: err.path || remotePath, error: err.message });
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

    logger.debug('SFTP快速删除请求', { sessionId, path: remotePath });

    recursiveDeletePath(sftp, remotePath, (err) => {
      if (err) {
        logger.error('SFTP快速删除失败', { sessionId, path: remotePath, errorPath: err.path || remotePath, error: err.message });
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
