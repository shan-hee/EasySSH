/**
 * 生产级数据格式化工具
 * 提供一致、准确、用户友好的数据显示格式
 *
 * @author EasySSH Team
 * @version 2.0.0
 * @since 2025-08-01
 */

/**
 * 数字格式化配置
 */
const FORMAT_CONFIG = {
  // 百分比格式化
  percentage: {
    decimals: 1,
    showZeroDecimals: true,
    maxValue: 100,
    minValue: 0
  },

  // 字节大小格式化
  bytes: {
    units: ['B', 'KB', 'MB', 'GB', 'TB', 'PB'],
    base: 1024,
    decimals: 1,
    showZeroDecimals: false
  },

  // 网络速度格式化
  networkSpeed: {
    units: ['B/s', 'KB/s', 'MB/s', 'GB/s'],
    base: 1024,
    decimals: 1,
    showZeroDecimals: false
  },

  // 时间格式化
  time: {
    showMilliseconds: false,
    use24Hour: true,
    showSeconds: true
  },

  // 数值格式化
  number: {
    decimals: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.'
  }
};

/**
 * 生产级数据格式化器
 */
export class ProductionFormatter {
  constructor(config = {}) {
    this.config = { ...FORMAT_CONFIG, ...config };
    this.locale = 'zh-CN';
    this.timezone = 'Asia/Shanghai';
  }

  /**
   * 格式化百分比
   * @param {number} value - 数值 (0-100)
   * @param {Object} options - 格式化选项
   * @returns {string} 格式化后的百分比字符串
   */
  formatPercentage(value, options = {}) {
    const opts = { ...this.config.percentage, ...options };

    // 数据验证
    if (value === null || value === undefined || isNaN(value)) {
      return '--';
    }

    // 数值范围限制
    const clampedValue = Math.max(opts.minValue, Math.min(opts.maxValue, value));

    // 格式化
    const formatted = clampedValue.toFixed(opts.decimals);

    // 处理零小数位显示
    if (!opts.showZeroDecimals && formatted.endsWith('.0')) {
      return `${Math.round(clampedValue)}%`;
    }

    return `${formatted}%`;
  }

  /**
   * 格式化字节大小
   * @param {number} bytes - 字节数
   * @param {Object} options - 格式化选项
   * @returns {string} 格式化后的大小字符串
   */
  formatBytes(bytes, options = {}) {
    const opts = { ...this.config.bytes, ...options };

    if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) {
      return '0 B';
    }

    if (bytes === 0) {
      return '0 B';
    }

    const unitIndex = Math.floor(Math.log(bytes) / Math.log(opts.base));
    const clampedIndex = Math.min(unitIndex, opts.units.length - 1);
    const value = bytes / Math.pow(opts.base, clampedIndex);

    const formatted = value.toFixed(opts.decimals);
    const finalValue =
      opts.showZeroDecimals || !formatted.endsWith('.0') ? formatted : Math.round(value).toString();

