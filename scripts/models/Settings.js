/**
 * 应用设置数据模型
 * 处理全局配置、界面和功能偏好设置
 */

import { getFromStorage, saveToStorage } from '../utils/storage.js';
import { EventEmitter } from '../utils/events.js';

// 本地存储键
const STORAGE_KEY = 'app.settings';

// 主题类型
export const ThemeTypes = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system'
};

// 布局类型
export const LayoutTypes = {
  DEFAULT: 'default',
  COMPACT: 'compact',
  COMFORTABLE: 'comfortable'
};

// 终端默认设置
export const TerminalDefaults = {
  FONT_FAMILY: "'JetBrains Mono'",
  FONT_SIZE: 16,
  CURSOR_STYLE: 'block',
  CURSOR_BLINK: true,
  SCROLLBACK: 1000
};

// 默认设置
const DEFAULT_SETTINGS = {
  // 界面设置
  ui: {
    theme: ThemeTypes.SYSTEM,
    language: 'zh-CN',
    layout: LayoutTypes.DEFAULT,
    fontSize: 14,
    sidebarCollapsed: false,
    animations: true,
    showStatusBar: true,
    showTabIcons: true
  },
  
  // 终端设置
  terminal: {
    fontFamily: TerminalDefaults.FONT_FAMILY,
    fontSize: TerminalDefaults.FONT_SIZE,
    cursorStyle: TerminalDefaults.CURSOR_STYLE,
    cursorBlink: TerminalDefaults.CURSOR_BLINK,
    scrollback: TerminalDefaults.SCROLLBACK,
    bellSound: true
  },
  
  // 连接设置
  connection: {
    defaultType: 'ssh',
    defaultAuthType: 'password',
    keepAliveInterval: 60,
    reconnectOnFailure: true,
    reconnectAttempts: 3,
    reconnectDelay: 5,
    timeout: 30,
    saveHistory: true,
    saveCredentials: false
  },
  
  // 编辑器设置
  editor: {
    autoSave: true,
    autoSaveInterval: 30,
    wordWrap: true,
    tabSize: 2,
    highlightActiveLine: true,
    showLineNumbers: true,
    showInvisibles: false
  },
  
  // 日志设置
  logging: {
    level: 'info',
    saveToFile: false,
    maxLogSize: 10 // MB
  },
  
  // 功能开关
  features: {
    multipleConnections: true,
    fileTransfer: true,
    terminalSplitting: true,
    commandHistory: true,
    keyboardShortcuts: true,
    autoCompletion: true
  },
  
  // 安全设置
  security: {
    lockTimeout: 15, // 分钟，0表示不锁定
    strictHostChecking: true,
    allowThirdPartyModules: false
  }
};

/**
 * 设置管理器类
 * 负责管理全局应用设置
 */
export class Settings extends EventEmitter {
  /**
   * 构造函数
   * @param {Object} initialSettings 初始设置
   */
  constructor(initialSettings = {}) {
    super();
    
    // 从存储加载设置，如果没有则使用默认设置
    const storedSettings = getFromStorage(STORAGE_KEY) || {};
    
    // 合并默认设置、存储设置和初始设置
    this._settings = this._mergeSettings(
      DEFAULT_SETTINGS,
      storedSettings,
      initialSettings
    );
    
    // 保存合并后的设置
    this._saveToStorage();
    
    // 系统主题检测
    if (this._settings.ui.theme === ThemeTypes.SYSTEM) {
      this._setupSystemThemeDetection();
    }
  }
  
  /**
   * 深度合并设置对象
   * @param {Object} target 目标对象
   * @param {...Object} sources 源对象列表
   * @returns {Object} 合并后的对象
   * @private
   */
  _mergeSettings(target, ...sources) {
    if (!sources.length) return target;
    
    const result = { ...target };
    
    for (const source of sources) {
      if (!source) continue;
      
      for (const key in source) {
        if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          // 递归合并对象
          result[key] = this._mergeSettings(result[key] || {}, source[key]);
        } else {
          // 直接覆盖
          result[key] = source[key];
        }
      }
    }
    
