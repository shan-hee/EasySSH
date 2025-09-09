/**
 * 监控配置管理器
 * 负责管理监控系统的动态配置更新
 */

import { reactive } from 'vue';
import settingsService from './settings.js';
import log from './log.js';

class MonitoringConfigManager {
  constructor() {
    this.config = reactive({
      updateInterval: 1000,
      minInterval: 500,
      maxInterval: 10000
    });

    this.listeners = new Set();
    this.initialized = false;
  }

  /**
   * 初始化配置管理器
   */
  async init() {
    if (this.initialized) return;

    try {
      // 从设置服务加载配置
      await this.loadFromSettings();

      // 监听配置变更事件
      this.setupEventListeners();

      // 如果设置服务尚未初始化，监听其初始化完成事件
      if (!settingsService.isInitialized) {
        const handleSettingsReady = () => {
          this.loadFromSettings().catch(error => {
            log.error('设置服务就绪后加载监控配置失败', error);
          });
          window.removeEventListener('services:ready', handleSettingsReady);
        };
        window.addEventListener('services:ready', handleSettingsReady);
      }

      this.initialized = true;
      log.debug('监控配置管理器初始化完成', this.config);
    } catch (error) {
      log.error('监控配置管理器初始化失败', error);
    }
  }

  /**
   * 从设置服务加载配置
   */
  async loadFromSettings() {
    // 等待设置服务初始化完成，但不主动初始化它
    // 避免重复初始化导致的主题闪烁问题
    if (!settingsService.isInitialized) {
      log.warn('设置服务尚未初始化，使用默认监控配置');
      return;
    }

    const monitoringSettings = settingsService.get('monitoring', {});
    Object.assign(this.config, {
      updateInterval: monitoringSettings.updateInterval || 1000
    });
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    // 监听监控配置变更事件
    window.addEventListener('monitoring-config-changed', this.handleConfigChange.bind(this));
  }

  /**
   * 处理配置变更
   */
  handleConfigChange(event) {
    const newConfig = event.detail;

    // 验证配置
    if (!this.validateConfig(newConfig)) {
      log.warn('无效的监控配置', newConfig);
      return;
    }

    // 更新配置
    const oldInterval = this.config.updateInterval;
    Object.assign(this.config, newConfig);

    log.info('监控配置已更新', {
      old: { updateInterval: oldInterval },
      new: { updateInterval: this.config.updateInterval }
    });

    // 通知所有监听器
    this.notifyListeners(this.config);
  }

  /**
   * 验证配置
   */
  validateConfig(config) {
    if (config.updateInterval) {
      return (
        config.updateInterval >= this.config.minInterval &&
        config.updateInterval <= this.config.maxInterval
      );
    }
    return true;
  }

  /**
   * 添加配置变更监听器
   */
  addListener(callback) {
    this.listeners.add(callback);

    // 立即调用一次，传递当前配置
    callback(this.config);
  }

  /**
   * 移除配置变更监听器
   */
  removeListener(callback) {
    this.listeners.delete(callback);
  }

  /**
   * 通知所有监听器
   */
  notifyListeners(config) {
    this.listeners.forEach(callback => {
      try {
        callback(config);
      } catch (error) {
        log.error('监控配置监听器执行失败', error);
      }
    });
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates) {
    if (!this.validateConfig(updates)) {
      throw new Error('无效的监控配置');
    }

    Object.assign(this.config, updates);

    // 保存到设置服务
    settingsService.set('monitoring', this.config);

    // 通知监听器
    this.notifyListeners(this.config);
  }

  /**
   * 获取预设配置
   */
  getPresets() {
    return {
      highFrequency: {
        name: '高频 (0.5秒)',
        updateInterval: 500,
        description: '最高频率更新，系统负载较高'
      },
      realtime: {
        name: '实时 (1秒)',
        updateInterval: 1000,
        description: '实时更新，推荐设置'
      },
      standard: {
        name: '标准 (3秒)',
        updateInterval: 3000,
        description: '平衡性能与实时性'
      },
      powerSave: {
        name: '节能 (5秒)',
        updateInterval: 5000,
        description: '节能模式，降低系统负载'
      }
    };
  }

  /**
   * 应用预设配置
   */
  applyPreset(presetName) {
    const presets = this.getPresets();
    const preset = presets[presetName];

    if (!preset) {
      throw new Error(`未知的预设配置: ${presetName}`);
    }

    this.updateConfig({
      updateInterval: preset.updateInterval
    });
  }

  /**
   * 获取性能影响评估
   */
  getPerformanceImpact(interval) {
    const baseInterval = 3000; // 基准间隔
    const impact = baseInterval / interval;

    return {
      multiplier: impact,
      level: impact >= 6 ? 'high' : impact >= 2 ? 'medium' : 'low',
      description: this.getPerformanceDescription(interval)
    };
  }

  /**
   * 获取性能描述
   */
  getPerformanceDescription(interval) {
    if (interval <= 500) {
      return '⚡ 高频更新，系统负载较高';
    } else if (interval <= 1000) {
      return '🚀 实时更新，推荐设置';
    } else if (interval <= 3000) {
      return '⚖️ 平衡性能与实时性';
    } else {
      return '🔋 节能模式，降低系统负载';
    }
  }

  /**
   * 清理资源
   */
  destroy() {
    window.removeEventListener('monitoring-config-changed', this.handleConfigChange.bind(this));
    this.listeners.clear();
    this.initialized = false;
  }
}

// 创建单例实例
const monitoringConfigManager = new MonitoringConfigManager();

export default monitoringConfigManager;