    return `${finalValue} ${opts.units[clampedIndex]}`;
  }

  /**
   * 格式化网络速度
   * @param {number} bytesPerSecond - 每秒字节数
   * @param {Object} options - 格式化选项
   * @returns {string} 格式化后的速度字符串
   */
  formatNetworkSpeed(bytesPerSecond, options = {}) {
    const opts = { ...this.config.networkSpeed, ...options };

    if (
      bytesPerSecond === null ||
      bytesPerSecond === undefined ||
      isNaN(bytesPerSecond) ||
      bytesPerSecond < 0
    ) {
      return '0 B/s';
    }

    if (bytesPerSecond === 0) {
      return '0 B/s';
    }

    const unitIndex = Math.floor(Math.log(bytesPerSecond) / Math.log(opts.base));
    const clampedIndex = Math.min(unitIndex, opts.units.length - 1);
    const value = bytesPerSecond / Math.pow(opts.base, clampedIndex);

    const formatted = value.toFixed(opts.decimals);
    const finalValue =
      opts.showZeroDecimals || !formatted.endsWith('.0') ? formatted : Math.round(value).toString();

    return `${finalValue} ${opts.units[clampedIndex]}`;
  }

  /**
   * 格式化数字
   * @param {number} value - 数值
   * @param {Object} options - 格式化选项
   * @returns {string} 格式化后的数字字符串
   */
  formatNumber(value, options = {}) {
    const opts = { ...this.config.number, ...options };

    if (value === null || value === undefined || isNaN(value)) {
      return '--';
    }

    const formatted = value.toFixed(opts.decimals);

    // 添加千位分隔符
    if (opts.thousandsSeparator) {
      const parts = formatted.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, opts.thousandsSeparator);
      return parts.join(opts.decimalSeparator);
    }

    return formatted;
  }

  /**
   * 格式化时间戳
   * @param {number} timestamp - 时间戳（毫秒）
   * @param {Object} options - 格式化选项
   * @returns {string} 格式化后的时间字符串
   */
  formatTimestamp(timestamp, options = {}) {
    const opts = { ...this.config.time, ...options };

    if (!timestamp || isNaN(timestamp)) {
      return '--';
    }

    const date = new Date(timestamp);

    if (isNaN(date.getTime())) {
      return '--';
    }

    const formatOptions = {
      timeZone: this.timezone,
      hour12: !opts.use24Hour,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    };

    if (opts.showSeconds) {
      formatOptions.second = '2-digit';
    }

    if (opts.showMilliseconds) {
      formatOptions.fractionalSecondDigits = 3;
    }

    return date.toLocaleString(this.locale, formatOptions);
  }

  /**
   * 格式化运行时间
   * @param {number} seconds - 运行时间（秒）
   * @returns {string} 格式化后的运行时间字符串
   */
  formatUptime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) {
      return '未知';
    }

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    const parts = [];

    if (days > 0) {
      parts.push(`${days}天`);
    }

    if (hours > 0 || days > 0) {
      parts.push(`${hours}小时`);
    }

    if (minutes > 0 || hours > 0 || days > 0) {
      parts.push(`${minutes}分钟`);
    }

    if (parts.length === 0 || (parts.length === 1 && days === 0 && hours === 0)) {
      parts.push(`${remainingSeconds}秒`);
    }

    return parts.join(' ');
  }

  /**
   * 格式化负载平均值
   * @param {Object} loadAverage - 负载平均值对象
   * @param {number} cpuCores - CPU核心数
   * @returns {string} 格式化后的负载字符串
   */
  formatLoadAverage(loadAverage, cpuCores = 1) {
    if (!loadAverage || typeof loadAverage !== 'object') {
      return '--';
    }

    const { load1, load5, load15 } = loadAverage;

    if (load1 === undefined || load5 === undefined || load15 === undefined) {
      return '--';
    }

    const format = value => {
      if (isNaN(value)) return '0.00';
      return value.toFixed(2);
    };

    const getLoadStatus = load => {
      const normalized = load / cpuCores;
      if (normalized > 2.0) return 'critical';
      if (normalized > 1.0) return 'warning';
      if (normalized > 0.7) return 'moderate';
      return 'normal';
    };

    const status = getLoadStatus(load1);

    return {
      formatted: `${format(load1)} ${format(load5)} ${format(load15)}`,
      status,
      normalized: (load1 / cpuCores).toFixed(2)
    };
  }

  /**
   * 格式化状态指示器
   * @param {string} status - 状态值
   * @returns {Object} 状态显示对象
   */
  formatStatus(status) {
    const statusMap = {
      normal: { text: '正常', color: '#10b981', icon: '✓' },
      warning: { text: '警告', color: '#f59e0b', icon: '⚠' },
      critical: { text: '严重', color: '#ef4444', icon: '✗' },
      unknown: { text: '未知', color: '#6b7280', icon: '?' }
    };

    return statusMap[status] || statusMap.unknown;
  }

  /**
   * 智能数值格式化
   * 根据数值大小自动选择最合适的格式
   * @param {number} value - 数值
   * @param {string} type - 数据类型
   * @returns {string} 格式化后的字符串
   */
  smartFormat(value, type) {
    switch (type) {
    case 'percentage':
      return this.formatPercentage(value);
    case 'bytes':
      return this.formatBytes(value);
    case 'speed':
      return this.formatNetworkSpeed(value);
    case 'timestamp':
      return this.formatTimestamp(value);
    case 'uptime':
      return this.formatUptime(value);
    case 'number':
      return this.formatNumber(value);
    default:
      return value?.toString() || '--';
    }
  }

  /**
   * 批量格式化
   * @param {Object} data - 数据对象
   * @param {Object} formatMap - 格式映射
   * @returns {Object} 格式化后的数据对象
   */
  batchFormat(data, formatMap) {
    const result = {};

    for (const [key, formatType] of Object.entries(formatMap)) {
      if (data.hasOwnProperty(key)) {
        result[key] = this.smartFormat(data[key], formatType);
      }
    }

    return result;
  }

  /**
   * 设置本地化配置
   * @param {string} locale - 本地化标识
   * @param {string} timezone - 时区
   */
  setLocale(locale, timezone) {
    this.locale = locale;
    this.timezone = timezone;
  }

  /**
   * 获取格式化配置
   * @returns {Object} 当前配置
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * 更新格式化配置
   * @param {Object} newConfig - 新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }
}

// 创建默认实例
export const productionFormatter = new ProductionFormatter();

// 便捷方法导出
export const formatPercentage = (value, options) =>
  productionFormatter.formatPercentage(value, options);
export const formatBytes = (bytes, options) => productionFormatter.formatBytes(bytes, options);
export const formatNetworkSpeed = (speed, options) =>
  productionFormatter.formatNetworkSpeed(speed, options);
export const formatNumber = (value, options) => productionFormatter.formatNumber(value, options);
export const formatTimestamp = (timestamp, options) =>
  productionFormatter.formatTimestamp(timestamp, options);
export const formatUptime = seconds => productionFormatter.formatUptime(seconds);
export const formatLoadAverage = (loadAverage, cpuCores) =>
  productionFormatter.formatLoadAverage(loadAverage, cpuCores);
export const formatStatus = status => productionFormatter.formatStatus(status);

export default productionFormatter;
