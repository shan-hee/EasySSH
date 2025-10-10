// 移除 ts-nocheck：为 SFTP 基础操作补充类型
/**
 * SFTP基础操作模块
 * 处理非传输相关的SFTP操作（列表、创建、删除、重命名等）
 */

const path = require('path');
const logger = require('../utils/logger');
// 引入SSH会话以便执行远端命令（用于Shell快速删除）
const sshModule = require('./ssh');
import type WebSocketType from 'ws';

// 导入二进制SFTP工具函数
const { sendBinarySftpSuccess, sendBinarySftpError } = require('./utils');

// 存储SFTP会话
const sftpSessions = new Map();

function isNotFoundError(err: any): boolean {
  if (!err) return false;
  if (err.code === 2 || err.code === 'ENOENT') return true;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  return message.includes('no such file') || message.includes('no such path');
}

// 通用递归删除实现，允许目标在删除过程中被其他操作清理
function recursiveDeletePath(sftp: any, targetPath: string, callback: (err: any) => void): void {
  sftp.stat(targetPath, (err: any, stats: any) => {
    if (err) {
      if (isNotFoundError(err)) {
        return callback(null);
      }
      err.path = err.path || targetPath;
      return callback(err);
    }

    if (stats.isDirectory()) {
      sftp.readdir(targetPath, (err: any, list: any[]) => {
        if (err) {
          if (isNotFoundError(err)) {
            return callback(null);
          }
          err.path = err.path || targetPath;
          return callback(err);
        }

        const entries = list.filter((item: any) => item && item.filename && item.filename !== '.' && item.filename !== '..');

        if (entries.length === 0) {
          return sftp.rmdir(targetPath, (rmdirErr: any) => {
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

        entries.forEach((item: any) => {
          const itemPath = `${targetPath}/${item.filename}`;
          recursiveDeletePath(sftp, itemPath, (childErr: any) => {
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
              sftp.rmdir(targetPath, (rmdirErr: any) => {
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
      sftp.unlink(targetPath, (unlinkErr: any) => {
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

// 安全Shell参数包装（单引号转义）
function shellQuote(arg: string): string {
  if (typeof arg !== 'string') return "''";
  // POSIX安全单引号：将 ' 替换为 '\''，再整体包裹单引号
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// 最低限度的危险路径拦截：必须是绝对路径，且深度>=2，且不等于若干关键路径
function isDangerousTargetPath(p: string): boolean {
  if (!p || typeof p !== 'string') return true;
  if (!p.startsWith('/')) return true; // 必须是绝对路径
  // 规范化去掉连续斜杠和末尾斜杠（纯字符串处理，避免引入额外依赖）
  const norm = (p.replace(/\/+/g, '/')).replace(/\/+$/,'') || '/';
  const parts = norm.split('/').filter(Boolean);
  const depth = parts.length; // 深度（不含根）
  const dangerousExact = new Set([
    '/', '/root', '/home', '/etc', '/usr', '/var', '/bin', '/sbin', '/lib', '/lib64', '/opt', '/srv', '/proc', '/sys', '/dev', '/boot', '/run', '/mnt', '/media', '/snap'
  ]);
  if (dangerousExact.has(norm as any)) return true;
  if (depth < 2) return true; // 顶层目录（如 /etc、/var）直接删除过于危险
  // 禁止明显可疑的模式
  if (norm.includes('..') || /[\n\r\t]/.test(norm)) return true;
  return false;
}

// 通过SSH执行远端命令（Promise封装）
function execRemoteCommand(sessionId: string, command: string): Promise<{ code: number; stdout: string; stderr: string } | null> {
  try {
    const sessions: Map<string, any> = sshModule?.sessions;
    if (!sessions || !sessions.has(sessionId)) {
      return Promise.resolve(null);
    }
    const session = sessions.get(sessionId);
    if (!session || !session.conn || typeof session.conn.exec !== 'function') {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      try {
        session.conn.exec(command, (err: any, stream: any) => {
          if (err) {
            return resolve({ code: 127, stdout: '', stderr: err?.message || 'exec error' });
          }
          let stdout = '';
          let stderr = '';
          stream.on('data', (d: any) => { stdout += d?.toString?.() ?? ''; });
          stream.stderr.on('data', (d: any) => { stderr += d?.toString?.() ?? ''; });
          stream.on('close', (code: number) => {
            resolve({ code: typeof code === 'number' ? code : 0, stdout, stderr });
          });
        });
      } catch (error: any) {
        resolve({ code: 126, stdout: '', stderr: error?.message || 'exec exception' });
      }
    });
  } catch (e) {
    return Promise.resolve(null);
  }
}

// Shell快速删除实现：优先尝试 rm -rf，失败/不可用则返回 false 让上层回退到SFTP递归删除
async function tryShellFastDelete(sessionId: string, remotePath: string): Promise<{ ok: boolean; detail?: any }> {
  // 基础安全校验（不扩大限制，仅拦截明显危险路径）
  if (isDangerousTargetPath(remotePath)) {
    return { ok: false, detail: { reason: 'PATH_NOT_SAFE' } };
  }

  const quoted = shellQuote(remotePath);
  // 使用绝对路径调用rm，避免alias；添加 -- 防止以 - 开头的名字被当作参数
  const cmd = `/bin/rm -rf -- ${quoted}`;

  const result = await execRemoteCommand(sessionId, cmd);
  if (!result) {
    return { ok: false, detail: { reason: 'NO_EXEC_CHANNEL' } };
  }
  if (result.code === 0) {
    return { ok: true };
  }
  return { ok: false, detail: { reason: 'EXEC_FAILED', code: result.code, stderr: result.stderr } };
}

/**
 * 获取文件MIME类型
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
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
function handleSftpInit(ws: WebSocketType, data: any, sshSessions: Map<string, any>): void {
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

    sshSession.conn.sftp((err: any, sftp: any) => {
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
function handleSftpList(ws: WebSocketType, data: any): void {
  const { sessionId, path: remotePath, operationId } = data;

  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;

    sftp.readdir(remotePath, (err: any, list: any[]) => {
      if (err) {
        logger.error('SFTP列表目录失败', { sessionId, path: remotePath, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `列表目录失败: ${err.message}`, 'SFTP_LIST_ERROR');
        return;
      }

      // 格式化文件列表
      const formattedList = list.map((item: any) => ({
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
function handleSftpMkdir(ws: WebSocketType, data: any): void {
  const { sessionId, path: remotePath, operationId } = data;

  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;

    sftp.mkdir(remotePath, (err: any) => {
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
async function handleSftpDelete(ws: WebSocketType, data: any): Promise<void> {
  const { sessionId, path: remotePath, operationId } = data;

  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;

    logger.debug('SFTP删除请求', { sessionId, path: remotePath, isDirectory: !!data.isDirectory });

    // 先尝试 Shell 快速删除（rm -rf），失败或不可用再回退 SFTP 递归
    try {
      const tryShell = await tryShellFastDelete(sessionId, remotePath);
      if (tryShell.ok) {
        logger.info('Shell快速删除完成', { path: remotePath });
        sendBinarySftpSuccess(ws, sessionId, operationId, {
          message: '删除成功',
          path: remotePath,
          method: 'shell_rm_rf'
        });
        return;
      }
      logger.debug('Shell快速删除未使用/失败，回退SFTP递归删除', { path: remotePath, detail: tryShell.detail });
    } catch (e: any) {
      logger.warn('Shell快速删除异常，回退SFTP递归删除', { path: remotePath, error: e?.message });
    }

    // 回退：使用通用递归删除逻辑（保留原实现）
    recursiveDeletePath(sftp, remotePath, (err) => {
      if (err) {
        logger.error('SFTP删除失败', { sessionId, path: remotePath, errorPath: err.path || remotePath, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `删除失败: ${err.message}`, 'SFTP_DELETE_ERROR');
        return;
      }

      logger.info('SFTP删除成功', { path: remotePath });
      sendBinarySftpSuccess(ws, sessionId, operationId, {
        message: '删除成功',
        path: remotePath,
        method: 'sftp_recursive'
      });
    });
  } catch (error: any) {
    logger.error('SFTP删除错误', { sessionId, error: error.message });
    sendBinarySftpError(ws, sessionId, operationId, error.message, 'SFTP_DELETE_ERROR');
  }
}

/**
 * 处理SFTP快速删除（递归删除目录）
 */
async function handleSftpFastDelete(ws: WebSocketType, data: any): Promise<void> {
  const { sessionId, path: remotePath, operationId } = data;

  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;

    logger.debug('SFTP快速删除请求', { sessionId, path: remotePath });

    // 优先使用 Shell 快速删除
    try {
      const tryShell = await tryShellFastDelete(sessionId, remotePath);
      if (tryShell.ok) {
        logger.info('Shell快速删除完成', { path: remotePath });
        sendBinarySftpSuccess(ws, sessionId, operationId, {
          message: '快速删除成功',
          path: remotePath,
          method: 'shell_rm_rf'
        });
        return;
      }
      logger.debug('Shell快速删除未使用/失败，回退SFTP递归删除', { path: remotePath, detail: tryShell.detail });
    } catch (e: any) {
      logger.warn('Shell快速删除异常，回退SFTP递归删除', { path: remotePath, error: e?.message });
    }

    // 回退：使用SFTP递归删除
    recursiveDeletePath(sftp, remotePath, (err) => {
      if (err) {
        logger.error('SFTP快速删除失败', { sessionId, path: remotePath, errorPath: err.path || remotePath, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `快速删除失败: ${err.message}`, 'SFTP_FAST_DELETE_ERROR');
        return;
      }

      logger.info('SFTP快速删除完成', { path: remotePath });
      sendBinarySftpSuccess(ws, sessionId, operationId, {
        message: '快速删除成功',
        path: remotePath,
        method: 'sftp_recursive'
      });
    });
  } catch (error: any) {
    logger.error('SFTP快速删除错误', { sessionId, error: error.message });
    sendBinarySftpError(ws, sessionId, operationId, error.message, 'SFTP_FAST_DELETE_ERROR');
  }
}

/**
 * 处理SFTP权限修改
 */
function handleSftpChmod(ws: WebSocketType, data: any): void {
  const { sessionId, path: remotePath, mode, operationId } = data;

  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;

    sftp.chmod(remotePath, mode, (err: any) => {
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
function handleSftpRename(ws: WebSocketType, data: any): void {
  const { sessionId, oldPath, newPath, operationId } = data;

  try {
    const sftpSession = sftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }

    const sftp = sftpSession.sftp;

    sftp.rename(oldPath, newPath, (err: any) => {
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
function handleSftpClose(ws: WebSocketType, data: any): void {
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
