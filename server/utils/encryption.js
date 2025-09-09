/**
 * 密码加密工具类
 * 提供统一的密码加密/解密功能，确保敏感数据安全存储
 *
 * 安全特性：
 * - 使用AES加密算法
 * - 支持环境变量配置加密密钥
 * - 提供安全的默认配置
 * - 错误处理和日志记录
 */

const crypto = require('crypto-js');
const logger = require('./logger');

/**
 * 获取加密密钥
 * 优先使用环境变量，提供安全的默认值
 * @returns {string} 加密密钥
 */
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;

  if (!key || key === 'default-secret-key') {
    logger.warn('使用默认加密密钥，生产环境中请设置ENCRYPTION_KEY环境变量');
  }

  return key || 'default-secret-key-please-change-in-production';
}

/**
 * 加密密码
 * @param {string} password 明文密码
 * @returns {string|null} 加密后的密码，失败返回null
 */
function encryptPassword(password) {
  try {
    if (!password || typeof password !== 'string') {
      return null;
    }

    const secretKey = getEncryptionKey();
    const encrypted = crypto.AES.encrypt(password, secretKey).toString();

    logger.debug('密码加密成功');
    return encrypted;
  } catch (error) {
    logger.error('密码加密失败:', error.message);
    return null;
  }
}

/**
 * 解密密码
 * @param {string} encryptedPassword 加密的密码
 * @returns {string} 解密后的明文密码，失败返回空字符串
 */
function decryptPassword(encryptedPassword) {
  try {
    if (!encryptedPassword || typeof encryptedPassword !== 'string') {
      return '';
    }

    const secretKey = getEncryptionKey();
    const bytes = crypto.AES.decrypt(encryptedPassword, secretKey);
    const decrypted = bytes.toString(crypto.enc.Utf8);

    if (!decrypted) {
      logger.warn('密码解密结果为空，可能是密钥不匹配');
      return '';
    }

    // 移除重复的成功日志，只在出错时记录
    return decrypted;
  } catch (error) {
    logger.error('密码解密失败:', error.message);
    return '';
  }
}

/**
 * 加密私钥
 * @param {string} privateKey 明文私钥
 * @returns {string|null} 加密后的私钥，失败返回null
 */
function encryptPrivateKey(privateKey) {
  try {
    if (!privateKey || typeof privateKey !== 'string') {
      return null;
    }

    const secretKey = getEncryptionKey();
    const encrypted = crypto.AES.encrypt(privateKey, secretKey).toString();

    logger.debug('私钥加密成功');
    return encrypted;
  } catch (error) {
    logger.error('私钥加密失败:', error.message);
    return null;
  }
}

/**
 * 解密私钥
 * @param {string} encryptedPrivateKey 加密的私钥
 * @returns {string} 解密后的明文私钥，失败返回空字符串
 */
function decryptPrivateKey(encryptedPrivateKey) {
  try {
    if (!encryptedPrivateKey || typeof encryptedPrivateKey !== 'string') {
      return '';
    }

    const secretKey = getEncryptionKey();
    const bytes = crypto.AES.decrypt(encryptedPrivateKey, secretKey);
    const decrypted = bytes.toString(crypto.enc.Utf8);

    if (!decrypted) {
      logger.warn('私钥解密结果为空，可能是密钥不匹配');
      return '';
    }

    // 移除重复的成功日志，只在出错时记录
    return decrypted;
  } catch (error) {
    logger.error('私钥解密失败:', error.message);
    return '';
  }
}

/**
 * 检查字符串是否已加密
 * 简单的启发式检查，基于加密后的特征
 * @param {string} str 待检查的字符串
 * @returns {boolean} 是否已加密
 */
function isEncrypted(str) {
  if (!str || typeof str !== 'string') {
    return false;
  }

  // AES加密后的字符串通常包含特殊字符和较长长度
  // 这是一个简单的启发式检查
  return str.length > 20 && /[+/=]/.test(str);
}

/**
 * 安全地处理连接配置中的敏感数据
 * @param {Object} connection 连接配置对象
 * @param {boolean} encrypt 是否加密（true）还是解密（false）
 * @returns {Object} 处理后的连接配置
 */
function processConnectionSensitiveData(connection, encrypt = true) {
  if (!connection || typeof connection !== 'object') {
    return connection;
  }

  const processed = { ...connection };

  try {
    if (encrypt) {
      // 加密敏感数据
      if (processed.password && processed.rememberPassword) {
        const encrypted = encryptPassword(processed.password);
        if (encrypted) {
          processed.password = encrypted;
        }
      }

      if (processed.privateKey) {
        const encrypted = encryptPrivateKey(processed.privateKey);
        if (encrypted) {
          processed.privateKey = encrypted;
        }
      }

      if (processed.passphrase) {
        const encrypted = encryptPassword(processed.passphrase);
        if (encrypted) {
          processed.passphrase = encrypted;
        }
      }
    } else {
      // 解密敏感数据
      if (processed.password) {
        processed.password = decryptPassword(processed.password);
      }

      if (processed.privateKey) {
        processed.privateKey = decryptPrivateKey(processed.privateKey);
      }

      if (processed.passphrase) {
        processed.passphrase = decryptPassword(processed.passphrase);
      }
    }

    return processed;
  } catch (error) {
    logger.error(`处理连接敏感数据失败 (${encrypt ? '加密' : '解密'}):`, error.message);
    return connection;
  }
}

module.exports = {
  encryptPassword,
  decryptPassword,
  encryptPrivateKey,
  decryptPrivateKey,
  isEncrypted,
  processConnectionSensitiveData,
  getEncryptionKey
};
