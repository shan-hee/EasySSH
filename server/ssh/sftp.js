/**
 * SFTP 模块
 * 用于处理SFTP文件传输和操作
 */

const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// 导入工具模块
const utils = require('./utils');
const {
  MSG_TYPE,
  sendMessage,
  sendError,
  sendSftpError,
  sendSftpSuccess,
  sendSftpProgress,
  validateSftpSession,
  safeExec,
  logMessage
} = utils;

// 存储活动的SFTP会话
const sftpSessions = new Map();

/**
 * SFTP处理函数 - 初始化SFTP会话
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 * @param {Object} sshSessions SSH会话集合
 */
async function handleSftpInit(ws, data, sshSessions) {
  const { sessionId } = data;
  
  if (!sessionId || !sshSessions.has(sessionId)) {
    sendError(ws, '无效的会话ID', sessionId, null, 'sftp');
    return;
  }
  
  await safeExec(async () => {
    const session = sshSessions.get(sessionId);
    
    // 如果SFTP会话已存在，直接返回成功
    if (sftpSessions.has(sessionId)) {
      sendMessage(ws, MSG_TYPE.READY, {
        sessionId,
        path: sftpSessions.get(sessionId).currentPath
      });
      logger.debug('重用现有SFTP会话', { sessionId });
      return;
    }
    
    // 创建新的SFTP会话
    session.conn.sftp((err, sftp) => {
      if (err) {
        logger.error('创建SFTP会话失败', { sessionId, error: err.message });
        sendError(ws, `创建SFTP会话失败: ${err.message}`, sessionId, null, 'sftp');
        return;
      }
      
      // 获取当前目录
      sftp.realpath('.', (err, homePath) => {
        if (err) {
          logger.error('获取SFTP当前目录失败', { sessionId, error: err.message });
          homePath = '/'; // 默认为根目录
        }
        
        // 保存SFTP会话
        sftpSessions.set(sessionId, {
          sftp,
          currentPath: homePath
        });
        
        // 通知客户端SFTP准备就绪
        sendMessage(ws, MSG_TYPE.READY, {
          sessionId,
          path: homePath
        });
        
        logger.info('SFTP会话已创建', { sessionId, initialPath: homePath });
      });
    });
  }, ws, 'SFTP初始化错误', sessionId, null, false);
}

