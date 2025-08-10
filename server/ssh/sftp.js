/**
 * SFTP 模块
 * 用于处理SFTP文件传输和操作
 */

const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
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
    const matches = content.match(/^data:(.+);base64,(.*)$/);
    if (!matches) {
      throw new Error('无效的文件内容格式');
    }

    // 处理空文件的情况（base64部分可能为空）
    const base64Content = matches[2] || '';
    const buffer = Buffer.from(base64Content, 'base64');
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
    
    // 处理空文件的特殊情况
    if (totalSize === 0) {
      // 对于空文件，直接发送100%进度并结束流
      sendSftpProgress(ws, sessionId, operationId, 100, 0, 0);
      writeStream.end();
      return;
    }

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

  logger.debug('SFTP删除请求', { sessionId, targetPath, isDirectory, operationId, dataKeys: Object.keys(data) });

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
        logger.debug('SFTP开始删除目录', { dirPath });

        sftp.readdir(dirPath, (err, list) => {
          if (err) {
            logger.error('SFTP读取目录失败', { dirPath, error: err.message });
            callback(err);
            return;
          }

          logger.debug('SFTP目录内容', { dirPath, itemCount: list.length, items: list.map(item => ({ name: item.filename, isDir: item.attrs.isDirectory() })) });

          // 过滤掉 . 和 .. 目录
          const filteredList = list.filter(item => item.filename !== '.' && item.filename !== '..');

          // 如果目录为空，直接删除
          if (filteredList.length === 0) {
            logger.debug('SFTP删除空目录', { dirPath });
            sftp.rmdir(dirPath, (err) => {
              if (err) {
                logger.error('SFTP删除空目录失败', { dirPath, error: err.message });
              } else {
                logger.debug('SFTP空目录删除成功', { dirPath });
              }
              callback(err);
            });
            return;
          }

          // 删除目录中的所有文件和子目录
          let completed = 0;
          let hasError = false;

          const checkComplete = (err) => {
            if (hasError) return;

            if (err) {
              hasError = true;
              logger.error('SFTP删除子项失败', { dirPath, error: err.message });
              callback(err);
              return;
            }

            completed++;
            logger.debug('SFTP子项删除进度', { dirPath, completed, total: filteredList.length });

            if (completed === filteredList.length) {
              // 所有子项都删除完成，删除目录本身
              logger.debug('SFTP删除目录本身', { dirPath });
              sftp.rmdir(dirPath, (err) => {
                if (err) {
                  logger.error('SFTP删除目录本身失败', { dirPath, error: err.message });
                } else {
                  logger.debug('SFTP目录删除成功', { dirPath });
                }
                callback(err);
              });
            }
          };

          // 遍历目录中的每个项目
          filteredList.forEach(item => {
            const itemPath = path.posix.join(dirPath, item.filename);
            logger.debug('SFTP删除子项', { itemPath, isDirectory: item.attrs.isDirectory() });

            if (item.attrs.isDirectory()) {
              // 递归删除子目录
              deleteDirectoryRecursive(itemPath, checkComplete);
            } else {
              // 删除文件
              sftp.unlink(itemPath, (err) => {
                if (err) {
                  logger.error('SFTP删除文件失败', { itemPath, error: err.message });
                } else {
                  logger.debug('SFTP文件删除成功', { itemPath });
                }
                checkComplete(err);
              });
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
 * SFTP处理函数 - 快速删除目录（使用SSH命令）
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpFastDelete(ws, data) {
  const { sessionId, path: targetPath, operationId } = data;

  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }

  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    const sshConnection = sftpSession.sshConnection;

    // 使用SSH命令快速删除目录
    const deleteCommand = `rm -rf "${targetPath.replace(/"/g, '\\"')}"`;

    sshConnection.exec(deleteCommand, (err, stream) => {
      if (err) {
        logger.error('SFTP快速删除执行失败', { targetPath, error: err.message });
        sendSftpError(ws, sessionId, operationId, `快速删除失败: ${err.message}`);
        return;
      }

      let stderr = '';

      stream.on('close', (code) => {
        if (code === 0) {
          logger.info('SFTP快速删除成功', { targetPath });
          sendSftpSuccess(ws, sessionId, operationId, {
            message: '快速删除成功'
          });

          // 刷新当前目录
          if (path.dirname(targetPath) === sftpSession.currentPath) {
            handleSftpList(ws, {
              sessionId,
              path: sftpSession.currentPath,
              operationId: `${operationId}_refresh`
            });
          }
        } else {
          logger.error('SFTP快速删除命令失败', {
            targetPath,
            exitCode: code,
            stderr: stderr.trim()
          });
          sendSftpError(ws, sessionId, operationId,
            `快速删除失败 (退出码: ${code}): ${stderr.trim() || '未知错误'}`);
        }
      }).on('data', (data) => {
        // 忽略stdout
      }).stderr.on('data', (data) => {
        stderr += data.toString();
      });
    });
  }, ws, '快速删除错误', sessionId, operationId);
}

/**
 * SFTP处理函数 - 修改文件权限
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpChmod(ws, data) {
  const { sessionId, path: targetPath, permissions, operationId } = data;

  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }

  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;

    // 修改文件权限
    sftp.chmod(targetPath, permissions, (err) => {
      if (err) {
        logger.error('SFTP修改权限失败', { targetPath, permissions: permissions.toString(8), error: err.message });
        sendSftpError(ws, sessionId, operationId, `修改权限失败: ${err.message}`);
        return;
      }

      logger.info('SFTP权限修改成功', { targetPath, permissions: permissions.toString(8) });
      sendSftpSuccess(ws, sessionId, operationId, {
        message: '权限修改成功'
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
  }, ws, '修改权限错误', sessionId, operationId);
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

/**
 * SFTP处理函数 - 下载文件夹（流式ZIP）
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpDownloadFolder(ws, data) {
  const { sessionId, path: remotePath, operationId } = data;

  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }

  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;

    // 验证路径是否为目录
    sftp.stat(remotePath, (err, stats) => {
      if (err) {
        logger.error('SFTP获取文件夹信息失败', { remotePath, error: err.message });
        sendSftpError(ws, sessionId, operationId, `获取文件夹信息失败: ${err.message}`);
        return;
      }

      if (!stats.isDirectory()) {
        sendSftpError(ws, sessionId, operationId, '指定路径不是文件夹');
        return;
      }

      // 开始流式ZIP压缩
      startFolderZipStream(ws, sessionId, operationId, sftp, remotePath);
    });
  }, ws, '文件夹下载错误', sessionId, operationId);
}

/**
 * 开始文件夹的流式ZIP压缩
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {Object} sftp SFTP连接对象
 * @param {string} remotePath 远程文件夹路径
 */
function startFolderZipStream(ws, sessionId, operationId, sftp, remotePath) {
  // 创建ZIP压缩器
  const archive = archiver('zip', {
    zlib: { level: 6 }, // 压缩级别：0-9，6是平衡点
    forceLocalTime: true, // 使用本地时间
    store: false // 不存储未压缩的文件
  });

  // 用于收集ZIP数据块
  const zipChunks = [];
  let totalFiles = 0;
  let processedFiles = 0;
  let totalSize = 0;
  let processedSize = 0;

  // 收集跳过的文件信息
  const skippedFiles = [];
  const errorFiles = [];

  // 监听ZIP数据事件 - 收集数据但不发送进度
  archive.on('data', (chunk) => {
    zipChunks.push(chunk);
    // 不在这里发送进度，避免频繁的进度消息
  });

  // 监听ZIP完成事件
  archive.on('end', () => {
    try {
      // 合并所有ZIP数据块
      const zipBuffer = Buffer.concat(zipChunks);

      // 获取文件夹名称作为ZIP文件名
      const folderName = path.basename(remotePath) || 'folder';
      const zipFilename = `${folderName}.zip`;

      // 发送最终进度（100%）
      sendSftpProgress(ws, sessionId, operationId, 100, totalSize, totalSize);

      // 优化：使用更高效的Base64编码
      const base64 = zipBuffer.toString('base64');
      const dataUri = `data:application/zip;base64,${base64}`;

      // 立即发送完成消息，包含跳过文件的详细信息
      sendSftpSuccess(ws, sessionId, operationId, {
        responseType: 'folder_download',
        filename: zipFilename,
        path: remotePath,
        content: dataUri,
        size: zipBuffer.length,
        fileCount: totalFiles,
        skippedFiles: skippedFiles,
        errorFiles: errorFiles,
        summary: {
          totalFiles: totalFiles,
          includedFiles: totalFiles - skippedFiles.length - errorFiles.length,
          skippedCount: skippedFiles.length,
          errorCount: errorFiles.length
        }
      });

      logger.info('SFTP文件夹下载完成', {
        remotePath,
        zipSize: zipBuffer.length,
        fileCount: totalFiles
      });
    } catch (err) {
      logger.error('SFTP处理ZIP数据错误', { remotePath, error: err.message });
      sendSftpError(ws, sessionId, operationId, `处理ZIP数据错误: ${err.message}`);
    }
  });

  // 监听ZIP错误事件
  archive.on('error', (err) => {
    logger.error('SFTP ZIP压缩错误', { remotePath, error: err.message });
    sendSftpError(ws, sessionId, operationId, `ZIP压缩错误: ${err.message}`);
  });

  // 开始递归添加文件到ZIP
  addFolderToZip(archive, sftp, remotePath, '', skippedFiles, errorFiles, (fileCount, size) => {
    totalFiles = fileCount;
    totalSize = size;

    // 检查文件夹大小限制（默认500MB）
    const maxFolderSize = parseInt(process.env.MAX_FOLDER_SIZE) || 524288000; // 500MB
    if (totalSize > maxFolderSize) {
      logger.warn('SFTP文件夹过大', { remotePath, totalSize, maxFolderSize });
      sendSftpError(ws, sessionId, operationId,
        `文件夹太大 (${(totalSize / (1024 * 1024)).toFixed(2)} MB)，超过限制 (${(maxFolderSize / (1024 * 1024)).toFixed(2)} MB)`);
      return;
    }

    logger.info('SFTP开始压缩文件夹', { remotePath, fileCount, totalSize });

    // 完成添加文件，开始压缩
    archive.finalize();
  }, (error, size) => {
    if (error) {
      // 记录警告但不中断整个过程
      logger.warn('SFTP跳过有问题的文件', { remotePath, error: error.message });
    }

    // 无论是否有错误，都继续处理
    processedFiles++;
    processedSize += size || 0;

    // 只在特定间隔发送进度更新，避免过于频繁
    const progress = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;
    if (processedFiles % 5 === 0 || processedFiles === totalFiles) {
      sendSftpProgress(ws, sessionId, operationId, progress, processedSize, totalSize);
    }
  });
}

/**
 * 递归添加文件夹内容到ZIP
 * @param {Object} archive ZIP压缩器
 * @param {Object} sftp SFTP连接对象
 * @param {string} remotePath 远程路径
 * @param {string} zipPath ZIP内路径
 * @param {Array} skippedFiles 跳过文件列表
 * @param {Array} errorFiles 错误文件列表
 * @param {Function} onComplete 完成回调 (fileCount, totalSize)
 * @param {Function} onProgress 进度回调 (error, size)
 */
function addFolderToZip(archive, sftp, remotePath, zipPath, skippedFiles, errorFiles, onComplete, onProgress) {
  let fileCount = 0;
  let totalSize = 0;
  let pendingOperations = 0;
  let completed = false;

  function checkCompletion() {
    if (pendingOperations === 0 && !completed) {
      completed = true;
      onComplete(fileCount, totalSize);
    }
  }

  function processDirectory(dirPath, zipDirPath) {
    pendingOperations++;

    sftp.readdir(dirPath, (err, list) => {
      if (err) {
        pendingOperations--;
        // 记录警告但不中断整个过程
        logger.warn('SFTP跳过无法读取的目录', { dirPath, error: err.message });
        checkCompletion();
        return;
      }

      if (list.length === 0) {
        // 空目录，直接添加目录条目
        archive.append('', { name: zipDirPath + '/' });
        pendingOperations--;
        checkCompletion();
        return;
      }

      list.forEach(item => {
        try {
          // 跳过隐藏文件和特殊目录
          if (item.filename.startsWith('.') &&
              item.filename !== '.' &&
              item.filename !== '..') {
            return;
          }

          // 跳过上级目录引用
          if (item.filename === '..' || item.filename === '.') {
            return;
          }

          // 先定义路径变量
          const itemRemotePath = path.posix.join(dirPath, item.filename);
          const itemZipPath = zipDirPath ?
            path.posix.join(zipDirPath, item.filename) :
            item.filename;

          // 跳过一些可能有问题的文件/目录
          const skipPatterns = [
            'node_modules',
            '.git',
            '.vscode',
            '.idea',
            'dist',
            'build',
            'coverage',
            '.nyc_output',
            '*.tmp',
            '*.temp'
          ];

          const shouldSkip = skipPatterns.some(pattern => {
            if (pattern.includes('*')) {
              const regex = new RegExp(pattern.replace('*', '.*'));
              return regex.test(item.filename);
            }
            return item.filename === pattern;
          });

          if (shouldSkip) {
            skippedFiles.push({
              path: itemRemotePath,
              reason: '系统文件/目录',
              type: 'auto_skip'
            });
            logger.info('SFTP跳过文件/目录', { filename: item.filename, path: itemRemotePath, reason: '匹配跳过模式' });
            return;
          }

          // 检查文件属性是否有效
          if (!item.attrs) {
            skippedFiles.push({
              path: itemRemotePath,
              reason: '无效文件属性',
              type: 'error'
            });
            logger.warn('SFTP跳过无效属性的项目', { filename: item.filename });
            return;
          }

          if (item.attrs.isDirectory()) {
            // 递归处理子目录
            processDirectory(itemRemotePath, itemZipPath);
          } else if (item.attrs.isFile()) {
            // 只处理普通文件
            pendingOperations++;
            fileCount++;
            totalSize += item.attrs.size || 0;

            addFileToZip(archive, sftp, itemRemotePath, itemZipPath, item.attrs.size, skippedFiles, (error, size) => {
              pendingOperations--;
              if (error) {
                // 记录错误文件
                errorFiles.push({
                  path: itemRemotePath,
                  reason: error.message,
                  type: 'read_error',
                  size: item.attrs.size
                });
                logger.warn('SFTP跳过无法处理的文件', {
                  filename: item.filename,
                  error: error.message
                });
              }
              onProgress(error, size);
              checkCompletion();
            });
          } else {
            // 跳过符号链接、设备文件等特殊文件
            skippedFiles.push({
              path: itemRemotePath,
              reason: '特殊文件类型（符号链接/设备文件等）',
              type: 'special_file'
            });
            logger.debug('SFTP跳过特殊文件', {
              filename: item.filename,
              type: 'special_file'
            });
          }
        } catch (itemError) {
          logger.warn('SFTP处理项目时出错', {
            filename: item.filename,
            error: itemError.message
          });
        }
      });

      pendingOperations--;
      checkCompletion();
    });
  }

  // 开始处理根目录
  processDirectory(remotePath, zipPath);
}

/**
 * 添加单个文件到ZIP
 * @param {Object} archive ZIP压缩器
 * @param {Object} sftp SFTP连接对象
 * @param {string} remotePath 远程文件路径
 * @param {string} zipPath ZIP内路径
 * @param {number} fileSize 文件大小
 * @param {Function} callback 完成回调 (error, size)
 */
function addFileToZip(archive, sftp, remotePath, zipPath, fileSize, skippedFiles, callback) {
  try {
    // 跳过过大的文件（默认100MB）
    const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 104857600; // 100MB
    if (fileSize > maxFileSize) {
      if (skippedFiles) {
        skippedFiles.push({
          path: remotePath,
          reason: `文件过大 (${(fileSize / (1024 * 1024)).toFixed(2)} MB > ${(maxFileSize / (1024 * 1024)).toFixed(2)} MB)`,
          type: 'large_file',
          size: fileSize
        });
      }
      logger.warn('SFTP跳过过大文件', {
        remotePath,
        fileSize,
        maxFileSize
      });
      callback(null, 0); // 跳过但不报错
      return;
    }

    // 创建文件读取流
    const readStream = sftp.createReadStream(remotePath);
    let hasEnded = false;
    let hasErrored = false;

    // 设置超时
    const timeout = setTimeout(() => {
      if (!hasEnded && !hasErrored) {
        hasErrored = true;
        logger.warn('SFTP文件读取超时', { remotePath });
        readStream.destroy();
        callback(null, 0); // 超时时跳过文件
      }
    }, 30000); // 30秒超时

    readStream.on('error', (err) => {
      if (!hasErrored) {
        hasErrored = true;
        clearTimeout(timeout);
        logger.warn('SFTP跳过无法读取的文件', {
          remotePath,
          error: err.message
        });
        callback(null, 0); // 出错时跳过文件，不中断整个过程
      }
    });

    readStream.on('end', () => {
      if (!hasEnded && !hasErrored) {
        hasEnded = true;
        clearTimeout(timeout);
        callback(null, fileSize);
      }
    });

    readStream.on('close', () => {
      if (!hasEnded && !hasErrored) {
        hasEnded = true;
        clearTimeout(timeout);
        callback(null, fileSize);
      }
    });

    // 将文件流添加到ZIP
    archive.append(readStream, { name: zipPath });
  } catch (error) {
    logger.warn('SFTP添加文件到ZIP时出错', {
      remotePath,
      error: error.message
    });
    callback(null, 0); // 出错时跳过文件
  }
}

// 导出函数和对象
module.exports = {
  sftpSessions,
  sendError,
  handleSftpInit,
  handleSftpList,
  handleSftpUpload,
  handleSftpDownload,
  handleSftpDownloadFolder,
  handleSftpMkdir,
  handleSftpDelete,
  handleSftpFastDelete,
  handleSftpChmod,
  handleSftpRename,
  handleSftpClose,
  getMimeType
};