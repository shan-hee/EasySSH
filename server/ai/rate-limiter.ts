// @ts-nocheck
/**
 * 速率限制器
 * 控制用户AI请求的频率和配额
 */

const { getCache } = require('../config/database');
const logger = require('../utils/logger');

class RateLimiter {
  constructor(options = {}) {
    this.cache = getCache();

    // 默认配置
    this.config = {
      // 每分钟请求限制
      requestsPerMinute: options.requestsPerMinute || 60,
      // 每小时请求限制
      requestsPerHour: options.requestsPerHour || 300,
      // 每日请求限制
      requestsPerDay: options.requestsPerDay || 1000,
      // 突发请求限制（短时间内）
      burstLimit: options.burstLimit || 10,
      burstWindow: options.burstWindow || 10, // 10秒
      // 冷却时间（被限制后需要等待的时间）
      cooldownPeriod: options.cooldownPeriod || 60, // 60秒
      ...options
    };

    logger.debug('速率限制器已初始化', this.config);
  }

  /**
   * 检查用户是否可以发起请求
   * @param {string} userId 用户ID
   * @param {Object} options 检查选项
   * @returns {Promise<Object>} 检查结果
   */
  async checkLimit(userId, options = {}) {
    try {
      const now = Date.now();
      const checks = [
        this._checkBurstLimit(userId, now),
        this._checkMinuteLimit(userId, now),
        this._checkHourLimit(userId, now),
        this._checkDayLimit(userId, now),
        this._checkCooldown(userId, now)
      ];

      // 执行所有检查
      for (const check of checks) {
        const result = await check;
        if (!result.allowed) {
          logger.debug('速率限制检查失败', {
            userId,
            reason: result.reason,
            resetTime: result.resetTime
          });
          return result;
        }
      }

      // 所有检查通过，记录请求
      await this._recordRequest(userId, now);

      return {
        allowed: true,
        remaining: await this._getRemainingRequests(userId, now),
        resetTime: 0
      };

    } catch (error) {
      logger.error('速率限制检查失败', { userId, error: error.message });
      // 出错时采用保守策略，允许请求但记录错误
      return {
        allowed: true,
        remaining: { minute: 0, hour: 0, day: 0 },
        resetTime: 0,
        error: error.message
      };
    }
  }

  /**
   * 检查突发请求限制
   * @param {string} userId 用户ID
   * @param {number} now 当前时间戳
   * @returns {Promise<Object>} 检查结果
   */
  async _checkBurstLimit(userId, now) {
    const key = `burst:${userId}`;
    const windowStart = now - (this.config.burstWindow * 1000);

    // 获取突发窗口内的请求记录
    const burstRequests = this.cache.get(key) || [];

    // 清理过期的请求记录
    const validRequests = burstRequests.filter(timestamp => timestamp > windowStart);

    if (validRequests.length >= this.config.burstLimit) {
      const oldestRequest = Math.min(...validRequests);
      const resetTime = Math.ceil((oldestRequest + this.config.burstWindow * 1000 - now) / 1000);

      return {
        allowed: false,
        reason: 'BURST_LIMIT_EXCEEDED',
        resetTime,
        message: `突发请求过多，请等待${resetTime}秒`
      };
    }

    return { allowed: true };
  }

  /**
   * 检查每分钟请求限制
   * @param {string} userId 用户ID
   * @param {number} now 当前时间戳
   * @returns {Promise<Object>} 检查结果
   */
  async _checkMinuteLimit(userId, now) {
    const key = `minute:${userId}`;
    const currentMinute = Math.floor(now / 60000);
    const minuteData = this.cache.get(key) || { minute: currentMinute, count: 0 };

    // 如果是新的分钟，重置计数
    if (minuteData.minute !== currentMinute) {
      minuteData.minute = currentMinute;
      minuteData.count = 0;
    }

    if (minuteData.count >= this.config.requestsPerMinute) {
      const resetTime = 60 - Math.floor((now % 60000) / 1000);

      return {
        allowed: false,
        reason: 'MINUTE_LIMIT_EXCEEDED',
        resetTime,
        message: `每分钟请求限制已达上限，请等待${resetTime}秒`
      };
    }

    return { allowed: true };
  }