/**
 * SFTP处理函数 - 列出目录
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpList(ws, data) {
  const { sessionId, path: requestedPath, operationId } = data;
  
  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }
  
  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    const path = requestedPath || sftpSession.currentPath;
    
    // 读取目录内容
    sftp.readdir(path, (err, list) => {
      if (err) {
        logger.error('SFTP读取目录失败', { path, error: err.message });
        sendSftpError(ws, sessionId, operationId, `读取目录失败: ${err.message}`);
        return;
      }
      
      // 转换文件列表格式
      const fileList = list.map(item => {
        const isDirectory = item.attrs.isDirectory();
        return {
          name: item.filename,
          isDirectory,
          size: item.attrs.size,
          modifiedTime: new Date(item.attrs.mtime * 1000),
          permissions: item.attrs.mode
        };
      });
      
      // 如果不是根目录，添加上级目录选项
      if (path !== '/') {
        fileList.unshift({
          name: '..',
          isDirectory: true,
          size: 0,
          modifiedTime: new Date(),
          permissions: 0
        });
      }
      
      // 更新当前路径
      sftpSession.currentPath = path;
      
      // 发送目录列表给客户端
      sendSftpSuccess(ws, sessionId, operationId, {
        path,
        files: fileList
      });
      
      logger.debug('SFTP已列出目录', { path, fileCount: fileList.length });
    });
  }, ws, '列出目录错误', sessionId, operationId);
}

/**
 * SFTP处理函数 - 上传文件
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpUpload(ws, data) {
  const { sessionId, path: remotePath, filename, content, operationId } = data;
  
  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }
  
  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;

    // 解析Base64内容
    const matches = content.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      throw new Error('无效的文件内容格式');
    }

    const buffer = Buffer.from(matches[2], 'base64');
    const totalSize = buffer.length;

    // 检查文件大小限制
    const maxUploadSize = parseInt(process.env.MAX_UPLOAD_SIZE) || 104857600; // 默认100MB

    // 调试日志：记录环境变量和解析结果
    logger.debug('文件大小限制检查', {
      envValue: process.env.MAX_UPLOAD_SIZE,
      parsedValue: maxUploadSize,
      totalSize: totalSize,
      fileSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
    });

    if (totalSize > maxUploadSize) {
      const fileSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      const maxSizeMB = (maxUploadSize / (1024 * 1024)).toFixed(0);
      throw new Error(`文件大小 ${fileSizeMB}MB 超过最大限制 ${maxSizeMB}MB`);
    }
    let uploaded = 0;
    
    // 创建可写流
    const writeStream = sftp.createWriteStream(remotePath);
    
    // 设置事件处理器
    writeStream.on('error', (err) => {
      logger.error('SFTP文件上传错误', { remotePath, error: err.message });
      sendSftpError(ws, sessionId, operationId, `文件上传错误: ${err.message}`);
    });
    
    writeStream.on('finish', () => {
      logger.info('SFTP文件上传完成', { remotePath, totalSize });
      
      // 立即发送成功消息
      sendSftpSuccess(ws, sessionId, operationId, {
        message: '文件上传成功',
        totalSize
      });
    });
    
    // 分块上传文件
    const chunkSize = 64 * 1024; // 64KB每块
    let offset = 0;
    
    // 发送数据块函数
    const sendChunk = () => {
      const chunk = buffer.slice(offset, Math.min(offset + chunkSize, totalSize));
      
      if (chunk.length > 0) {
        // 写入数据块
        const canContinue = writeStream.write(chunk);
        
        // 更新上传进度
        offset += chunk.length;
        uploaded += chunk.length;
        
        // 报告进度
        const progress = Math.round((uploaded / totalSize) * 100);
        sendSftpProgress(ws, sessionId, operationId, progress, uploaded, totalSize);
        
        // 如果可以继续，直接发送下一块
        // 否则等待drain事件
        if (canContinue && offset < totalSize) {
          process.nextTick(sendChunk);
        } 
      } else {
        // 所有数据已发送，结束流
        writeStream.end();
      }
    };
    
    // 当缓冲区清空时继续发送
    writeStream.on('drain', () => {
      if (offset < totalSize) {
        sendChunk();
      }
    });
    
    // 开始发送第一块
    sendChunk();
  }, ws, '文件上传错误', sessionId, operationId);
}

/**
 * SFTP处理函数 - 下载文件
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpDownload(ws, data) {
  const { sessionId, path: remotePath, operationId } = data;
  
  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }
  
  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    
    // 获取文件信息
    sftp.stat(remotePath, (err, stats) => {
      if (err) {
        logger.error('SFTP获取文件信息失败', { remotePath, error: err.message });
        sendSftpError(ws, sessionId, operationId, `获取文件信息失败: ${err.message}`);
        return;
      }
      
      // 确认是文件而非目录
      if (stats.isDirectory()) {
        sendSftpError(ws, sessionId, operationId, '不能下载目录');
        return;
      }
      
      // 获取文件大小
      const fileSize = stats.size;
      
      // 大文件检查 (超过50MB)
      if (fileSize > 50 * 1024 * 1024) {
        sendMessage(ws, MSG_TYPE.CONFIRM, {
          sessionId,
          operationId,
          message: `文件大小为 ${(fileSize / (1024 * 1024)).toFixed(2)} MB, 确定下载?`,
          fileSize
        });
        return;
      }
      
      // 创建可读流
      const readStream = sftp.createReadStream(remotePath);
      const chunks = [];
      let downloaded = 0;
      
      // 设置事件处理器
      readStream.on('error', (err) => {
        logger.error('SFTP文件下载错误', { remotePath, error: err.message });
        sendSftpError(ws, sessionId, operationId, `文件下载错误: ${err.message}`);
      });
      
      readStream.on('data', (chunk) => {
        chunks.push(chunk);
        downloaded += chunk.length;
        
        // 报告进度
        const progress = Math.round((downloaded / fileSize) * 100);
        sendSftpProgress(ws, sessionId, operationId, progress, downloaded, fileSize);
      });
      
      readStream.on('end', () => {
        try {
          // 合并数据块
          const fileBuffer = Buffer.concat(chunks);
          
          // 获取MIME类型
          const mimeType = getMimeType(remotePath);
          
          // 生成Base64数据URI
          const base64 = fileBuffer.toString('base64');
          const dataUri = `data:${mimeType};base64,${base64}`;
          
          // 获取文件名
          const filename = path.basename(remotePath);
          
          // 发送文件内容 - 使用sftp_success类型而不是sftp_file类型
          sendSftpSuccess(ws, sessionId, operationId, {
            responseType: 'file_download',
            filename,
            path: remotePath,
            content: dataUri,
            size: fileSize
          });
          
          logger.info('SFTP文件下载完成', { remotePath, fileSize });
        } catch (err) {
          logger.error('SFTP处理下载文件数据错误', { remotePath, error: err.message });
          sendSftpError(ws, sessionId, operationId, `处理文件数据错误: ${err.message}`);
        }
      });
    });
  }, ws, '文件下载错误', sessionId, operationId);
}

/**
 * SFTP处理函数 - 创建目录
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpMkdir(ws, data) {
  const { sessionId, path: dirPath, operationId } = data;
  
  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }
  
  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    
    // 创建目录
    sftp.mkdir(dirPath, (err) => {
      if (err) {
        logger.error('SFTP创建目录失败', { dirPath, error: err.message });
        
        // 检查是否是因为目录已存在
        if (err.code === 4) {
          sendSftpError(ws, sessionId, operationId, `目录已存在: ${dirPath}`);
        } else {
          sendSftpError(ws, sessionId, operationId, `创建目录失败: ${err.message}`);
        }
        return;
      }
      
      logger.info('SFTP目录创建成功', { dirPath });
      sendSftpSuccess(ws, sessionId, operationId, {
        message: '目录创建成功'
      });
      
      // 如果是在当前目录创建的，刷新目录列表
      if (path.dirname(dirPath) === sftpSession.currentPath) {
        handleSftpList(ws, {
          sessionId,
          path: sftpSession.currentPath,
          operationId: `${operationId}_refresh`
        });
      }
    });
  }, ws, '创建目录错误', sessionId, operationId);
}

/**
 * SFTP处理函数 - 删除文件或目录
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpDelete(ws, data) {
  const { sessionId, path: targetPath, isDirectory, operationId } = data;
  
  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }
  
  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    
    // 根据类型删除文件或目录
    if (isDirectory) {
      // 递归删除目录及其内容
      const deleteDirectoryRecursive = (dirPath, callback) => {
        sftp.readdir(dirPath, (err, list) => {
          if (err) {
            logger.error('SFTP读取目录失败', { dirPath, error: err.message });
            callback(err);
            return;
          }

          // 如果目录为空，直接删除
          if (list.length === 0) {
            sftp.rmdir(dirPath, callback);
            return;
          }

          // 删除目录中的所有文件和子目录
          let completed = 0;
          let hasError = false;

          const checkComplete = (err) => {
            if (hasError) return;

            if (err) {
              hasError = true;
              callback(err);
              return;
            }

            completed++;
            if (completed === list.length) {
              // 所有子项都删除完成，删除目录本身
              sftp.rmdir(dirPath, callback);
            }
          };

          // 遍历目录中的每个项目
          list.forEach(item => {
            const itemPath = path.posix.join(dirPath, item.filename);

            if (item.attrs.isDirectory()) {
              // 递归删除子目录
              deleteDirectoryRecursive(itemPath, checkComplete);
            } else {
              // 删除文件
              sftp.unlink(itemPath, checkComplete);
            }
          });
        });
      };

      // 开始递归删除
      deleteDirectoryRecursive(targetPath, (err) => {
        if (err) {
          logger.error('SFTP删除目录失败', { targetPath, error: err.message });
          sendSftpError(ws, sessionId, operationId, `删除目录失败: ${err.message}`);
          return;
        }

        logger.info('SFTP目录删除成功', { targetPath });
        sendSftpSuccess(ws, sessionId, operationId, {
          message: '目录删除成功'
        });

        // 刷新当前目录
        if (path.dirname(targetPath) === sftpSession.currentPath) {
          handleSftpList(ws, {
            sessionId,
            path: sftpSession.currentPath,
            operationId: `${operationId}_refresh`
          });
        }
      });
    } else {
      // 删除文件
      sftp.unlink(targetPath, (err) => {
        if (err) {
          logger.error('SFTP删除文件失败', { targetPath, error: err.message });
          sendSftpError(ws, sessionId, operationId, `删除文件失败: ${err.message}`);
          return;
        }
        
        logger.info('SFTP文件删除成功', { targetPath });
        sendSftpSuccess(ws, sessionId, operationId, {
          message: '文件删除成功'
        });
        
        // 刷新当前目录
        if (path.dirname(targetPath) === sftpSession.currentPath) {
          handleSftpList(ws, {
            sessionId,
            path: sftpSession.currentPath,
            operationId: `${operationId}_refresh`
          });
        }
      });
    }
  }, ws, '删除错误', sessionId, operationId);
}

/**
 * SFTP处理函数 - 重命名文件或目录
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpRename(ws, data) {
  const { sessionId, oldPath, newPath, operationId } = data;
  
  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }
  
  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    
    // 重命名文件或目录
    sftp.rename(oldPath, newPath, (err) => {
      if (err) {
        logger.error('SFTP重命名失败', { oldPath, newPath, error: err.message });
        sendSftpError(ws, sessionId, operationId, `重命名失败: ${err.message}`);
        return;
      }
      
      logger.info('SFTP重命名成功', { oldPath, newPath });
      sendSftpSuccess(ws, sessionId, operationId, {
        message: '重命名成功'
      });
      
      // 刷新当前目录
      if (path.dirname(oldPath) === sftpSession.currentPath) {
        handleSftpList(ws, {
          sessionId,
          path: sftpSession.currentPath,
          operationId: `${operationId}_refresh`
        });
      }
    });
  }, ws, '重命名错误', sessionId, operationId);
}

/**
 * SFTP处理函数 - 关闭SFTP会话
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpClose(ws, data) {
  const { sessionId, operationId } = data;
  
  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }
  
  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    
    // 关闭SFTP
    if (sftpSession.sftp) {
      try {
        sftpSession.sftp.end();
      } catch (err) {
        logger.error('关闭SFTP错误', { sessionId, error: err.message });
      }
    }
    
    // 从映射中移除
    sftpSessions.delete(sessionId);
    
    logger.info('SFTP会话已关闭', { sessionId });
    sendSftpSuccess(ws, sessionId, operationId, {
      message: 'SFTP会话已关闭'
    });
  }, ws, '关闭SFTP会话错误', sessionId, operationId);
}

/**
 * 获取文件的MIME类型
 * @param {string} filepath 文件路径
 * @returns {string} MIME类型
 */
function getMimeType(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const mimeTypes = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.csv': 'text/csv',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.7z': 'application/x-7z-compressed'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

// 导出函数和对象
module.exports = {
  sftpSessions,
  sendError,
  handleSftpInit,
  handleSftpList,
  handleSftpUpload,
  handleSftpDownload,
  handleSftpMkdir,
  handleSftpDelete,
  handleSftpRename,
  handleSftpClose,
  getMimeType
}; 