/**
 * 统一设置服务模块
 * 整合了原有的多个设置管理，提供统一的设置接口
 */
import { reactive, watch } from 'vue';
import { userSettingsDefaults } from '../config/app-config.js';
import storageUtils from '../utils/storage.js';
import log from './log';
import { useUserStore } from '../store/user.js';
import storageAdapter from './storage-adapter.js';
import { useTerminalStore } from '../store/terminal';
import apiService from './api';
import { EVENTS } from '@/services/events';

const SETTINGS_STORAGE_KEY = 'user_settings';

// 终端主题常量
export const TERMINAL_THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  VSCODE: 'vscode',
  DRACULA: 'dracula',
  MATERIAL: 'material',
  SYSTEM: 'system'
};

export const VALID_THEMES = Object.values(TERMINAL_THEMES);

// 可同步到服务器的设置分类（UI始终只在本地保存）
const SERVER_SAVE_CATEGORIES = new Set(['terminal', 'connection', 'editor', 'advanced', 'monitoring']);

class SettingsService {
  constructor() {
    this.isInitialized = false;
    this.hasServerSettings = false; // 是否已加载过服务器侧设置
    this._loading = null; // 并发保护：正在加载的Promise

    // 响应式设置对象
    this.settings = reactive({ ...userSettingsDefaults });

    // 创建专用的存储实例
    this.storage = storageUtils.createPrefixedStorage('easyssh:');

    // 设置变更监听器
    this.changeListeners = new Set();

    // 添加主题缓存，避免重复计算
    this._themeCache = new Map();

    // 仅保存发生变更的分类，减少不必要的请求
    this._dirtyCategories = new Set();

    // 批量更新时可暂时暂停自动保存，避免重复提交
    this._autoSavePaused = false;

    // 日志脱敏配置
    this._sensitiveCategories = new Set(['ai-config']);
    this._sensitiveFields = new Set(['apiKey']);

    // 登录/存储模式事件监听标志
    this._authListenersSetup = false;

    // 终端背景的当前快照（从最小接口加载）
    this._terminalBackground = null;

    // 背景事件监听只注册一次，保持快照与事件一致
    this._bgListenersSetup = false;
  }

  /**
   * 初始化设置服务
   * @returns {Promise<boolean>} 是否初始化成功
   */
  async init(force = false) {
    // 已初始化且不强制，直接返回
    if (this.isInitialized && !force) {
      return true;
    }

    if (this._loading) {
      try {
        await this._loading;
        return true;
      } catch (_) {
        return false;
      }
    }

    this._loading = (async () => {
      try {
        // 从存储加载设置（登录态下会从服务器获取分类设置）
        await this.loadSettings();

        // 应用/校验主题（仅当不一致时应用）
        try {
          const currentTheme = document.documentElement.getAttribute('data-theme');
          const expectedTheme =
            this.settings.ui.theme === 'system'
              ? window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light'
              : this.settings.ui.theme;

          if (currentTheme !== expectedTheme) {
            this.applyTheme(this.settings.ui.theme);
          }
        } catch (_) {}

        // 首次初始化时设置监听与自动保存
        if (!this.isInitialized) {
          this._setupSystemThemeListener();
          this._setupAutoSave();
          this._setupAuthListeners();
          this._setupBackgroundListeners();
        }

        this.isInitialized = true;

        // 广播设置服务就绪事件，供依赖方感知（避免混用 services:ready 带来的歧义）
        try {
          const categories = this.loadedCategories
            ? Array.from(this.loadedCategories)
            : [];
          window.dispatchEvent(
            new CustomEvent(EVENTS.SETTINGS_READY, {
              detail: {
                categoriesLoaded: categories,
                hasServerSettings: this.hasServerSettings === true
              }
            })
          );
        } catch (_) {}
        return true;
      } catch (error) {
        log.error('设置服务初始化失败', error);
        return false;
      } finally {
        this._loading = null;
      }
    })();

    return this._loading;
  }

  /**
   * 监听背景事件，保持内存快照与 UI 事件一致
   * @private
   */
  _setupBackgroundListeners() {
    if (this._bgListenersSetup) return;
    try {
      const updateBg = e => {
        try {
          const bg = e?.detail || e?.detail?.bgSettings;
          if (bg && typeof bg === 'object') {
            this._terminalBackground = { ...bg };
          } else if (typeof e?.detail?.enabled === 'boolean' && this._terminalBackground) {
            // 仅状态变化时更新 enabled
            this._terminalBackground = { ...this._terminalBackground, enabled: !!e.detail.enabled };
          }
        } catch (_) {}
      };
      window.addEventListener(EVENTS.TERMINAL_BG_CHANGED, updateBg);
      window.addEventListener(EVENTS.TERMINAL_BG_STATUS, updateBg);
      this._bgListenersSetup = true;
    } catch (_) {
      // 忽略：非浏览器环境或事件注册失败
    }
  }

