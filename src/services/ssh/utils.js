/**
 * SSH服务工具函数模块
 */

/**
 * 解码Base64数据为字符串
 * @param {string} base64 - Base64编码的字符串
 * @returns {string} - 解码后的字符串
 */
export function decodeBase64(base64) {
  try {
    if (typeof window.TextDecoder !== 'undefined') {
      // 使用TextDecoder API更高效地处理Unicode
      const binary = window.atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      // 使用TextDecoder解码
      const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
      return decoder.decode(bytes);
    } else {
      // 降级方案，使用传统的atob
      return atob(base64);
    }
  } catch (e) {
    console.warn('Base64解码失败:', e);
    return base64; // 解码失败时返回原始数据
  }
}

/**
 * 生成唯一ID
 * @param {string} prefix - ID前缀
 * @returns {string} - 生成的ID
 */
export function generateId(prefix = '') {
  return (
    prefix +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

/**
 * 解析WebSocket关闭码
 * @param {number} code - WebSocket关闭码
 * @param {string} reason - 关闭原因
 * @returns {string} - 人类可读的错误消息
 */
export function parseCloseCode(code, reason) {
  const closeCodeMap = {
    1000: '正常关闭',
    1001: '终端关闭',
    1002: '协议错误',
    1003: '数据类型错误',
    1004: '保留',
    1005: '没有收到关闭码',
    1006: '异常关闭',
    1007: '数据格式不一致',
    1008: '违反政策',
    1009: '数据太大',
    1010: '缺少扩展',
    1011: '内部错误',
    1012: '服务重启',
    1013: '临时错误',
    1014: '服务器终止',
    1015: 'TLS握手失败'
  };

  const codeText = closeCodeMap[code] || `未知错误(${code})`;
  return reason ? `${codeText}：${reason}` : codeText;
}

/**
 * 获取安全的WebSocket URL
 * @param {string} host - 主机地址
 * @param {number} port - 端口号
 * @param {string} path - 路径
 * @param {boolean} useSSL - 是否使用SSL
 * @returns {string} - WebSocket URL
 */
export function getWebSocketUrl(host, port, path, useSSL = false) {
  const protocol = useSSL ? 'wss' : 'ws';
  // 处理IPv6地址
  const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${protocol}://${formattedHost}:${port}${path}`;
}

/**
 * 判断是否是IPv6地址
 * @param {string} address - IP地址
 * @returns {boolean} - 是否是IPv6地址
 */
export function isIPv6(address) {
  return address.includes(':') && !address.includes('.');
}

/**
 * 创建文件路径
 * @param {string} basePath - 基础路径
 * @param {string} filename - 文件名
 * @returns {string} - 完整路径
 */
export function joinPath(basePath, filename) {
  // 确保路径以"/"结尾
  const normalizedPath = basePath.endsWith('/') ? basePath : `${basePath}/`;
  // 确保文件名没有前导"/"
  const normalizedFilename = filename.startsWith('/') ? filename.substring(1) : filename;
  return normalizedPath + normalizedFilename;
}

// 本地存储函数已移除，请使用统一的存储服务
