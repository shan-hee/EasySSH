/**
 * SFTP 二进制传输模块
 * 用于处理基于二进制协议的SFTP文件传输和操作
 */

const path = require('path');
const archiver = require('archiver');
const logger = require('../utils/logger');

// 导入工具模块
const {
  BINARY_MSG_TYPE,
  sendBinaryMessage,
  sendBinarySftpSuccess,
  sendBinarySftpError,
  validateSftpSession,
  safeExec,
  BinaryMessageDecoder,
  ChunkedTransfer,
  ChunkReassembler,
  ChecksumValidator
} = require('./utils');

// 导入SFTP操作处理器
const sftpOperations = require('./sftp-operations');

// 存储活动的SFTP会话 (复用原有的)
let sftpSessions = null;

// 分块重组器实例
const chunkReassembler = new ChunkReassembler();

// 活动传输映射：operationId -> { type: 'file'|'tar'|'zip', stream?, archive? }
const activeTransfers = new Map();
// 已取消操作集合，用于抑制后续成功回调
const canceledOperations = new Set();

/**
 * 设置SFTP会话引用
 * @param {Map} sessions SFTP会话Map
 */
function setSftpSessions(sessions) {
  sftpSessions = sessions;
}

/**
 * 处理二进制WebSocket消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Buffer} messageBuffer 消息缓冲区
 * @param {Object} sshSessions SSH会话集合
 */
async function handleBinaryMessage(ws, messageBuffer, sshSessions) {
  try {
    // 解码消息
    const message = BinaryMessageDecoder.decode(messageBuffer);
    const { messageType, headerData, payloadData } = message;
    
    logger.debug('收到二进制消息', { 
      type: messageType, 
      sessionId: headerData.sessionId,
      operationId: headerData.operationId,
      payloadSize: payloadData ? payloadData.length : 0
    });
    
    // 根据消息类型分发处理
    switch (messageType) {
      case BINARY_MSG_TYPE.SFTP_INIT:
        await handleBinarySftpInit(ws, headerData, sshSessions);
        break;
        
      case BINARY_MSG_TYPE.SFTP_LIST:
        await handleBinarySftpList(ws, headerData);
        break;
        
      case BINARY_MSG_TYPE.SFTP_MKDIR:
        await handleBinarySftpMkdir(ws, headerData);
        break;
        
      case BINARY_MSG_TYPE.SFTP_DELETE:
        await handleBinarySftpDelete(ws, headerData);
        break;
        
      case BINARY_MSG_TYPE.SFTP_RENAME:
        await handleBinarySftpRename(ws, headerData);
        break;
        
      case BINARY_MSG_TYPE.SFTP_CHMOD:
        await handleBinarySftpChmod(ws, headerData);
        break;
        
      case BINARY_MSG_TYPE.SFTP_CLOSE:
        await handleBinarySftpClose(ws, headerData);
        break;
        
      case BINARY_MSG_TYPE.SFTP_CANCEL:
        await handleBinarySftpCancel(ws, headerData);
        break;
        
      case BINARY_MSG_TYPE.SFTP_UPLOAD:
        await handleBinaryUpload(ws, headerData, payloadData, sshSessions);
        break;
        
      case BINARY_MSG_TYPE.SFTP_DOWNLOAD:
        await handleBinaryDownload(ws, headerData, sshSessions);
        break;
        
      case BINARY_MSG_TYPE.SFTP_DOWNLOAD_FOLDER:
        await handleBinaryDownloadFolder(ws, headerData, sshSessions);
        break;
        
      default:
        logger.warn(`未知的二进制消息类型: ${messageType}`);
        sendBinarySftpError(ws, headerData.sessionId, headerData.operationId, 
          `未知的消息类型: ${messageType}`, 'INVALID_MESSAGE_TYPE');
    }
  } catch (error) {
    logger.error('处理二进制消息失败:', error);
    // 尝试从消息中提取会话信息发送错误
    try {
      const partialMessage = BinaryMessageDecoder.decode(messageBuffer.slice(0, Math.min(1024, messageBuffer.length)));
      sendBinarySftpError(ws, partialMessage.headerData.sessionId, 
        partialMessage.headerData.operationId, error.message, 'MESSAGE_PROCESSING_ERROR');
    } catch (decodeError) {
      logger.error('无法解码错误消息:', decodeError);
    }
  }
}

/**
 * 处理二进制文件上传
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} headerData 头部数据
 * @param {Buffer} payloadData 文件数据
 * @param {Object} sshSessions SSH会话集合
 */