  /**
   * 监听登录与存储模式变化，在登录完成后拉取最小化终端设置
   * @private
   */
  _setupAuthListeners() {
    if (this._authListenersSetup) return;
    try {
      // 登录成功后，强制重新初始化以触发最小化接口拉取
      window.addEventListener('auth:login-success', async () => {
        try {
          await this.init(true);
        } catch (_) {}
      });

      // 存储模式切换为 server 时也刷新一次
      window.addEventListener('storage-mode-changed', async (e) => {
        try {
          const mode = e?.detail?.mode;
          if (mode === 'server') {
            await this.init(true);
          }
        } catch (_) {}
      });
      this._authListenersSetup = true;
    } catch (_) {
      // 忽略监听器设置失败
    }
  }

  /**
   * 从存储加载设置
   * @private
   */
  async loadSettings() {
    try {
      // 确保存储适配器已就绪（避免在未初始化时误判登录态）
      try {
        if (!storageAdapter.initialized && typeof storageAdapter.init === 'function') {
          await storageAdapter.init();
        }
      } catch (_) {
        // 初始化失败不阻塞后续逻辑，按原有回退策略处理
      }

      // 检查是否已登录，如果已登录则从服务器加载设置
      const userStore = useUserStore();

      if (userStore.isLoggedIn) {
        // 登录状态：使用最小化接口，避免多拿数据
        try {
          const resp = await apiService.get(
            '/users/settings/terminal/minimal',
            {},
            { useCache: false }
          );

          if (resp && resp.success) {
            const minimalTerminal = resp.data?.terminal || {};
            const ai = resp.data?.ai || {};
            const aiEnabled = !!ai.enabled;

            // 合并终端最小配置
            if (Object.keys(minimalTerminal).length > 0) {
              this._mergeSettings(this.settings, { terminal: minimalTerminal });
            }

            // 写入AI最小配置（启用位与模型，避免泄露敏感字段）
            try {
              this.settings['ai-config'] = this.settings['ai-config'] || {};
              this.settings['ai-config'].enabled = aiEnabled;
              if (typeof ai.model === 'string' && ai.model) {
                this.settings['ai-config'].model = ai.model;
              }
            } catch (_) {}

            // 处理终端背景设置（如果最小化接口提供）
            try {
              const bg = resp.data?.terminalBackground;
              if (bg && typeof bg === 'object') {
                // 标记分类加载（用于按需获取时跳过重复请求）
                try {
                  if (!this.loadedCategories) this.loadedCategories = new Set();
                  this.loadedCategories.add('terminal.background');
                } catch (_) {}

                // 缓存当前背景配置，供组件按需读取
                this._terminalBackground = { ...bg };

                // 广播背景状态与变更事件，确保在创建连接时即时生效
                try {
                  window.dispatchEvent(
                    new CustomEvent(EVENTS.TERMINAL_BG_STATUS, {
                      detail: { enabled: !!bg.enabled, bgSettings: bg }
                    })
                  );
                  window.dispatchEvent(new CustomEvent(EVENTS.TERMINAL_BG_CHANGED, { detail: bg }));
                } catch (_) {}
              }
            } catch (e) {
              // 忽略背景处理异常，不影响其他设置
            }

            this.hasServerSettings = true;
            // 标记已加载的分类（仅标记terminal，ai-config不标记为完整加载）
            try {
              if (!this.loadedCategories) this.loadedCategories = new Set();
              this.loadedCategories.add('terminal');
            } catch (_) {}

            log.debug('最小化设置已从服务器加载', {
              hasTerminalSettings: Object.keys(minimalTerminal).length > 0,
              aiEnabled,
              aiHasModel: !!ai.model
            });
          } else {
            throw new Error('最小化接口返回无效');
          }
        } catch (error) {
          // 回退：如最小化接口异常，仍按旧逻辑尝试分类拉取
          log.warn('最小化设置接口失败，回退到分类加载：', error);
          try {
            let serverSettings = {};
            const categories = ['terminal', 'connection', 'editor', 'advanced', 'monitoring'];
            for (const category of categories) {
              try {
                const categoryData = await storageAdapter.get(category, null);
                if (categoryData) {
                  serverSettings[category] = categoryData;
                }
              } catch (e) {
                log.warn(`从服务器加载${category}设置失败:`, e);
              }
            }
            if (serverSettings && Object.keys(serverSettings).length > 0) {
              this._mergeSettings(this.settings, serverSettings);
              this.hasServerSettings = true;
              try {
                if (!this.loadedCategories) this.loadedCategories = new Set();
                Object.keys(serverSettings).forEach(c => this.loadedCategories.add(c));
              } catch (_) {}
            }
          } catch (e) {
            log.warn('从服务器加载设置失败，回退到本地存储:', e);
            this.hasServerSettings = false;
          }
        }
      }

      // 无论登录状态如何，UI设置始终从本地存储加载（保持设备相关的偏好设置）
      const storedSettings = this.storage.get(SETTINGS_STORAGE_KEY, {});

      // 设计约束：
      // - 登录后：服务器设置 + 本地 UI 设置
      // - 未登录：仅本地 UI 设置，其余使用默认值（不合并本地的 terminal/connection 等）
      let settingsToMerge = {};
      if (storedSettings && storedSettings.ui) {
        settingsToMerge.ui = storedSettings.ui;
        log.debug('UI设置已从本地存储加载', { theme: storedSettings.ui?.theme });
      }

      // 深度合并设置（仅包含UI部分；非UI分类已在上方按登录状态处理或保持默认）
      if (Object.keys(settingsToMerge).length > 0) {
        this._mergeSettings(this.settings, settingsToMerge);
      }
    } catch (error) {
      log.warn('加载设置失败，使用默认设置', error);
    }
  }

