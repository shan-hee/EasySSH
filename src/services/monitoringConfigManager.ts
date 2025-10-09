/**
 * 监控配置管理器
 * 负责管理监控系统的动态配置更新
 */

import { reactive } from 'vue';
import settingsService from './settings';
import log from './log';

type MonitoringConfig = { updateInterval: number; minInterval: number; maxInterval: number };

class MonitoringConfigManager {
  private config: MonitoringConfig;
  private listeners: Set<(config: MonitoringConfig) => void>;
  private initialized: boolean;

  constructor() {
    this.config = reactive({
      updateInterval: 1000,
      minInterval: 500,
      maxInterval: 10000
    }) as unknown as MonitoringConfig;

    this.listeners = new Set();
    this.initialized = false;
  }

  /**
   * 初始化配置管理器
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // 从设置服务加载配置
      await this.loadFromSettings();

      // 监听配置变更事件
      this.setupEventListeners();

      // 如果设置服务尚未初始化，监听其初始化完成事件（优先 settings:ready，回退 services:ready）
      if (!(settingsService as any).isInitialized) {
        const handleSettingsReady = () => {
          if (!(settingsService as any).isInitialized) return; // 等待真正就绪
          try {
            this.loadFromSettings().catch(error => {
              log.error('设置服务就绪后加载监控配置失败', error);
            });
          } finally {
            // 直接使用字符串事件名，避免动态模块加载时序问题
            window.removeEventListener('settings:ready', handleSettingsReady as any);
            window.removeEventListener('services:ready', handleSettingsReady as any);
          }
        };
        // 直接使用字符串事件名，避免依赖加载顺序
        window.addEventListener('settings:ready', handleSettingsReady as any);
        // 兼容旧流程：某些情况下仅有 services:ready（核心服务触发）
        window.addEventListener('services:ready', handleSettingsReady as any);
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
  async loadFromSettings(): Promise<void> {
    // 等待设置服务初始化完成，但不主动初始化它
    // 避免重复初始化导致的主题闪烁问题
    if (!(settingsService as any).isInitialized) {
      log.warn('设置服务尚未初始化，使用默认监控配置');
      return;
    }

    const monitoringSettings = (settingsService as any).get('monitoring', {} as any) as any;
    Object.assign(this.config, {
      updateInterval: monitoringSettings.updateInterval || 1000
    });
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners(): void {
    // 监听监控配置变更事件
    window.addEventListener('monitoring-config-changed', this.handleConfigChange.bind(this) as any);
  }

  /**
   * 处理配置变更
   */
  handleConfigChange(event: CustomEvent<Partial<MonitoringConfig>>): void {
    const newConfig = (event as any).detail as Partial<MonitoringConfig>;

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
  validateConfig(config: Partial<MonitoringConfig>): boolean {
    if (config.updateInterval !== undefined) {
      return (
        typeof config.updateInterval === 'number' &&
        config.updateInterval >= this.config.minInterval &&
        config.updateInterval <= this.config.maxInterval
      );
    }
    return true;
  }

  /**
   * 添加配置变更监听器
   */
  addListener(callback: (config: MonitoringConfig) => void): void {
    this.listeners.add(callback);

    // 立即调用一次，传递当前配置
    callback(this.config);
  }

  /**
   * 移除配置变更监听器
   */
  removeListener(callback: (config: MonitoringConfig) => void): void {
    this.listeners.delete(callback);
  }

  /**
   * 通知所有监听器
   */
  notifyListeners(config: MonitoringConfig): void {
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
  getConfig(): MonitoringConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<MonitoringConfig>): void {
    if (!this.validateConfig(updates)) {
      throw new Error('无效的监控配置');
    }

    Object.assign(this.config, updates);

    // 保存到设置服务
    (settingsService as any).set('monitoring', this.config);

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
  applyPreset(presetName: 'highFrequency' | 'realtime' | 'standard' | 'powerSave') {
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
  getPerformanceImpact(interval: number) {
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
  getPerformanceDescription(interval: number) {
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
  destroy(): void {
    window.removeEventListener('monitoring-config-changed', this.handleConfigChange.bind(this) as any);
    this.listeners.clear();
    this.initialized = false;
  }
}

// 创建单例实例
const monitoringConfigManager = new MonitoringConfigManager();

export default monitoringConfigManager;