async function handleBinaryUpload(ws, headerData, payloadData, sshSessions) {
  const { sessionId, operationId, filename, remotePath, fileSize, chunkIndex, totalChunks, checksum } = headerData;

  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }

  const uploadStartTime = Date.now();

  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    
    let fileBuffer = payloadData;
    
    // 处理空文件情况
    if (!fileBuffer || fileBuffer.length === 0) {
      fileBuffer = Buffer.alloc(0); // 创建空的Buffer
      logger.debug('处理空文件上传', { operationId, remotePath });
    }
    
    // 处理分块传输
    if (totalChunks && totalChunks > 1) {
      // 对于分块传输，确保payloadData不为null
      const chunkData = payloadData || Buffer.alloc(0);
      logger.debug(`接收分块 ${chunkIndex + 1}/${totalChunks}`, { operationId, size: chunkData.length });
      
      // 添加分块到重组器
      fileBuffer = chunkReassembler.addChunk(operationId, chunkIndex, totalChunks, chunkData);
      
      if (!fileBuffer) {
        // 分块未完成，发送进度
        const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
        sendBinaryMessage(ws, BINARY_MSG_TYPE.SFTP_PROGRESS, {
          sessionId,
          operationId,
          progress,
          bytesTransferred: (chunkIndex + 1) * payloadData.length,
          totalBytes: fileSize,
          timestamp: Date.now()
        });
        return;
      }
      
      logger.info(`分块重组完成`, { operationId, totalSize: fileBuffer.length });
    }
    
    // 验证校验和
    if (checksum) {
      const isValid = ChecksumValidator.validateChecksum(fileBuffer, checksum);
      if (!isValid) {
        throw new Error('文件校验和不匹配');
      }
      logger.debug('文件校验和验证通过', { operationId });
    }
    
    // 检查文件大小限制
    const maxUploadSize = parseInt(process.env.MAX_UPLOAD_SIZE) || 104857600; // 默认100MB
    if (fileBuffer.length > maxUploadSize) {
      const fileSizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2);
      const maxSizeMB = (maxUploadSize / (1024 * 1024)).toFixed(0);
      throw new Error(`文件大小 ${fileSizeMB}MB 超过最大限制 ${maxSizeMB}MB`);
    }
    
    // 对于空文件，使用 writeFile 而不是流，因为某些SFTP实现对空流处理有问题
    if (fileBuffer.length === 0) {
      logger.debug('使用writeFile处理空文件', { operationId, remotePath });
      
      sftp.writeFile(remotePath, fileBuffer, (err) => {
        if (err) {
          logger.error('空文件创建错误', { remotePath, error: err.message });
          sendBinarySftpError(ws, sessionId, operationId, `文件创建错误: ${err.message}`, 'UPLOAD_ERROR');
          return;
        }
        
        const uploadEndTime = Date.now();
        const uploadDuration = uploadEndTime - uploadStartTime;
        
        logger.info('空文件创建完成', {
          remotePath,
          duration: uploadDuration
        });
        
        sendBinarySftpSuccess(ws, sessionId, operationId, {
          message: '文件创建成功',
          filename,
          remotePath,
          totalSize: 0,
          checksum: ChecksumValidator.calculateSHA256(fileBuffer),
          uploadDuration,
          transferSpeed: 0
        });
      });
      
      return;
    }
    
    // 对于非空文件，使用流处理
    const writeStream = sftp.createWriteStream(remotePath);
    activeTransfers.set(operationId, { type: 'upload', stream: writeStream });

    let uploadNotified = false;

    const notifySuccess = () => {
      if (uploadNotified) return;
      uploadNotified = true;

      const uploadEndTime = Date.now();
      const uploadDuration = uploadEndTime - uploadStartTime;

      logger.info('二进制文件上传完成', {
        remotePath,
        totalSize: fileBuffer.length,
        duration: uploadDuration,
        speedMBps: (fileBuffer.length / (uploadDuration / 1000) / (1024 * 1024)).toFixed(2)
      });

      sendBinarySftpSuccess(ws, sessionId, operationId, {
        message: '文件上传成功',
        filename,
        remotePath,
        totalSize: fileBuffer.length,
        checksum: ChecksumValidator.calculateSHA256(fileBuffer),
        uploadDuration,
        transferSpeed: fileBuffer.length / (uploadDuration / 1000)
      });
    };

    writeStream.on('error', (err) => {
      if (uploadNotified) return;
      logger.error('二进制文件上传错误', { remotePath, error: err.message });
      sendBinarySftpError(ws, sessionId, operationId, `文件上传错误: ${err.message}`, 'UPLOAD_ERROR');
      activeTransfers.delete(operationId);
    });

    // 某些环境只触发close，不触发finish，这里都监听并只发送一次成功
    writeStream.on('finish', () => { activeTransfers.delete(operationId); notifySuccess(); });
    writeStream.on('close', () => { activeTransfers.delete(operationId); notifySuccess(); });

    // 写入完整文件数据
    writeStream.end(fileBuffer);
    
  }, ws, '二进制文件上传错误', sessionId, operationId, false);
}