  /**
   * 仅本地初始化（只加载并应用UI设置，不从服务器拉取）
   */
  async initLocalOnly() {
    try {
      // 读取本地 UI 设置
      const storedSettings = this.storage.get(SETTINGS_STORAGE_KEY, {});
      if (storedSettings && storedSettings.ui) {
        this._mergeSettings(this.settings, { ui: storedSettings.ui });
      }

      // 应用/校验主题
      try {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const expectedTheme =
          this.settings.ui.theme === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            : this.settings.ui.theme;
        if (currentTheme !== expectedTheme) {
          this.applyTheme(this.settings.ui.theme);
        }
      } catch (_) {}

      if (!this.isInitialized) {
        this._setupSystemThemeListener();
        this._setupAutoSave();
      }
      this.isInitialized = true;
      // 本地就绪同样广播事件，方便监听方统一处理
      try {
        const { EVENTS } = await import('@/services/events');
        window.dispatchEvent(
          new CustomEvent(EVENTS.SETTINGS_READY, {
            detail: { categoriesLoaded: ['ui'], hasServerSettings: false }
          })
        );
      } catch (_) {
        try {
          window.dispatchEvent(
            new CustomEvent('settings:ready', {
              detail: { categoriesLoaded: ['ui'], hasServerSettings: false }
            })
          );
        } catch (__) {}
      }
      this.hasServerSettings = false;
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 返回设置快照（可选按分类） */
  getSnapshot(categories = null) {
    if (!categories || categories.length === 0) {
      return { ...this.settings };
    }
    const out = {};
    categories.forEach(c => {
      if (this.settings[c] !== undefined) out[c] = { ...this.settings[c] };
    });
    return out;
  }

  /** 获取已加载的终端背景（若有） */
  getTerminalBackground() {
    try {
      return this._terminalBackground ? { ...this._terminalBackground } : null;
    } catch (_) {
      return null;
    }
  }

  /** 将当前设置应用到提供的目标对象（按分类） */
  applyToTargets(targets = {}) {
    if (!targets || typeof targets !== 'object') return;
    const applyOne = (cat, obj) => {
      if (!obj) return;
      const src = this.settings?.[cat];
      if (src === undefined) return;
      try {
        Object.assign(obj, src);
        if (Object.prototype.hasOwnProperty.call(obj, 'initialized')) obj.initialized = true;
        if (cat === 'terminal' && !obj.rendererType) obj.rendererType = 'auto';
      } catch (_) {}
    };
    Object.keys(targets).forEach(cat => applyOne(cat, targets[cat]));
  }

  /** 指定分类是否已从服务器加载 */
  isCategoryLoaded(category) {
    return !!this.loadedCategories && this.loadedCategories.has(category);
  }

  /**
   * 保存设置到存储
   * @private
   */
  async saveSettings() {
    try {
      // 始终保存到本地存储作为备份
      this.storage.set(SETTINGS_STORAGE_KEY, this.settings);

      // 调试信息：显示保存的数据（敏感信息脱敏）
      try {
        const masked = this._sanitizeForLogging(this.settings);
        log.debug('设置已保存到本地存储', {
          key: `easyssh:${SETTINGS_STORAGE_KEY}`,
          uiTheme: this.settings.ui?.theme,
          fullSettings: masked
        });
      } catch (_) {
        log.debug('设置已保存到本地存储', {
          key: `easyssh:${SETTINGS_STORAGE_KEY}`,
          uiTheme: this.settings.ui?.theme
        });
      }

      // 检查是否已登录，如果已登录则仅保存变更过的分类到服务器
      try {
        const userStore = useUserStore();

        if (userStore.isLoggedIn) {
          const categoriesToSave = Array.from(this._dirtyCategories).filter(c =>
            SERVER_SAVE_CATEGORIES.has(c)
          );

          if (categoriesToSave.length > 0) {
            const savePromises = categoriesToSave.map(async category => {
              if (this.settings[category]) {
                try {
                  await storageAdapter.set(category, this.settings[category]);
                } catch (error) {
                  log.warn(`保存${category}设置到服务器失败:`, error);
                }
              }
            });

            await Promise.allSettled(savePromises);
            log.debug('设置已保存到服务器的分类:', categoriesToSave);
          } else {
            // 只有本地设置（如UI）变更，不触发服务器保存
            log.debug('无服务器需保存的设置分类');
          }

          // 清空脏分类标记
          this._dirtyCategories.clear();
        } else {
          log.debug('设置已保存到本地存储');
        }
      } catch (error) {
        log.warn('保存设置到服务器失败，仅保存到本地:', error);
        log.debug('设置已保存到本地存储');
      }
    } catch (error) {
      log.error('保存设置失败', error);
    }
  }

  /**
   * 深度合并设置对象
   * @param {Object} target - 目标对象
   * @param {Object} source - 源对象
   * @private
   */
  _mergeSettings(target, source) {
    for (const key in source) {
      if (Object.hasOwn(source, key)) {
        if (target[key] && typeof target[key] === 'object' && typeof source[key] === 'object') {
          this._mergeSettings(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    }
  }

  /**
   * 设置自动保存监听器
   * @private
   */
  _setupAutoSave() {
    // 使用Vue的watch监听设置变更
    watch(
      () => this.settings,
      () => {
        if (this._autoSavePaused) return;
        this.saveSettings();
        this._notifyListeners();
      },
      { deep: true }
    );
  }

  /**
   * 通知变更监听器
   * @private
   */
  _notifyListeners() {
    this.changeListeners.forEach(listener => {
      try {
        listener(this.settings);
      } catch (error) {
        log.error('设置变更监听器执行失败', error);
      }
    });
  }

  /**
   * 获取设置值
   * @param {string} path - 设置路径，如 'ui.theme'
   * @param {any} defaultValue - 默认值
   * @returns {any} 设置值
   */
  get(path, defaultValue = undefined) {
    const keys = path.split('.');
    let value = this.settings;

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
   * 设置值
   * @param {string} path - 设置路径
   * @param {any} value - 设置值
   */
  set(path, value) {
    const keys = path.split('.');
    let target = this.settings;

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
    target[lastKey] = value;

    try {
      // 针对敏感路径/字段进行脱敏
      let toLog = value;
      const lowerPath = path.toLowerCase();
      if (lowerPath.startsWith('ai-config')) {
        if (typeof value === 'object' && value !== null) {
          const cloned = Array.isArray(value) ? [...value] : { ...value };
          if (Object.prototype.hasOwnProperty.call(cloned, 'apiKey')) {
            const v = String(cloned.apiKey || '');
            cloned.apiKey = v ? `***${v.slice(-4)}` : '';
          }
          toLog = cloned;
        } else if (lowerPath === 'ai-config.apikey') {
          const v = String(value || '');
          toLog = v ? `***${v.slice(-4)}` : '';
        }
      }
      log.debug(`设置已更新: ${path} = ${JSON.stringify(toLog)}`);
    } catch (_) {
      // 忽略日志异常
    }

    // 标记顶级分类为已变更（仅服务器支持的分类会被同步）
    const topCategory = keys[0];
    if (SERVER_SAVE_CATEGORIES.has(topCategory)) {
      this._dirtyCategories.add(topCategory);
    }
  }

  /**
   * 生成用于日志输出的脱敏副本
   * @param {Object} settings 设置对象
   * @returns {Object} 脱敏后的对象
   * @private
   */
  _sanitizeForLogging(settings) {
    const cloneDeep = obj => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(cloneDeep);
      const out = {};
      for (const k of Object.keys(obj)) out[k] = cloneDeep(obj[k]);
      return out;
    };

    const masked = cloneDeep(settings || {});

    // 统一处理 ai-config 内的 apiKey
    if (masked['ai-config']) {
      const cfg = masked['ai-config'];
      if (cfg && typeof cfg === 'object') {
        if (Object.prototype.hasOwnProperty.call(cfg, 'apiKey')) {
          const v = String(cfg.apiKey || '');
          cfg.apiKey = v ? `***${v.slice(-4)}` : '';
        }
      }
    }

    return masked;
  }

  /**
   * 暂停自动保存（在批量或受控保存场景下使用）
   */
  pauseAutoSave() {
    this._autoSavePaused = true;
  }

  /**
   * 恢复自动保存
   */
  resumeAutoSave() {
    this._autoSavePaused = false;
  }

  /**
   * 仅保存指定分类到服务器
   * @param {string} category
   * @returns {Promise<boolean>}
   */
  async saveCategory(category) {
    if (!SERVER_SAVE_CATEGORIES.has(category)) return false;
    try {
      this._autoSavePaused = true;
      await storageAdapter.set(category, this.settings[category]);
      this._dirtyCategories.delete(category);
      log.debug(`分类已保存到服务器: ${category}`);
      return true;
    } catch (error) {
      log.error(`保存分类失败: ${category}`, error);
      return false;
    } finally {
      this._autoSavePaused = false;
    }
  }

  /**
   * 重置设置到默认值
   * @param {string} path - 设置路径，不提供则重置所有
   */
  reset(path = null) {
    if (path) {
      // 重置指定路径
      const keys = path.split('.');
      let defaultValue = userSettingsDefaults;

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
    } else {
      // 重置所有设置
      Object.assign(this.settings, userSettingsDefaults);
    }

    log.debug(`设置已重置: ${path || '全部'}`);
  }

  /**
   * 添加设置变更监听器
   * @param {Function} listener - 监听器函数
   */
  addChangeListener(listener) {
    this.changeListeners.add(listener);
  }

  /**
   * 移除设置变更监听器
   * @param {Function} listener - 监听器函数
   */
  removeChangeListener(listener) {
    this.changeListeners.delete(listener);
  }

  /**
   * 获取终端设置
   * @returns {Object} 终端设置
   */
  getTerminalSettings() {
    return { ...this.settings.terminal };
  }

  /**
   * 获取连接设置
   * @returns {Object} 连接设置
   */
  getConnectionSettings() {
    return { ...this.settings.connection };
  }

  /**
   * 获取UI设置
   * @returns {Object} UI设置
   */
  getUISettings() {
    return { ...this.settings.ui };
  }

  /**
   * 获取编辑器设置
   * @returns {Object} 编辑器设置
   */
  getEditorSettings() {
    return { ...this.settings.editor };
  }

  /**
   * 获取高级设置
   * @returns {Object} 高级设置
   */
  getAdvancedSettings() {
    return { ...this.settings.advanced };
  }

  /**
   * 获取终端选项（用于xterm.js）
   * @returns {Object} 终端选项
   */
  getTerminalOptions() {
    // 如果未初始化，先尝试初始化
    if (!this.isInitialized) {
      log.warn('设置服务未初始化，使用默认终端选项');
      return this._getDefaultTerminalOptions();
    }

    const terminalSettings = this.settings.terminal;
    const theme = this._getTerminalTheme(terminalSettings.theme || TERMINAL_THEMES.DARK);

    // 优化：只在首次获取或主题变化时记录详细日志
    const currentTheme = terminalSettings.theme;
    if (!this._lastLoggedTheme || this._lastLoggedTheme !== currentTheme) {
      log.debug('获取终端选项', {
        fontSize: terminalSettings.fontSize,
        fontFamily: terminalSettings.fontFamily,
        theme: currentTheme,
        themeColors: {
          foreground: theme.foreground,
          background: theme.background
        }
      });
      this._lastLoggedTheme = currentTheme;
    }

    return {
      fontSize: terminalSettings.fontSize,
      fontFamily: terminalSettings.fontFamily,
      lineHeight: terminalSettings.lineHeight,
      theme,
      cursorBlink: terminalSettings.cursorBlink,
      cursorStyle: terminalSettings.cursorStyle,
      scrollback: terminalSettings.scrollback,
      allowTransparency: true,
      rendererType: terminalSettings.rendererType || 'auto', // 自动选择渲染器
      fallbackRenderer: terminalSettings.fallbackRenderer || 'dom', // 备用DOM渲染器
      convertEol: true,
      disableStdin: false,
      drawBoldTextInBrightColors: true,
      copyOnSelect: terminalSettings.copyOnSelect,
      rightClickSelectsWord: terminalSettings.rightClickSelectsWord
    };
  }

  /**
   * 更新终端设置
   * @param {Object} updates - 要更新的设置
   * @param {boolean} applyToTerminals - 是否立即应用到所有终端
   */
  updateTerminalSettings(updates, applyToTerminals = false) {
    Object.assign(this.settings.terminal, updates);
    log.debug('终端设置已更新:', updates);
    log.debug('更新后的完整终端设置:', this.settings.terminal);

    // 标记终端设置为脏
    this._dirtyCategories.add('terminal');

    // 如果需要立即应用到终端，触发应用逻辑
    if (applyToTerminals) {
      this._applyTerminalSettingsToAllTerminals();
    }
  }

  /**
   * 将当前终端设置应用到所有打开的终端
   * @private
   */
  async _applyTerminalSettingsToAllTerminals() {
    try {
      const terminalStore = useTerminalStore();

      if (terminalStore && terminalStore.applySettingsToAllTerminals) {
        const results = await terminalStore.applySettingsToAllTerminals(this.settings.terminal);
        log.debug('设置已应用到所有终端:', results);
      }
    } catch (error) {
      log.error('应用终端设置到所有终端失败:', error);
    }
  }

  /**
   * 更新连接设置
   * @param {Object} updates - 要更新的设置
   */
  updateConnectionSettings(updates) {
    Object.assign(this.settings.connection, updates);
    this._dirtyCategories.add('connection');
  }

  /**
   * 更新监控设置
   * @param {Object} updates - 要更新的设置
   */
  updateMonitoringSettings(updates) {
    Object.assign(this.settings.monitoring, updates);
    this._dirtyCategories.add('monitoring');
  }

  /**
   * 更新UI设置
   * @param {Object} updates - 要更新的设置
   */
  updateUISettings(updates) {
    if (!updates || typeof updates !== 'object') {
      log.warn('updateUISettings: 无效的更新参数', updates);
      return;
    }

    Object.assign(this.settings.ui, updates);

    // 如果主题发生变化，立即应用
    if (updates.theme && this.isValidTheme(updates.theme)) {
      this.applyTheme(updates.theme);
    } else if (updates.theme) {
      log.warn('updateUISettings: 无效的主题值', updates.theme);
    }
  }

  /**
   * 解析实际主题（处理system主题）
   * @param {string} theme - 原始主题设置
   * @returns {string} 实际主题 (light|dark)
   * @private
   */
  _resolveActualTheme(theme) {
    if (theme === 'system') {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme === 'dark' ? 'dark' : 'light'; // 确保只返回有效值
  }

  /**
   * 设置系统主题变化监听器
   * @private
   */
  _setupSystemThemeListener() {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleSystemThemeChange = e => {
      // 只有当用户选择了"跟随系统"时才响应系统主题变化
      if (this.settings.ui.theme === 'system') {
        const newTheme = e.matches ? 'dark' : 'light';
        log.debug('系统主题变化，自动切换主题', { newTheme });
        this.applyTheme('system');
      }
    };

    // 监听系统主题变化
    mediaQuery.addEventListener('change', handleSystemThemeChange);

    // 保存监听器引用，用于清理
    this._systemThemeListener = {
      mediaQuery,
      handler: handleSystemThemeChange
    };
  }

  /**
   * 应用主题
   * @param {string} theme - 主题名称 (light, dark, system)
   * @param {Object} options - 选项
   * @param {boolean} options.skipIfSame - 如果主题相同则跳过所有操作
   */
  applyTheme(theme = this.settings.ui.theme, options = {}) {
    // 解析实际主题
    const actualTheme = this._resolveActualTheme(theme);

    // 获取当前主题，避免不必要的切换
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme === actualTheme) {
      if (options.skipIfSame) {
        log.debug('主题已正确应用，跳过重复操作', { theme, actualTheme });
        return;
      }
      return; // 主题没有变化，无需切换
    }

    // 批量同步更新DOM，避免多次重绘
    const documentElement = document.documentElement;

    // 添加主题切换状态类，提供视觉反馈
    documentElement.classList.add('theme-switching');

    // 使用requestAnimationFrame确保在下一帧开始时应用主题
    requestAnimationFrame(() => {
      // 设置主题属性和类名
      documentElement.setAttribute('data-theme', actualTheme);
      documentElement.className = documentElement.className.replace(/\b(light|dark)-theme\b/g, '');
      documentElement.classList.add(`${actualTheme}-theme`);

      // 设置语言
      const language = this.settings.ui.language;
      if (language) {
        documentElement.setAttribute('lang', language);
      }

      // 清除终端主题缓存，确保下次获取时使用新的CSS变量值
      this._themeCache.clear();

      // 同步触发所有主题相关事件，减少事件传播延迟
      const themeChangeEvent = new CustomEvent('theme-changed', {
        detail: { theme, actualTheme, previousTheme: currentTheme }
      });

      const terminalThemeEvent = new CustomEvent(EVENTS.TERMINAL_THEME_UPDATE, {
        detail: { uiTheme: actualTheme }
      });

      // 批量分发事件
      window.dispatchEvent(themeChangeEvent);
      window.dispatchEvent(terminalThemeEvent);

      // 使用适中的延迟移除切换状态类，与CSS过渡时间同步
      setTimeout(() => {
        documentElement.classList.remove('theme-switching');
      }, 500); // 与CSS过渡时间保持一致（0.5s = 500ms）

      log.debug('主题已应用', { theme, actualTheme, previousTheme: currentTheme, language });
    });
  }

  /**
   * 验证主题名称是否有效
   * @param {string} themeName - 主题名称
   * @returns {boolean} 是否有效
   */
  isValidTheme(themeName) {
    return VALID_THEMES.includes(themeName);
  }

  /**
   * 获取终端主题配置（公共方法）
   * @param {string} themeName - 主题名称
   * @returns {Object} 终端主题配置
   */
  getTerminalTheme(themeName = TERMINAL_THEMES.DARK) {
    // 验证主题名称
    if (!this.isValidTheme(themeName)) {
      log.warn(`无效的主题名称: ${themeName}，使用默认主题 '${TERMINAL_THEMES.DARK}'`);
      themeName = TERMINAL_THEMES.DARK;
    }
    return this._getTerminalTheme(themeName);
  }

  /**
   * 获取终端主题配置
   * @param {string} themeName - 主题名称 (light, dark, vscode, dracula, material, system)
   * @returns {Object} 终端主题配置
   * @private
   */
  _getTerminalTheme(themeName = TERMINAL_THEMES.DARK) {
    // 检查缓存
    if (this._themeCache.has(themeName)) {
      return this._themeCache.get(themeName);
    }
    const themes = {
      light: {
        foreground: '#000000',
        background: '#F5F5F5', // 使用与--color-bg-page相近的颜色作为默认值
        cursor: '#000000',
        selectionBackground: '#ACCEF7',
        black: '#000000',
        red: '#C91B00',
        green: '#00C200',
        yellow: '#C7C400',
        blue: '#0225C7',
        magenta: '#CA30C7',
        cyan: '#00C5C7',
        white: '#C7C7C7',
        brightBlack: '#686868',
        brightRed: '#FF6E67',
        brightGreen: '#5FF967',
        brightYellow: '#FEFB67',
        brightBlue: '#6871FF',
        brightMagenta: '#FF77FF',
        brightCyan: '#5FFDFF',
        brightWhite: '#FFFFFF'
      },
      dark: {
        foreground: '#F8F8F2',
        background: '#121212',
        cursor: '#F8F8F0',
        selectionBackground: '#49483E',
        black: '#272822',
        red: '#F92672',
        green: '#A6E22E',
        yellow: '#F4BF75',
        blue: '#66D9EF',
        magenta: '#AE81FF',
        cyan: '#A1EFE4',
        white: '#F8F8F2',
        brightBlack: '#75715E',
        brightRed: '#F92672',
        brightGreen: '#A6E22E',
        brightYellow: '#F4BF75',
        brightBlue: '#66D9EF',
        brightMagenta: '#AE81FF',
        brightCyan: '#A1EFE4',
        brightWhite: '#F9F8F5'
      },
      vscode: {
        foreground: '#CCCCCC',
        background: '#1E1E1E',
        cursor: '#FFFFFF',
        selectionBackground: '#264F78',
        black: '#000000',
        red: '#CD3131',
        green: '#0DBC79',
        yellow: '#E5E510',
        blue: '#2472C8',
        magenta: '#BC3FBC',
        cyan: '#11A8CD',
        white: '#E5E5E5',
        brightBlack: '#666666',
        brightRed: '#F14C4C',
        brightGreen: '#23D18B',
        brightYellow: '#F5F543',
        brightBlue: '#3B8EEA',
        brightMagenta: '#D670D6',
        brightCyan: '#29B8DB',
        brightWhite: '#FFFFFF'
      },
      dracula: {
        foreground: '#F8F8F2',
        background: '#282A36',
        cursor: '#F8F8F2',
        selectionBackground: '#44475A',
        black: '#21222C',
        red: '#FF5555',
        green: '#50FA7B',
        yellow: '#F1FA8C',
        blue: '#BD93F9',
        magenta: '#FF79C6',
        cyan: '#8BE9FD',
        white: '#F8F8F2',
        brightBlack: '#6272A4',
        brightRed: '#FF6E6E',
        brightGreen: '#69FF94',
        brightYellow: '#FFFFA5',
        brightBlue: '#D6ACFF',
        brightMagenta: '#FF92DF',
        brightCyan: '#A4FFFF',
        brightWhite: '#FFFFFF'
      },
      material: {
        foreground: '#EEFFFF',
        background: '#263238',
        cursor: '#FFCC02',
        selectionBackground: '#546E7A',
        black: '#000000',
        red: '#F07178',
        green: '#C3E88D',
        yellow: '#FFCB6B',
        blue: '#82AAFF',
        magenta: '#C792EA',
        cyan: '#89DDFF',
        white: '#FFFFFF',
        brightBlack: '#546E7A',
        brightRed: '#FF5370',
        brightGreen: '#C3E88D',
        brightYellow: '#FFD54F',
        brightBlue: '#729FCF',
        brightMagenta: '#AD7FA8',
        brightCyan: '#34E2E2',
        brightWhite: '#FFFFFF'
      }
    };

    // 处理系统主题
    let actualTheme = themeName;
    if (themeName === TERMINAL_THEMES.SYSTEM) {
      actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? TERMINAL_THEMES.DARK
        : TERMINAL_THEMES.LIGHT;
    }

    const themeConfig = themes[actualTheme] || themes[TERMINAL_THEMES.DARK];

    // 动态解析CSS变量，使终端主题与界面主题保持一致
    const resolvedTheme = { ...themeConfig };

    // 获取当前界面主题的CSS变量值
    const computedStyle = getComputedStyle(document.documentElement);
    const bgColor = computedStyle.getPropertyValue('--color-bg-page').trim();
    const textColor = computedStyle.getPropertyValue('--color-text-primary').trim();

    // 如果CSS变量有值，则使用界面主题的颜色
    if (textColor) {
      // 前景与光标使用主题前景色
      resolvedTheme.foreground = textColor;
      resolvedTheme.cursor = textColor;
    }

    // 始终使终端背景透明，完全依赖底层页面主题背景色渲染
    // 使用 rgba(0,0,0,0) 以确保 Canvas/WebGL 下的透明渲染稳定
    resolvedTheme.background = 'rgba(0, 0, 0, 0)';

    // 不缓存，确保每次都能获取到最新的CSS变量值
    return resolvedTheme;
  }

  /**
   * 导出设置
   * @returns {Object} 设置数据
   */
  exportSettings() {
    return {
      settings: { ...this.settings },
      timestamp: Date.now(),
      version: '1.0.0'
    };
  }

  /**
   * 导入设置
   * @param {Object} data - 设置数据
   */
  importSettings(data) {
    if (data.settings) {
      this._mergeSettings(this.settings, data.settings);
      this.applyTheme();
      log.info('设置导入成功');
    }
  }

  /**
   * 获取默认终端选项（当设置服务未初始化时使用）
   * @private
   * @returns {Object} 默认终端选项
   */
  _getDefaultTerminalOptions() {
    return {
      fontSize: 16,
      fontFamily: "'JetBrains Mono'",
      lineHeight: 1.2,
      theme: this._getTerminalTheme(TERMINAL_THEMES.DARK),
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 3000,
      allowTransparency: true,
      rendererType: 'auto', // 默认自动选择渲染器
      fallbackRenderer: 'dom', // 备用DOM渲染器
      convertEol: true,
      disableStdin: false,
      drawBoldTextInBrightColors: true,
      copyOnSelect: false,
      rightClickSelectsWord: false
    };
  }
}

// 创建服务实例
const settingsService = new SettingsService();

// 导出服务实例
export default settingsService;
