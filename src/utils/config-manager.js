/**
 * 运行时配置管理工具
 * 专门用于开发环境的配置覆盖和调试功能
 * 用户设置请使用 SettingsService
 */
import { autocompleteConfig, environment } from '@/config/app-config';
import log from '@/services/log';
import storageService from '@/services/storage';

class ConfigManager {
  constructor() {
    this.defaultConfig = { ...autocompleteConfig };
    this.runtimeConfig = { ...autocompleteConfig };
    this.overrides = {};

    // 仅在开发环境下启用配置覆盖功能
    if (environment.isDevelopment) {
      this.loadDevOverrides();
    }
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    return { ...this.runtimeConfig };
  }

  /**
   * 获取指定路径的配置值
   * @param {string} path - 配置路径，如 'memory.maxSize'
   * @param {any} defaultValue - 默认值
   */
  get(path, defaultValue = undefined) {
    const keys = path.split('.');
    let value = this.runtimeConfig;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * 设置配置值
   * @param {string} path - 配置路径
   * @param {any} value - 配置值
   * @param {boolean} persist - 是否持久化到本地存储
   */
  set(path, value, persist = false) {
    const keys = path.split('.');
    let target = this.runtimeConfig;

    // 导航到目标对象
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }

    // 设置值
    const lastKey = keys[keys.length - 1];
    const oldValue = target[lastKey];
    target[lastKey] = value;

    // 记录覆盖
    this.overrides[path] = { value, oldValue, timestamp: Date.now() };

    // 持久化到本地存储（开发环境）
    if (persist && environment.isDevelopment) {
      this.saveDevOverrides();
    }

    log.debug(`配置已更新: ${path} = ${JSON.stringify(value)}`, {
      oldValue,
      newValue: value,
      persist
    });

    return this;
  }

  /**
   * 重置配置到默认值
   * @param {string} path - 配置路径，不提供则重置所有
   */
  reset(path = null) {
    if (path) {
      // 重置指定路径
      const keys = path.split('.');
      let defaultValue = this.defaultConfig;
      const target = this.runtimeConfig;

      // 获取默认值
      for (const key of keys) {
        if (defaultValue && typeof defaultValue === 'object' && key in defaultValue) {
          defaultValue = defaultValue[key];
        } else {
          defaultValue = undefined;
          break;
        }
      }

      // 设置默认值
      if (defaultValue !== undefined) {
        this.set(path, defaultValue);
      }

      // 清除覆盖记录
      delete this.overrides[path];
    } else {
      // 重置所有配置
      this.runtimeConfig = { ...this.defaultConfig };
      this.overrides = {};

      if (environment.isDevelopment) {
        storageService.removeItem('dev-cache-config');
      }
    }

    log.debug(`配置已重置: ${path || '全部'}`);
    return this;
  }

  /**
   * 获取配置覆盖信息
   */
  getOverrides() {
    return { ...this.overrides };
  }

  /**
   * 加载开发环境配置覆盖
   */
  loadDevOverrides() {
    try {
      const stored = storageService.getItem('dev-cache-config');
      if (stored) {
        const overrides = JSON.parse(stored);

        Object.entries(overrides).forEach(([path, override]) => {
          this.set(path, override.value, false);
        });

        log.debug('已加载开发环境配置覆盖', overrides);
      }
    } catch (error) {
      log.warn('加载开发环境配置覆盖失败:', error);
    }
  }

  /**
   * 保存开发环境配置覆盖
   */
  saveDevOverrides() {
    try {
      storageService.setItem('dev-cache-config', JSON.stringify(this.overrides));
      log.debug('已保存开发环境配置覆盖');
    } catch (error) {
      log.warn('保存开发环境配置覆盖失败:', error);
    }
  }

  /**
   * 创建配置预设
   * @param {string} name - 预设名称
   * @param {Object} config - 配置对象
   */
  createPreset(name, config) {
    const presets = this.getPresets();
    presets[name] = {
      config: { ...config },
      createdAt: new Date().toISOString()
    };

    if (environment.isDevelopment) {
      storageService.setItem('cache-config-presets', JSON.stringify(presets));
    }

    log.debug(`配置预设已创建: ${name}`);
    return this;
  }

  /**
   * 应用配置预设
   * @param {string} name - 预设名称
   */
  applyPreset(name) {
    const presets = this.getPresets();
    const preset = presets[name];

    if (!preset) {
      log.warn(`配置预设不存在: ${name}`);
      return this;
    }

    // 应用预设配置
    Object.entries(preset.config).forEach(([section, sectionConfig]) => {
      if (typeof sectionConfig === 'object') {
        Object.entries(sectionConfig).forEach(([key, value]) => {
          this.set(`${section}.${key}`, value, true);
        });
      }
    });

    log.info(`已应用配置预设: ${name}`);
    return this;
  }

  /**
   * 获取所有配置预设
   */
  getPresets() {
    try {
      const stored = storageService.getItem('cache-config-presets');
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      log.warn('获取配置预设失败:', error);
      return {};
    }
  }

  /**
   * 删除配置预设
   * @param {string} name - 预设名称
   */
  deletePreset(name) {
    const presets = this.getPresets();
    delete presets[name];

    if (environment.isDevelopment) {
      storageService.setItem('cache-config-presets', JSON.stringify(presets));
    }

    log.debug(`配置预设已删除: ${name}`);
    return this;
  }

  /**
   * 导出配置
   */
  exportConfig() {
    return {
      current: this.getConfig(),
      overrides: this.getOverrides(),
      presets: this.getPresets(),
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * 导入配置
   * @param {Object} configData - 配置数据
   */
  importConfig(configData) {
    try {
      if (configData.current) {
        this.runtimeConfig = { ...configData.current };
      }

      if (configData.overrides) {
        this.overrides = { ...configData.overrides };
      }

      if (configData.presets && environment.isDevelopment) {
        storageService.setItem('cache-config-presets', JSON.stringify(configData.presets));
      }

      this.saveDevOverrides();
      log.info('配置导入成功');
    } catch (error) {
      log.error('配置导入失败:', error);
    }

    return this;
  }

  /**
   * 获取配置统计信息
   */
  getStats() {
    return {
      totalOverrides: Object.keys(this.overrides).length,
      totalPresets: Object.keys(this.getPresets()).length,
      isDevelopment: environment.isDevelopment,
      lastModified: Math.max(...Object.values(this.overrides).map(o => o.timestamp), 0)
    };
  }
}

// 创建全局配置管理器实例
const configManager = new ConfigManager();

// 开发环境下暴露到全局
if (environment.isDevelopment && typeof window !== 'undefined') {
  window.configManager = configManager;

  // 提供便捷的调试方法
  window.autocompleteConfig = {
    get: (path, defaultValue) => configManager.get(path, defaultValue),
    set: (path, value, persist = true) => configManager.set(path, value, persist),
    reset: path => configManager.reset(path),
    export: () => configManager.exportConfig(),
    import: data => configManager.importConfig(data),
    presets: {
      create: (name, config) => configManager.createPreset(name, config),
      apply: name => configManager.applyPreset(name),
      list: () => configManager.getPresets(),
      delete: name => configManager.deletePreset(name)
    },
    stats: () => configManager.getStats()
  };

  log.debug('配置管理器已暴露到全局 window.configManager 和 window.autocompleteConfig');
}

export default configManager;
export { ConfigManager };