  /**
   * 检查每小时请求限制
   * @param {string} userId 用户ID
   * @param {number} now 当前时间戳
   * @returns {Promise<Object>} 检查结果
   */
  async _checkHourLimit(userId, now) {
    const key = `hour:${userId}`;
    const currentHour = Math.floor(now / 3600000);
    const hourData = this.cache.get(key) || { hour: currentHour, count: 0 };

    // 如果是新的小时，重置计数
    if (hourData.hour !== currentHour) {
      hourData.hour = currentHour;
      hourData.count = 0;
    }

    if (hourData.count >= this.config.requestsPerHour) {
      const resetTime = 3600 - Math.floor((now % 3600000) / 1000);

      return {
        allowed: false,
        reason: 'HOUR_LIMIT_EXCEEDED',
        resetTime,
        message: `每小时请求限制已达上限，请等待${Math.ceil(resetTime / 60)}分钟`
      };
    }

    return { allowed: true };
  }

  /**
   * 检查每日请求限制
   * @param {string} userId 用户ID
   * @param {number} now 当前时间戳
   * @returns {Promise<Object>} 检查结果
   */
  async _checkDayLimit(userId, now) {
    const key = `day:${userId}`;
    const currentDay = Math.floor(now / 86400000);
    const dayData = this.cache.get(key) || { day: currentDay, count: 0 };

    // 如果是新的一天，重置计数
    if (dayData.day !== currentDay) {
      dayData.day = currentDay;
      dayData.count = 0;
    }

    if (dayData.count >= this.config.requestsPerDay) {
      const resetTime = 86400 - Math.floor((now % 86400000) / 1000);

      return {
        allowed: false,
        reason: 'DAY_LIMIT_EXCEEDED',
        resetTime,
        message: `每日请求限制已达上限，请等待${Math.ceil(resetTime / 3600)}小时`
      };
    }

    return { allowed: true };
  }

  /**
   * 检查冷却时间
   * @param {string} userId 用户ID
   * @param {number} now 当前时间戳
   * @returns {Promise<Object>} 检查结果
   */
  async _checkCooldown(userId, now) {
    const key = `cooldown:${userId}`;
    const cooldownEnd = this.cache.get(key);

    if (cooldownEnd && now < cooldownEnd) {
      const resetTime = Math.ceil((cooldownEnd - now) / 1000);

      return {
        allowed: false,
        reason: 'COOLDOWN_ACTIVE',
        resetTime,
        message: `账户处于冷却期，请等待${resetTime}秒`
      };
    }

    return { allowed: true };
  }

  /**
   * 记录请求
   * @param {string} userId 用户ID
   * @param {number} now 当前时间戳
   */
  async _recordRequest(userId, now) {
    try {
      // 记录突发请求
      const burstKey = `burst:${userId}`;
      const burstRequests = this.cache.get(burstKey) || [];
      const windowStart = now - (this.config.burstWindow * 1000);
      const validBurstRequests = burstRequests.filter(timestamp => timestamp > windowStart);
      validBurstRequests.push(now);
      this.cache.set(burstKey, validBurstRequests, this.config.burstWindow);

      // 记录分钟请求
      const minuteKey = `minute:${userId}`;
      const currentMinute = Math.floor(now / 60000);
      const minuteData = this.cache.get(minuteKey) || { minute: currentMinute, count: 0 };
      if (minuteData.minute !== currentMinute) {
        minuteData.minute = currentMinute;
        minuteData.count = 0;
      }
      minuteData.count++;
      this.cache.set(minuteKey, minuteData, 60);

      // 记录小时请求
      const hourKey = `hour:${userId}`;
      const currentHour = Math.floor(now / 3600000);
      const hourData = this.cache.get(hourKey) || { hour: currentHour, count: 0 };
      if (hourData.hour !== currentHour) {
        hourData.hour = currentHour;
        hourData.count = 0;
      }
      hourData.count++;
      this.cache.set(hourKey, hourData, 3600);

      // 记录每日请求
      const dayKey = `day:${userId}`;
      const currentDay = Math.floor(now / 86400000);
      const dayData = this.cache.get(dayKey) || { day: currentDay, count: 0 };
      if (dayData.day !== currentDay) {
        dayData.day = currentDay;
        dayData.count = 0;
      }
      dayData.count++;
      this.cache.set(dayKey, dayData, 86400);

      logger.debug('请求已记录', {
        userId,
        minute: minuteData.count,
        hour: hourData.count,
        day: dayData.count
      });

    } catch (error) {
      logger.error('记录请求失败', { userId, error: error.message });
    }
  }