    return result;
  }
  
  /**
   * 保存设置到本地存储
   * @private
   */
  _saveToStorage() {
    saveToStorage(STORAGE_KEY, this._settings);
  }
  
  /**
   * 设置系统主题监听
   * @private
   */
  _setupSystemThemeDetection() {
    // 检测系统主题变化
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    // 初始检测
    this._handleSystemThemeChange(mediaQuery);
    
    // 监听变化
    try {
      // 新版API
      mediaQuery.addEventListener('change', event => {
        this._handleSystemThemeChange(event);
      });
    } catch (e) {
      // 兼容旧版API
      mediaQuery.addListener(event => {
        this._handleSystemThemeChange(event);
      });
    }
  }
  
  /**
   * 处理系统主题变化
   * @param {MediaQueryListEvent} event 媒体查询事件
   * @private
   */
  _handleSystemThemeChange(event) {
    const prefersDark = event.matches;
    const effectiveTheme = prefersDark ? ThemeTypes.DARK : ThemeTypes.LIGHT;
    
    // 应用主题但不修改用户设置
    this.emit('themeChange', effectiveTheme);
  }
  
  /**
   * 获取所有设置
   * @returns {Object} 设置对象
   */
  getAll() {
    return { ...this._settings };
  }
  
  /**
   * 获取指定设置
   * @param {string} path 设置路径，如 'ui.theme'
   * @param {*} defaultValue 默认值
   * @returns {*} 设置值
   */
  get(path, defaultValue = undefined) {
    const parts = path.split('.');
    let current = this._settings;
    
    for (const part of parts) {
      if (current === undefined || current === null) {
        return defaultValue;
      }
      current = current[part];
    }
    
    return current !== undefined ? current : defaultValue;
  }
  
  /**
   * 更新设置
   * @param {string} path 设置路径，如 'ui.theme'
   * @param {*} value 设置值
   * @returns {Settings} 设置实例
   */
  set(path, value) {
    const parts = path.split('.');
    const lastPart = parts.pop();
    let current = this._settings;
    
    // 创建路径
    for (const part of parts) {
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }
    
    // 检查值是否有变化
    const oldValue = current[lastPart];
    if (JSON.stringify(oldValue) === JSON.stringify(value)) {
      return this; // 无变化，直接返回
    }
    
    // 设置新值
    current[lastPart] = value;
    
    // 保存设置
    this._saveToStorage();
    
    // 特殊处理主题变化
    if (path === 'ui.theme') {
      if (value === ThemeTypes.SYSTEM) {
        this._setupSystemThemeDetection();
      } else {
        this.emit('themeChange', value);
      }
    }
    
    // 发出变更事件
    this.emit('change', { path, value, oldValue });
    this.emit(`change:${path}`, value, oldValue);
    
    return this;
  }
  
  /**
   * 批量更新设置
   * @param {Object} settings 设置对象
   * @returns {Settings} 设置实例
   */
  update(settings) {
    let hasChanges = false;
    const changes = {};
    
    // 递归更新设置
    const updateRecursive = (target, source, path = '') => {
      for (const key in source) {
        const currentPath = path ? `${path}.${key}` : key;
        const value = source[key];
        
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          // 如果是对象，递归更新
          if (!target[key]) target[key] = {};
          updateRecursive(target[key], value, currentPath);
        } else {
          // 简单值，直接更新
          const oldValue = target[key];
          if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
            target[key] = value;
            changes[currentPath] = { oldValue, value };
            hasChanges = true;
          }
        }
      }
    };
    
    updateRecursive(this._settings, settings);
    
    // 如有变化，保存并触发事件
    if (hasChanges) {
      this._saveToStorage();
      
      // 触发总体变更事件
      this.emit('change', changes);
      
      // 触发各个路径的变更事件
      for (const path in changes) {
        const { value, oldValue } = changes[path];
        this.emit(`change:${path}`, value, oldValue);
        
        // 特殊处理主题变化
        if (path === 'ui.theme') {
          if (value === ThemeTypes.SYSTEM) {
            this._setupSystemThemeDetection();
          } else {
            this.emit('themeChange', value);
          }
        }
      }
    }
    
    return this;
  }
  
  /**
   * 重置所有设置为默认值
   * @returns {Settings} 设置实例
   */
  resetAll() {
    const oldSettings = { ...this._settings };
    this._settings = { ...DEFAULT_SETTINGS };
    this._saveToStorage();
    
    this.emit('reset', { oldSettings, newSettings: this._settings });
    this.emit('change', { 
      path: '', 
      value: this._settings, 
      oldValue: oldSettings 
    });
    
    // 检查主题变化
    if (oldSettings.ui.theme !== DEFAULT_SETTINGS.ui.theme) {
      if (DEFAULT_SETTINGS.ui.theme === ThemeTypes.SYSTEM) {
        this._setupSystemThemeDetection();
      } else {
        this.emit('themeChange', DEFAULT_SETTINGS.ui.theme);
      }
    }
    
    return this;
  }
  
  /**
   * 重置指定类别设置为默认值
   * @param {string} category 设置类别，如 'ui', 'terminal'
   * @returns {Settings} 设置实例
   */
  resetCategory(category) {
    if (!(category in DEFAULT_SETTINGS)) {
      throw new Error(`未知设置类别: ${category}`);
    }
    
    const oldValue = { ...this._settings[category] };
    this._settings[category] = { ...DEFAULT_SETTINGS[category] };
    this._saveToStorage();
    
    this.emit('reset', { 
      category, 
      oldValue, 
      newValue: this._settings[category] 
    });
    this.emit('change', { 
      path: category, 
      value: this._settings[category], 
      oldValue 
    });
    
    // 检查主题变化
    if (category === 'ui' && oldValue.theme !== DEFAULT_SETTINGS.ui.theme) {
      if (DEFAULT_SETTINGS.ui.theme === ThemeTypes.SYSTEM) {
        this._setupSystemThemeDetection();
      } else {
        this.emit('themeChange', DEFAULT_SETTINGS.ui.theme);
      }
    }
    
    return this;
  }
  
  /**
   * 导出设置为JSON字符串
   * @returns {string} 设置JSON
   */
  export() {
    return JSON.stringify(this._settings, null, 2);
  }
  
  /**
   * 导入设置
   * @param {string|Object} settings 设置JSON字符串或对象
   * @returns {Settings} 设置实例
   */
  import(settings) {
    try {
      const parsedSettings = typeof settings === 'string' 
        ? JSON.parse(settings) 
        : settings;
        
      const oldSettings = { ...this._settings };
      this._settings = this._mergeSettings(DEFAULT_SETTINGS, parsedSettings);
      this._saveToStorage();
      
      this.emit('import', { oldSettings, newSettings: this._settings });
      this.emit('change', { 
        path: '', 
        value: this._settings, 
        oldValue: oldSettings 
      });
      
      // 检查主题变化
      if (oldSettings.ui.theme !== this._settings.ui.theme) {
        if (this._settings.ui.theme === ThemeTypes.SYSTEM) {
          this._setupSystemThemeDetection();
        } else {
          this.emit('themeChange', this._settings.ui.theme);
        }
      }
      
      return this;
    } catch (error) {
      throw new Error(`导入设置失败: ${error.message}`);
    }
  }
  
  /**
   * 获取有效主题
   * @returns {string} 当前有效主题
   */
  getEffectiveTheme() {
    const theme = this.get('ui.theme');
    
    if (theme === ThemeTypes.SYSTEM) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches 
        ? ThemeTypes.DARK 
        : ThemeTypes.LIGHT;
    }
    
    return theme;
  }
  
  /**
   * 设置主题
   * @param {string} theme 主题
   * @returns {Settings} 设置实例
   */
  setTheme(theme) {
    return this.set('ui.theme', theme);
  }
  
  /**
   * 设置语言
   * @param {string} language 语言代码
   * @returns {Settings} 设置实例
   */
  setLanguage(language) {
    return this.set('ui.language', language);
  }
  
  /**
   * 切换布局类型
   * @param {string} layout 布局类型
   * @returns {Settings} 设置实例
   */
  setLayout(layout) {
    return this.set('ui.layout', layout);
  }
  
  /**
   * 创建设置单例
   * @returns {Settings} 设置实例
   */
  static create() {
    if (!Settings.instance) {
      Settings.instance = new Settings();
    }
    return Settings.instance;
  }
  
  /**
   * 获取设置单例
   * @returns {Settings} 设置实例
   */
  static getInstance() {
    return Settings.create();
  }
}

export default Settings; 