/**
 * 处理二进制文件下载
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} headerData 头部数据
 * @param {Object} sshSessions SSH会话集合
 */
async function handleBinaryDownload(ws, headerData, sshSessions) {
  const { sessionId, operationId, remotePath } = headerData;

  if (!validateSftpSession(ws, sessionId, sftpSessions, operationId)) {
    return;
  }

  const downloadStartTime = Date.now();

  await safeExec(async () => {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    
    // 获取文件信息
    sftp.stat(remotePath, (err, stats) => {
      if (err) {
        logger.error('获取文件信息失败', { remotePath, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `获取文件信息失败: ${err.message}`, 'FILE_STAT_ERROR');
        return;
      }
      
      // 确认是文件而非目录
      if (stats.isDirectory()) {
        sendBinarySftpError(ws, sessionId, operationId, '不能下载目录', 'INVALID_FILE_TYPE');
        return;
      }
      
      const fileSize = stats.size;
      
      // 创建可读流
      const readStream = sftp.createReadStream(remotePath);
      activeTransfers.set(operationId, { type: 'file', stream: readStream });
      const chunks = [];
      let downloaded = 0;
      
      readStream.on('error', (err) => {
        logger.error('二进制文件下载错误', { remotePath, error: err.message });
        sendBinarySftpError(ws, sessionId, operationId, `文件下载错误: ${err.message}`, 'DOWNLOAD_ERROR');
        activeTransfers.delete(operationId);
      });
      
      readStream.on('data', (chunk) => {
        chunks.push(chunk);
        downloaded += chunk.length;
        
        // 发送进度更新
        const progress = Math.round((downloaded / fileSize) * 100);
        sendBinaryMessage(ws, BINARY_MSG_TYPE.SFTP_PROGRESS, {
          sessionId,
          operationId,
          progress,
          bytesTransferred: downloaded,
          totalBytes: fileSize,
          timestamp: Date.now()
        });
      });
      
      readStream.on('end', () => {
        try {
          if (canceledOperations.has(operationId)) {
            // 已取消则不再发送成功
            canceledOperations.delete(operationId);
            return;
          }
          activeTransfers.delete(operationId);
          const downloadEndTime = Date.now();
          const downloadDuration = downloadEndTime - downloadStartTime;

          // 合并数据块
          const fileBuffer = Buffer.concat(chunks);
          const checksum = ChecksumValidator.calculateSHA256(fileBuffer);

          // 下载完成

          // 获取文件名和MIME类型
          const filename = path.basename(remotePath);
          const mimeType = getMimeType(remotePath);

          // 发送文件数据
          sendBinarySftpSuccess(ws, sessionId, operationId, {
            responseType: 'file_download',
            filename,
            remotePath,
            size: fileSize,
            mimeType,
            checksum,
            downloadDuration,
            transferSpeed: fileBuffer.length / (downloadDuration / 1000) // bytes per second
          }, fileBuffer);

          logger.info('二进制文件下载完成', {
            remotePath,
            fileSize,
            duration: downloadDuration,
            speedMBps: (fileBuffer.length / (downloadDuration / 1000) / (1024 * 1024)).toFixed(2)
          });
        } catch (err) {
          // 数据处理错误

          logger.error('处理下载文件数据错误', { remotePath, error: err.message });
          sendBinarySftpError(ws, sessionId, operationId, `处理文件数据错误: ${err.message}`, 'DATA_PROCESSING_ERROR');
        }
      });
    });
  }, ws, '二进制文件下载错误', sessionId, operationId);
}

/**
 * 处理二进制文件夹下载
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} headerData 头部数据
 * @param {Object} sshSessions SSH会话集合
 */
async function handleBinaryDownloadFolder(ws, headerData, sshSessions) {
  const { sessionId, operationId, remotePath, archiveMethod } = headerData;

  // 不强制SFTP会话（主流方案走SSH远端tar），仅在回退ZIP时检查是否存在SFTP会话

  // 优先使用远端tar.gz流式下载；失败再回退到现有ZIP方案
  await safeExec(async () => {
    // 校验SSH会话可用
    if (!sshSessions || !sshSessions.has(sessionId)) {
      throw new Error('SSH会话不存在');
    }

    const sshSession = sshSessions.get(sessionId);
    if (!sshSession || !sshSession.conn) {
      throw new Error('SSH连接未建立');
    }

    const conn = sshSession.conn;

    // 远端路径安全转义（单引号安全）
    const escapeSingleQuotes = (s) => String(s).replace(/'/g, `'"'"'`);
    const remoteQuoted = `'${escapeSingleQuotes(remotePath)}'`;

    // 预检查：确认tar存在，并估算大小/文件数（用于进度与摘要）
    const preflightCmd = `sh -c "set -e; if ! command -v tar >/dev/null 2>&1; then echo __NO_TAR__; exit 127; fi; D=${remoteQuoted}; if [ ! -d \"$D\" ]; then echo __NOT_DIR__; exit 126; fi; BYTES=$(du -sb -- \"$D\" 2>/dev/null | awk '{print $1}'); if [ -z \"$BYTES\" ]; then BYTES=$(du -sk -- \"$D\" 2>/dev/null | awk '{print $1 * 1024}'); fi; FILES=$(find -- \"$D\" -type f 2>/dev/null | wc -l | tr -d ' '); echo $BYTES $FILES"`;

    const execOnce = (command) => new Promise((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) return reject(err);
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        stream.on('data', (d) => { stdout = Buffer.concat([stdout, Buffer.from(d)]); });
        stream.stderr.on('data', (d) => { stderr = Buffer.concat([stderr, Buffer.from(d)]); });
        stream.on('close', (code) => {
          resolve({ code, stdout: stdout.toString('utf8').trim(), stderr: stderr.toString('utf8') });
        });
        stream.on('error', reject);
      });
    });

    const preflight = await execOnce(preflightCmd);

    if (preflight.code !== 0 || preflight.stdout.includes('__NO_TAR__')) {
      logger.warn('远端无tar或预检查失败，回退到SFTP ZIP方案', { code: preflight.code, out: preflight.stdout, err: preflight.stderr });
      // 回退：使用现有ZIP方案
      const sftpSession = sftpSessions.get(sessionId);
      if (!sftpSession) throw new Error('SFTP会话不存在，无法回退ZIP');
      startBinaryFolderZipStream(ws, sessionId, operationId, sftpSession.sftp, remotePath);
      return;
    }

    if (preflight.stdout.includes('__NOT_DIR__')) {
      sendBinarySftpError(ws, sessionId, operationId, '指定路径不是文件夹', 'INVALID_FOLDER_TYPE');
      return;
    }

    let totalBytes = 0;
    let fileCount = 0;
    try {
      const parts = preflight.stdout.split(/\s+/);
      totalBytes = parseInt(parts[0] || '0', 10) || 0;
      fileCount = parseInt(parts[1] || '0', 10) || 0;
    } catch (_) {
      totalBytes = 0;
      fileCount = 0;
    }

    // 如果无法通过du获取大小，降级用SFTP递归估算
    if (!totalBytes && sftpSessions && sftpSessions.has(sessionId)) {
      try {
        const sftp = sftpSessions.get(sessionId).sftp;
        totalBytes = await estimateFolderSizeViaSftp(sftp, remotePath);
        logger.debug('通过SFTP估算目录大小', { remotePath, totalBytes });
      } catch (e) {
        logger.warn('SFTP估算目录大小失败', { error: e.message });
      }
    }

    // 进一步尝试：使用远端find+stat累加（GNU/BSD兼容探测）
    if (!totalBytes) {
      try {
        const sumCmd = `sh -c "D=${remoteQuoted}; if [ ! -d \"$D\" ]; then echo 0; exit 0; fi; \
          if stat --version >/dev/null 2>&1; then \
            find \"$D\" -type f -exec stat -c %s {} + 2>/dev/null | awk '{s+=\$1} END {print s+0}'; \
          else \
            find \"$D\" -type f -exec stat -f %z {} + 2>/dev/null | awk '{s+=\$1} END {print s+0}'; \
          fi"`;
        const sumRes = await execOnce(sumCmd);
        const parsed = parseInt((sumRes.stdout || '').trim() || '0', 10) || 0;
        if (parsed > 0) {
          totalBytes = parsed;
          logger.debug('通过find/stat估算目录大小', { remotePath, totalBytes });
        }
      } catch (e) {
        logger.warn('find/stat估算目录大小失败', { error: e.message });
      }
    }

    // 文件夹大小限制（与现有ZIP方案保持一致，默认500MB，可通过MAX_FOLDER_SIZE配置）
    const maxFolderSize = parseInt(process.env.MAX_FOLDER_SIZE) || 524288000; // 500MB
    if (totalBytes > maxFolderSize) {
      logger.warn('文件夹过大（远端tar预检查）', { remotePath, totalBytes, maxFolderSize });
      sendBinarySftpError(ws, sessionId, operationId,
        `文件夹太大 (${(totalBytes / (1024 * 1024)).toFixed(2)} MB)，超过限制 (${(maxFolderSize / (1024 * 1024)).toFixed(2)} MB)`,
        'FOLDER_TOO_LARGE');
      return;
    }

    // 根据用户指定或默认，选择tar方案（默认远端tar.gz）
    const preferTar = archiveMethod ? (archiveMethod === 'remote_tar') : true;
    if (!preferTar) {
      const sftpSession = sftpSessions.get(sessionId);
      if (!sftpSession) throw new Error('SFTP会话不存在，无法回退ZIP');
      startBinaryFolderZipStream(ws, sessionId, operationId, sftpSession.sftp, remotePath);
      return;
    }

    const folderName = path.basename(remotePath) || 'folder';
    const tgzFilename = `${folderName}.tar.gz`;

    // 构建tar命令（尽可能保留权限/ACL/xattrs），如失败再尝试简化参数
    const tarCmds = [
      `sh -c "cd ${remoteQuoted} && tar --numeric-owner -p --acls --xattrs -czf - ."`,
      `sh -c "cd ${remoteQuoted} && tar -p -czf - ."`
    ];

    let tried = 0;
    let succeeded = false;
    let lastErr = null;

    while (tried < tarCmds.length && !succeeded) {
      const cmd = tarCmds[tried++];
      try {
        await new Promise((resolve, reject) => {
          conn.exec(cmd, (err, stream) => {
            if (err) return reject(err);

            const chunks = [];
            let bytesTransferred = 0;
            activeTransfers.set(operationId, { type: 'tar', stream });

            stream.on('data', (chunk) => {
              const buf = Buffer.from(chunk);
              chunks.push(buf);
              bytesTransferred += buf.length;

              // 发送进度（使用实际传输字节数，估算压缩比约30%）
              let progress = 0;
              if (totalBytes > 0) {
                // 假设tar.gz压缩比约为30%，动态调整预期大小
                const estimatedCompressedSize = Math.max(totalBytes * 0.3, bytesTransferred);
                progress = Math.min(99, Math.round((bytesTransferred / estimatedCompressedSize) * 100));
              }
              sendBinaryMessage(ws, BINARY_MSG_TYPE.SFTP_PROGRESS, {
                sessionId,
                operationId,
                progress,
                bytesTransferred,
                totalBytes: totalBytes, // 保持原始大小用于显示
                estimatedSize: Math.max(totalBytes * 0.3, bytesTransferred), // 新增：预估压缩后大小
                timestamp: Date.now()
              });
            });

            stream.stderr.on('data', (d) => {
              // 有些tar会把进度或警告写入stderr，必要时可记录
              const msg = d.toString('utf8');
              if (msg && msg.trim()) {
                logger.debug('tar stderr', { msg: msg.slice(0, 256) });
              }
            });

            stream.on('close', (code) => {
              const wasCancelled = canceledOperations.has(operationId);
              canceledOperations.delete(operationId);
              activeTransfers.delete(operationId);
              if (wasCancelled) {
                // 已取消则不返回成功
                return resolve();
              }
              if (code !== 0) {
                return reject(new Error(`tar 退出码: ${code}`));
              }
              try {
                const tarBuffer = Buffer.concat(chunks);
                const checksum = ChecksumValidator.calculateSHA256(tarBuffer);

                // 发送最终进度（100%）
                sendBinaryMessage(ws, BINARY_MSG_TYPE.SFTP_PROGRESS, {
                  sessionId,
                  operationId,
                  progress: 100,
                  bytesTransferred: tarBuffer.length,
                  totalBytes,
                  estimatedSize: tarBuffer.length, // 最终确定的压缩后大小
                  timestamp: Date.now()
                });

                // 发送文件夹数据
                sendBinaryMessage(ws, BINARY_MSG_TYPE.SFTP_FOLDER_DATA, {
                  sessionId,
                  operationId,
                  responseType: 'folder_download',
                  filename: tgzFilename,
                  remotePath,
                  size: tarBuffer.length,
                  mimeType: 'application/gzip',
                  checksum,
                  fileCount,
                  skippedFiles: [],
                  errorFiles: [],
                  summary: {
                    totalFiles: fileCount,
                    includedFiles: fileCount,
                    skippedCount: 0,
                    errorCount: 0
                  },
                  timestamp: Date.now()
                }, tarBuffer);

                logger.info('远端tar.gz文件夹下载完成', {
                  path: path.basename(remotePath),
                  size: tarBuffer.length,
                  files: fileCount
                });
                resolve();
              } catch (e) {
                reject(e);
              }
            });

            stream.on('error', reject);
          });
        });
        succeeded = true;
      } catch (err) {
        lastErr = err;
        logger.warn('远端tar打包失败，尝试下一方案或回退', { error: err.message, attempt: tried });
      }
    }

    if (!succeeded) {
      // 回退：使用现有ZIP方案
      const sftpSession = sftpSessions.get(sessionId);
      if (!sftpSession) throw new Error(`远端tar失败且无SFTP会话可用: ${lastErr ? lastErr.message : 'unknown error'}`);
      logger.warn('远端tar全部失败，回退到SFTP ZIP方案', { reason: lastErr ? lastErr.message : 'unknown' });
      startBinaryFolderZipStream(ws, sessionId, operationId, sftpSession.sftp, remotePath);
    }
  }, ws, '二进制文件夹下载错误', sessionId, operationId);
}

