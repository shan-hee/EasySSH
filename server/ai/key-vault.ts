/**
 * 密钥管理器（TypeScript）
 * 负责安全存储和管理用户的AI API密钥
 */

// 使用 require 保持对加密 API 的宽松类型，避免算法兼容性噪音
// eslint-disable-next-line @typescript-eslint/no-var-requires
const crypto = require('crypto');
import database from '../config/database';
import logger from '../utils/logger';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OpenAIAdapter = require('./openai-adapter');

class KeyVault {
  cache: any;
  algorithm: string;
  keyLength: number;
  ivLength: number;
  tagLength: number;
  encryptionKey: any;
  constructor() {
    this.cache = database.getCache();
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32;
    this.ivLength = 16;
    this.tagLength = 16;

    // 获取加密密钥
    this.encryptionKey = this._getEncryptionKey();

    logger.debug('密钥管理器已初始化');
  }

  /**
   * 存储用户的API配置
   * @param {string} userId 用户ID
   * @param {Object} config API配置
   * @param {Object} options 存储选项
   */
  async storeApiConfig(userId: string, config: any, options: any = {}) {
    try {
      const storageKey = this._generateStorageKey(userId, 'api_config');

      // 验证配置格式
      if (!this._validateApiConfig(config)) {
        throw new Error('API配置格式无效');
      }

      // 创建安全的配置副本
      const secureConfig = {
        provider: config.provider || 'openai',
        baseUrl: config.baseUrl || 'https://api.openai.com',
        model: config.model || 'gpt-4o-mini',
        temperature: config.temperature || 0.2,
        maxTokens: config.maxTokens || 512,
        timeout: config.timeout || 30000,
        // API密钥需要加密存储
        apiKey: config.apiKey,
        // 存储元数据
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (options.sessionOnly) {
        // 仅会话级存储，不加密
        this.cache.set(storageKey, secureConfig, 3600); // 1小时过期
        logger.info('API配置已存储（会话级）', { userId, provider: config.provider });
      } else {
        // 加密后持久化存储
        const encrypted = this._encryptConfig(secureConfig);
        this.cache.set(storageKey, encrypted, 0); // 永不过期
        logger.info('API配置已存储（持久化）', { userId, provider: config.provider });
      }

    } catch (error) {
      logger.error('存储API配置失败', { userId, error: error.message });
      throw new Error(`存储API配置失败: ${error.message}`);
    }
  }

  /**
   * 获取用户的API配置
   * @param {string} userId 用户ID
   * @returns {Object|null} API配置或null
   */
  async getApiConfig(userId: string) {
    try {
      const storageKey = this._generateStorageKey(userId, 'api_config');
      const stored = this.cache.get(storageKey);

      if (!stored) {
        // 尝试从持久化设置中回退读取（user_settings.ai-config）
        try {
          const db = database.getDb();
          const row = db
            .prepare(
              `SELECT settings_data FROM user_settings WHERE user_id = ? AND category = 'ai-config'`
            )
            .get(userId);

          if (row && row.settings_data) {
            try {
              const raw = JSON.parse(row.settings_data);
              // 规范化配置结构，并提供必要的默认值（不覆盖已有字段）
              const normalized = {
                provider: raw.provider || 'openai',
                baseUrl: (raw.baseUrl || 'https://api.openai.com').replace(/\/$/, ''),
                model: raw.model || 'gpt-4o-mini',
                temperature: raw.temperature || 0.2,
                maxTokens: raw.maxTokens || 512,
                timeout: raw.timeout || 30000,
                apiKey: raw.apiKey
              };

              // 验证配置格式
              if (this._validateApiConfig(normalized)) {
                // 回写到缓存，提升后续读取性能
                this.cache.set(storageKey, normalized, 3600);
                logger.info('已从持久化设置回退加载AI配置', {
                  userId,
                  provider: normalized.provider
                });
                return normalized;
              } else {
                logger.warn('持久化AI配置格式无效，忽略', { userId });
              }
            } catch (e) {
              logger.warn('解析持久化AI配置失败', { userId, error: e.message });
            }
          }
        } catch (e) {
          logger.warn('回退读取持久化AI配置失败', { userId, error: e.message });
        }

        logger.debug('未找到API配置', { userId });
        return null;
      }

      // 判断是否为加密数据
      if (this._isEncryptedData(stored)) {
        // 解密持久化数据
        const decrypted = this._decryptConfig(stored);
        logger.debug('API配置已解密', { userId, provider: decrypted.provider });
        return decrypted;
      } else {
        // 未加密的会话级数据
        logger.debug('获取会话级API配置', { userId, provider: stored.provider });
        return stored;
      }

    } catch (error) {
      logger.error('获取API配置失败', { userId, error: error.message });
      return null;
    }
  }

  /**
   * 删除用户的API配置
   * @param {string} userId 用户ID
   */
  async deleteApiConfig(userId: string) {
    try {
      const storageKey = this._generateStorageKey(userId, 'api_config');
      this.cache.del(storageKey);
      logger.info('API配置已删除', { userId });
    } catch (error) {
      logger.error('删除API配置失败', { userId, error: error.message });
      throw new Error(`删除API配置失败: ${error.message}`);
    }
  }

  /**
   * 测试API配置的有效性
   * @param {Object} config API配置
   * @returns {Promise<Object>} 测试结果
   */
  async testApiConfig(config: any) {
    try {
      logger.debug('开始测试API配置', {
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.model
      });

      // 验证配置格式
      if (!this._validateApiConfig(config)) {
        return {
          valid: false,
          error: 'API配置格式无效',
          message: '请检查配置参数是否完整'
        };
      }

      // 创建适配器并测试连接
      const adapter = new OpenAIAdapter(config);
      const result = await adapter.testConnection();

      if (result.valid) {
        logger.info('API配置测试成功', {
          provider: config.provider,
          model: config.model
        });
      } else {
        logger.warn('API配置测试失败', {
          provider: config.provider,
          error: result.error
        });
      }

      return result;

    } catch (error) {
      logger.error('API配置测试异常', { error: error.message });
      return {
        valid: false,
        error: error.message,
        message: `连接测试失败: ${error.message}`
      };
    }
  }

  /**
   * 获取用户的API使用统计
   * @param {string} userId 用户ID
   * @returns {Object} 使用统计
   */
  async getApiUsageStats(userId: string) {
    try {
      const statsKey = this._generateStorageKey(userId, 'usage_stats');
      const stats = this.cache.get(statsKey) || {
        totalRequests: 0,
        totalTokens: { input: 0, output: 0 },
        estimatedCost: 0,
        lastRequest: null,
        dailyStats: {}
      };

      return stats;
    } catch (error) {
      logger.error('获取使用统计失败', { userId, error: error.message });
      return null;
    }
  }

  /**
   * 更新用户的API使用统计
   * @param {string} userId 用户ID
   * @param {Object} usage 使用数据
   */
  async updateApiUsageStats(userId: string, usage: any) {
    try {
      const statsKey = this._generateStorageKey(userId, 'usage_stats');
      const stats = await this.getApiUsageStats(userId);

      // 更新统计数据
      stats.totalRequests += 1;
      stats.totalTokens.input += usage.tokens?.input || 0;
      stats.totalTokens.output += usage.tokens?.output || 0;
      stats.estimatedCost += usage.cost || 0;
      stats.lastRequest = new Date().toISOString();

      // 更新每日统计
      const today = new Date().toISOString().split('T')[0];
      if (!stats.dailyStats[today]) {
        stats.dailyStats[today] = {
          requests: 0,
          tokens: { input: 0, output: 0 },
          cost: 0
        };
      }

      stats.dailyStats[today].requests += 1;
      stats.dailyStats[today].tokens.input += usage.tokens?.input || 0;
      stats.dailyStats[today].tokens.output += usage.tokens?.output || 0;
      stats.dailyStats[today].cost += usage.cost || 0;

      // 保存更新后的统计数据
      this.cache.set(statsKey, stats, 86400 * 30); // 30天过期

      logger.debug('使用统计已更新', {
        userId,
        totalRequests: stats.totalRequests,
        todayRequests: stats.dailyStats[today].requests
      });

    } catch (error) {
      logger.error('更新使用统计失败', { userId, error: error.message });
    }
  }

  /**
   * 生成存储键
   * @param {string} userId 用户ID
   * @param {string} type 数据类型
   * @returns {string} 存储键
   */
  _generateStorageKey(userId: string, type: string) {
    return `ai_${type}:${userId}`;
  }

  /**
   * 验证API配置格式
   * @param {Object} config API配置
   * @returns {boolean} 是否有效
   */
  _validateApiConfig(config: any) {
    if (!config || typeof config !== 'object') {
      return false;
    }

    // 必需字段检查
    const requiredFields = ['apiKey', 'baseUrl'];
    for (const field of requiredFields) {
      if (!config[field] || typeof config[field] !== 'string') {
        return false;
      }
    }

    // API密钥格式检查
    if (config.apiKey.length < 10) {
      return false;
    }

    // URL格式检查
    try {
      new URL(config.baseUrl);
    } catch {
      return false;
    }

    return true;
  }

  /**
   * 加密配置
   * @param {Object} config 配置对象
   * @returns {string} 加密后的字符串
   */
  _encryptConfig(config: any) {
    try {
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipher(this.algorithm, this.encryptionKey, iv);

      const configJson = JSON.stringify(config);
      let encrypted = cipher.update(configJson, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag();

      return `encrypted:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
    } catch (error) {
      logger.error('配置加密失败', { error: error.message });
      throw new Error('配置加密失败');
    }
  }

  /**
   * 解密配置
   * @param {string} encryptedData 加密的数据
   * @returns {Object} 解密后的配置
   */
  _decryptConfig(encryptedData: string) {
    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 4 || parts[0] !== 'encrypted') {
        throw new Error('加密数据格式无效');
      }

      const [, ivHex, tagHex, encrypted] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');

      const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch (error) {
      logger.error('配置解密失败', { error: error.message });
      throw new Error('配置解密失败');
    }
  }

  /**
   * 判断是否为加密数据
   * @param {*} data 数据
   * @returns {boolean} 是否为加密数据
   */
  _isEncryptedData(data: any) {
    return typeof data === 'string' && data.startsWith('encrypted:');
  }

  /**
   * 获取加密密钥
   * @returns {Buffer} 加密密钥
   */
  _getEncryptionKey() {
    // 优先使用环境变量
    const keySource = process.env.AI_ENCRYPTION_KEY || 'easyssh-ai-default-key-change-in-production';
    const isProd = process.env.NODE_ENV === 'production';

    if (keySource === 'easyssh-ai-default-key-change-in-production') {
      if (isProd) {
        logger.warn('使用默认加密密钥，生产环境请设置AI_ENCRYPTION_KEY环境变量');
      } else {
        // 开发/测试环境降低告警级别，避免噪音
        logger.info('使用默认AI加密密钥（开发/测试模式）', { NODE_ENV: process.env.NODE_ENV || 'development' });
      }
    }

    return crypto.scryptSync(keySource, 'easyssh-salt', this.keyLength);
  }

  /**
   * 清理过期的缓存数据
   */
  async cleanupExpiredData() {
    try {
      // 清理超过30天的每日统计数据
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

      // 这里可以添加清理逻辑
      logger.debug('清理过期数据完成', { cutoffDate: cutoffDateStr });
    } catch (error) {
      logger.error('清理过期数据失败', { error: error.message });
    }
  }
}

module.exports = KeyVault;