  /**
   * 获取剩余请求数
   * @param {string} userId 用户ID
   * @param {number} now 当前时间戳
   * @returns {Promise<Object>} 剩余请求数
   */
  async _getRemainingRequests(userId, now) {
    try {
      const minuteKey = `minute:${userId}`;
      const hourKey = `hour:${userId}`;
      const dayKey = `day:${userId}`;

      const minuteData = this.cache.get(minuteKey) || { count: 0 };
      const hourData = this.cache.get(hourKey) || { count: 0 };
      const dayData = this.cache.get(dayKey) || { count: 0 };

      return {
        minute: Math.max(0, this.config.requestsPerMinute - minuteData.count),
        hour: Math.max(0, this.config.requestsPerHour - hourData.count),
        day: Math.max(0, this.config.requestsPerDay - dayData.count)
      };
    } catch (error) {
      logger.error('获取剩余请求数失败', { userId, error: error.message });
      return { minute: 0, hour: 0, day: 0 };
    }
  }

  /**
   * 设置用户冷却时间
   * @param {string} userId 用户ID
   * @param {number} duration 冷却时长（秒）
   */
  async setCooldown(userId, duration = null) {
    try {
      const cooldownDuration = duration || this.config.cooldownPeriod;
      const cooldownEnd = Date.now() + (cooldownDuration * 1000);

      const key = `cooldown:${userId}`;
      this.cache.set(key, cooldownEnd, cooldownDuration);

      logger.info('用户冷却时间已设置', { userId, duration: cooldownDuration });
    } catch (error) {
      logger.error('设置冷却时间失败', { userId, error: error.message });
    }
  }

  /**
   * 清除用户的所有限制记录
   * @param {string} userId 用户ID
   */
  async clearUserLimits(userId) {
    try {
      const keys = [
        `burst:${userId}`,
        `minute:${userId}`,
        `hour:${userId}`,
        `day:${userId}`,
        `cooldown:${userId}`
      ];

      keys.forEach(key => this.cache.del(key));

      logger.info('用户限制记录已清除', { userId });
    } catch (error) {
      logger.error('清除用户限制记录失败', { userId, error: error.message });
    }
  }

  /**
   * 获取用户的限制状态
   * @param {string} userId 用户ID
   * @returns {Promise<Object>} 限制状态
   */
  async getUserLimitStatus(userId) {
    try {
      const now = Date.now();
      const remaining = await this._getRemainingRequests(userId, now);

      const cooldownKey = `cooldown:${userId}`;
      const cooldownEnd = this.cache.get(cooldownKey);
      const inCooldown = cooldownEnd && now < cooldownEnd;

      return {
        remaining,
        inCooldown,
        cooldownRemaining: inCooldown ? Math.ceil((cooldownEnd - now) / 1000) : 0,
        limits: {
          requestsPerMinute: this.config.requestsPerMinute,
          requestsPerHour: this.config.requestsPerHour,
          requestsPerDay: this.config.requestsPerDay,
          burstLimit: this.config.burstLimit
        }
      };
    } catch (error) {
      logger.error('获取用户限制状态失败', { userId, error: error.message });
      return null;
    }
  }

  /**
   * 更新速率限制配置
   * @param {Object} newConfig 新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info('速率限制配置已更新', this.config);
  }
}

module.exports = RateLimiter;