/**
 * 开始二进制文件夹ZIP压缩流
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {Object} sftp SFTP连接对象
 * @param {string} remotePath 远程文件夹路径
 */
function startBinaryFolderZipStream(ws, sessionId, operationId, sftp, remotePath) {
  // 从环境变量读取压缩级别配置
  const compressionLevel = parseInt(process.env.SFTP_COMPRESSION_LEVEL) || 6;

  // 创建ZIP压缩器
  const archive = archiver('zip', {
    zlib: { level: compressionLevel }, // 压缩级别：0-9，默认6是平衡点
    forceLocalTime: true,
    store: false
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

  // 监听ZIP数据事件
  archive.on('data', (chunk) => {
    zipChunks.push(chunk);
    
    // 实时发送ZIP压缩进度（基于已生成的ZIP数据大小）
    const currentZipSize = zipChunks.reduce((total, buf) => total + buf.length, 0);
    if (totalSize > 0) {
      // 估算ZIP压缩比约为40%，动态调整预期大小
      const estimatedZipSize = Math.max(totalSize * 0.4, currentZipSize);
      const progress = Math.min(99, Math.round((currentZipSize / estimatedZipSize) * 100));
      
      sendBinaryMessage(ws, BINARY_MSG_TYPE.SFTP_PROGRESS, {
        sessionId,
        operationId,
        progress,
        bytesTransferred: currentZipSize,
        totalBytes: totalSize,
        estimatedSize: estimatedZipSize,
        timestamp: Date.now()
      });
    }
  });

  // 监听ZIP完成事件
  archive.on('end', () => {
    try {
      if (canceledOperations.has(operationId)) {
        canceledOperations.delete(operationId);
        activeTransfers.delete(operationId);
        return;
      }
      // 合并所有ZIP数据块
      const zipBuffer = Buffer.concat(zipChunks);
      const checksum = ChecksumValidator.calculateSHA256(zipBuffer);

      // 获取文件夹名称作为ZIP文件名
      const folderName = path.basename(remotePath) || 'folder';
      const zipFilename = `${folderName}.zip`;

      // 发送最终进度（100%）
      sendBinaryMessage(ws, BINARY_MSG_TYPE.SFTP_PROGRESS, {
        sessionId,
        operationId,
        progress: 100,
        bytesTransferred: zipBuffer.length, // 使用实际ZIP大小
        totalBytes: totalSize,
        estimatedSize: zipBuffer.length, // 最终确定的压缩后大小
        timestamp: Date.now()
      });

      // 发送文件夹数据消息，包含ZIP数据
      sendBinaryMessage(ws, BINARY_MSG_TYPE.SFTP_FOLDER_DATA, {
        sessionId,
        operationId,
        responseType: 'folder_download',
        filename: zipFilename,
        remotePath,
        size: zipBuffer.length,
        mimeType: 'application/zip',
        checksum,
        fileCount: totalFiles,
        skippedFiles: skippedFiles,
        errorFiles: errorFiles,
        summary: {
          totalFiles: totalFiles,
          includedFiles: totalFiles - skippedFiles.length - errorFiles.length,
          skippedCount: skippedFiles.length,
          errorCount: errorFiles.length
        },
        timestamp: Date.now()
      }, zipBuffer);

      const sizeText = zipBuffer.length > 1024 * 1024
        ? `${(zipBuffer.length / 1024 / 1024).toFixed(2)}MB`
        : `${(zipBuffer.length / 1024).toFixed(1)}KB`;

      logger.info('文件夹下载完成', {
        path: path.basename(remotePath),
        size: sizeText,
        files: totalFiles
      });
      activeTransfers.delete(operationId);
    } catch (err) {
      logger.error('处理ZIP数据错误', { remotePath, error: err.message });
      sendBinarySftpError(ws, sessionId, operationId, `处理ZIP数据错误: ${err.message}`, 'ZIP_PROCESSING_ERROR');
    }
  });

  // 监听ZIP错误事件
  archive.on('error', (err) => {
    logger.error('ZIP压缩错误', { remotePath, error: err.message });
    sendBinarySftpError(ws, sessionId, operationId, `ZIP压缩错误: ${err.message}`, 'ZIP_COMPRESSION_ERROR');
    activeTransfers.delete(operationId);
  });

  // 注册活动传输
  activeTransfers.set(operationId, { type: 'zip', archive });

  // 开始递归添加文件到ZIP
  addFolderToZipBinary(archive, sftp, remotePath, '', skippedFiles, errorFiles, (fileCount, size) => {
    totalFiles = fileCount;
    totalSize = size;

    // 检查文件夹大小限制（默认500MB）
    const maxFolderSize = parseInt(process.env.MAX_FOLDER_SIZE) || 524288000; // 500MB
    if (totalSize > maxFolderSize) {
      logger.warn('文件夹过大', { remotePath, totalSize, maxFolderSize });
      sendBinarySftpError(ws, sessionId, operationId,
        `文件夹太大 (${(totalSize / (1024 * 1024)).toFixed(2)} MB)，超过限制 (${(maxFolderSize / (1024 * 1024)).toFixed(2)} MB)`,
        'FOLDER_TOO_LARGE');
      return;
    }

    const sizeText = totalSize > 1024 * 1024
      ? `${(totalSize / 1024 / 1024).toFixed(2)}MB`
      : `${(totalSize / 1024).toFixed(1)}KB`;

    logger.info('开始压缩文件夹', {
      path: path.basename(remotePath),
      files: fileCount,
      size: sizeText
    });

    // 完成添加文件，开始压缩
    archive.finalize();
  }, (error, size) => {
    if (error) {
      logger.warn('跳过有问题的文件', { remotePath, error: error.message });
    }

    processedFiles++;
    processedSize += size || 0;

    // 发送进度更新
    const progress = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;
    if (processedFiles % 5 === 0 || processedFiles === totalFiles) {
      sendBinaryMessage(ws, BINARY_MSG_TYPE.SFTP_PROGRESS, {
        sessionId,
        operationId,
        progress,
        bytesTransferred: processedSize,
        totalBytes: totalSize,
        timestamp: Date.now()
      });
    }
  });
}

/**
 * 递归添加文件夹内容到ZIP (二进制版本)
 * @param {Object} archive ZIP压缩器
 * @param {Object} sftp SFTP连接对象
 * @param {string} remotePath 远程路径
 * @param {string} zipPath ZIP内路径
 * @param {Array} skippedFiles 跳过文件列表
 * @param {Array} errorFiles 错误文件列表
 * @param {Function} onComplete 完成回调 (fileCount, totalSize)
 * @param {Function} onProgress 进度回调 (error, size)
 */
function addFolderToZipBinary(archive, sftp, remotePath, zipPath, skippedFiles, errorFiles, onComplete, onProgress) {
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
        logger.warn('跳过无法读取的目录', { dirPath, error: err.message });
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

          const itemRemotePath = path.posix.join(dirPath, item.filename);
          const itemZipPath = zipDirPath ?
            path.posix.join(zipDirPath, item.filename) :
            item.filename;

          // 跳过一些可能有问题的文件/目录
          const skipPatterns = [
            'node_modules', '.git', '.vscode', '.idea',
            'dist', 'build', 'coverage', '.nyc_output',
            '*.tmp', '*.temp'
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
            return;
          }

          // 检查文件属性是否有效
          if (!item.attrs) {
            skippedFiles.push({
              path: itemRemotePath,
              reason: '无效文件属性',
              type: 'error'
            });
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

            addFileToZipBinary(archive, sftp, itemRemotePath, itemZipPath, item.attrs.size, skippedFiles, (error, size) => {
              pendingOperations--;
              if (error) {
                errorFiles.push({
                  path: itemRemotePath,
                  reason: error.message,
                  type: 'read_error',
                  size: item.attrs.size
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
          }
        } catch (itemError) {
          logger.warn('处理项目时出错', {
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
 * 添加单个文件到ZIP (二进制版本)
 * @param {Object} archive ZIP压缩器
 * @param {Object} sftp SFTP连接对象
 * @param {string} remotePath 远程文件路径
 * @param {string} zipPath ZIP内路径
 * @param {number} fileSize 文件大小
 * @param {Array} skippedFiles 跳过文件列表
 * @param {Function} callback 完成回调 (error, size)
 */
function addFileToZipBinary(archive, sftp, remotePath, zipPath, fileSize, skippedFiles, callback) {
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
      callback(null, 0);
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
        readStream.destroy();
        callback(null, 0);
      }
    }, 30000); // 30秒超时

    readStream.on('error', (err) => {
      if (!hasErrored) {
        hasErrored = true;
        clearTimeout(timeout);
        callback(null, 0);
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
    callback(null, 0);
  }
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
 * 处理二进制SFTP初始化
 */
async function handleBinarySftpInit(ws, headerData, sshSessions) {
  const { sessionId, operationId } = headerData;
  
  // 转换为JSON格式调用现有处理器
  const jsonData = {
    sessionId,
    operationId
  };
  
  sftpOperations.handleSftpInit(ws, jsonData, sshSessions);
}

/**
 * 处理二进制SFTP列表
 */
async function handleBinarySftpList(ws, headerData) {
  const { sessionId, operationId, path } = headerData;
  
  // 转换为JSON格式调用现有处理器
  const jsonData = {
    sessionId,
    operationId,
    path
  };
  
  sftpOperations.handleSftpList(ws, jsonData);
}

/**
 * 处理二进制SFTP创建目录
 */
async function handleBinarySftpMkdir(ws, headerData) {
  const { sessionId, operationId, path } = headerData;
  
  // 转换为JSON格式调用现有处理器
  const jsonData = {
    sessionId,
    operationId,
    path
  };
  
  sftpOperations.handleSftpMkdir(ws, jsonData);
}

/**
 * 处理二进制SFTP删除
 */
async function handleBinarySftpDelete(ws, headerData) {
  const { sessionId, operationId, path, isDirectory } = headerData;
  
  // 转换为JSON格式调用现有处理器
  const jsonData = {
    sessionId,
    operationId,
    path,
    isDirectory
  };
  
  sftpOperations.handleSftpDelete(ws, jsonData);
}

/**
 * 处理二进制SFTP重命名
 */
async function handleBinarySftpRename(ws, headerData) {
  const { sessionId, operationId, oldPath, newPath } = headerData;
  
  // 转换为JSON格式调用现有处理器
  const jsonData = {
    sessionId,
    operationId,
    oldPath,
    newPath
  };
  
  sftpOperations.handleSftpRename(ws, jsonData);
}

/**
 * 处理二进制SFTP权限修改
 */
async function handleBinarySftpChmod(ws, headerData) {
  const { sessionId, operationId, path, permissions } = headerData;
  
  // 转换为JSON格式调用现有处理器
  const jsonData = {
    sessionId,
    operationId,
    path,
    permissions
  };
  
  sftpOperations.handleSftpChmod(ws, jsonData);
}

/**
 * 处理二进制SFTP关闭
 */
async function handleBinarySftpClose(ws, headerData) {
  const { sessionId, operationId } = headerData;
  
  // 转换为JSON格式调用现有处理器
  const jsonData = {
    sessionId,
    operationId
  };
  
  sftpOperations.handleSftpClose(ws, jsonData);
}

/**
 * 处理二进制SFTP取消操作
 */
async function handleBinarySftpCancel(ws, headerData) {
  const { sessionId, operationId } = headerData;

  try {
    canceledOperations.add(operationId);
    if (activeTransfers.has(operationId)) {
      const entry = activeTransfers.get(operationId);
      if (entry.type === 'file' && entry.stream) {
        try { entry.stream.destroy(); } catch (e) {}
      } else if (entry.type === 'tar' && entry.stream) {
        try { if (typeof entry.stream.signal === 'function') entry.stream.signal('TERM'); } catch (e) {}
        try { entry.stream.close(); } catch (e) {}
        try { entry.stream.end(); } catch (e) {}
        try { entry.stream.destroy(); } catch (e) {}
      } else if (entry.type === 'zip' && entry.archive) {
        try { if (typeof entry.archive.abort === 'function') entry.archive.abort(); } catch (e) {}
        try { if (typeof entry.archive.destroy === 'function') entry.archive.destroy(); } catch (e) {}
      } else if (entry.type === 'upload' && entry.stream) {
        try { entry.stream.destroy(); } catch (e) {}
      }
      activeTransfers.delete(operationId);
    }

    sendBinarySftpSuccess(ws, sessionId, operationId, { message: '操作已取消' });
  } catch (error) {
    sendBinarySftpError(ws, sessionId, operationId, `取消失败: ${error.message}`, 'CANCEL_ERROR');
  }
}

// 导出函数
module.exports = {
  setSftpSessions,
  handleBinaryMessage,
  handleBinaryUpload,
  handleBinaryDownload,
  handleBinaryDownloadFolder,
  handleBinarySftpInit,
  handleBinarySftpList,
  handleBinarySftpMkdir,
  handleBinarySftpDelete,
  handleBinarySftpRename,
  handleBinarySftpChmod,
  handleBinarySftpClose,
  handleBinarySftpCancel,
  startBinaryFolderZipStream,
  addFolderToZipBinary,
  addFileToZipBinary,
  getMimeType
};

// 估算目录大小（通过SFTP递归）
function estimateFolderSizeViaSftp(sftp, rootPath) {
  return new Promise((resolve) => {
    let total = 0;
    let pending = 0;
    let done = false;

    function finish() {
      if (!done && pending === 0) {
        done = true;
        resolve(total);
      }
    }

    function walk(dir) {
      pending++;
      sftp.readdir(dir, (err, list) => {
        if (err) {
          pending--;
          return finish();
        }
        list.forEach(item => {
          const p = path.posix.join(dir, item.filename);
          if (item.attrs && item.attrs.isDirectory()) {
            walk(p);
          } else if (item.attrs && item.attrs.isFile()) {
            total += item.attrs.size || 0;
          }
        });
        pending--;
        finish();
      });
    }

    walk(rootPath);
  });
}
