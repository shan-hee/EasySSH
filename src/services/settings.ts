/**
 * 统一设置服务模块
 * 整合了原有的多个设置管理，提供统一的设置接口
 */
import { reactive, watch } from 'vue';
import { userSettingsDefaults } from '../config/app-config';
import storageUtils from '../utils/storage';
import log from './log';
import { useUserStore } from '@/store/user';
import storageAdapter from './storage-adapter';
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
  public isInitialized: boolean;
  public hasServerSettings: boolean;
  private _loading: Promise<boolean> | null;
  public settings: any;
  public storage: ReturnType<typeof storageUtils.createPrefixedStorage>;
  private changeListeners: Set<(s: any) => void>;
  private _themeCache: Map<string, any>;
  private _dirtyCategories: Set<string>;
  private _autoSavePaused: boolean;
  private _sensitiveCategories: Set<string>;
  private _sensitiveFields: Set<string>;
  private _authListenersSetup: boolean;
  private _bgListenersSetup: boolean;
  private _terminalBackground: any;
  private loadedCategories?: Set<string>;
  private _lastLoggedTheme?: string;
  private _systemThemeListener?: { mediaQuery: MediaQueryList; handler: (e: MediaQueryListEvent | MediaQueryList) => void };

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
  async init(force: boolean = false): Promise<boolean> {
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
  _setupBackgroundListeners(): void {
    if (this._bgListenersSetup) return;
    try {
      const updateBg = (e: any) => {
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
      window.addEventListener('storage-mode-changed', async (e: any) => {
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
  async loadSettings(): Promise<void> {
    try {
      // 确保存储适配器已就绪（避免在未初始化时误判登录态）
      try {
        if (!(storageAdapter as any).initialized && typeof (storageAdapter as any).init === 'function') {
          await (storageAdapter as any).init();
        }
      } catch (_) {
        // 初始化失败不阻塞后续逻辑，按原有回退策略处理
      }

      // 检查是否已登录，如果已登录则从服务器加载设置
      const userStore = useUserStore();

      if (userStore.isLoggedIn) {
        // 登录状态：使用最小化接口，避免多拿数据
        try {
          const resp: any = await apiService.get<any>(
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
                  this.loadedCategories!.add('terminal.background');
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
              this.loadedCategories!.add('terminal');
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
            let serverSettings: Record<string, any> = {};
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
                Object.keys(serverSettings).forEach(c => this.loadedCategories!.add(c));
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
      let settingsToMerge: Record<string, any> = {};
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
  async initLocalOnly(): Promise<boolean> {
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
  getSnapshot(categories: string[] | null = null) {
    if (!categories || categories.length === 0) {
      return { ...this.settings };
    }
    const out: Record<string, any> = {};
    categories.forEach((c: string) => {
      if (this.settings[c] !== undefined) out[c] = { ...this.settings[c] };
    });
    return out;
  }

  /** 获取已加载的终端背景（若有） */
  getTerminalBackground(): any {
    try {
      return this._terminalBackground ? { ...this._terminalBackground } : null;
    } catch (_) {
      return null;
    }
  }

  /** 将当前设置应用到提供的目标对象（按分类） */
  applyToTargets(targets: Record<string, any> = {}): void {
    if (!targets || typeof targets !== 'object') return;
    const applyOne = (cat: string, obj: any) => {
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
  isCategoryLoaded(category: string): boolean {
    return !!this.loadedCategories && this.loadedCategories.has(category);
  }

  /**
   * 保存设置到存储
   * @private
   */
  async saveSettings(): Promise<void> {
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
            const savePromises = categoriesToSave.map(async (category: string) => {
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
  _mergeSettings(target: any, source: any): void {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
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
  _setupAutoSave(): void {
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
  _notifyListeners(): void {
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
  get(path: string, defaultValue: any = undefined): any {
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
  set(path: string, value: any): void {
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
  _sanitizeForLogging(settings: any) {
    const cloneDeep = (obj: any): any => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(cloneDeep);
      const out: Record<string, any> = {};
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
  async saveCategory(category: string): Promise<boolean> {
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
  reset(path: string | null = null): void {
    if (path) {
      // 重置指定路径
      const keys = path.split('.');
      let defaultValue: any = userSettingsDefaults;

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
  addChangeListener(listener: (s: any) => void): void {
    this.changeListeners.add(listener);
  }

  /**
   * 移除设置变更监听器
   * @param {Function} listener - 监听器函数
   */
  removeChangeListener(listener: (s: any) => void): void {
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
  updateTerminalSettings(updates: Record<string, any>, applyToTerminals: boolean = false): void {
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
  async _applyTerminalSettingsToAllTerminals(): Promise<void> {
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
  updateConnectionSettings(updates: Record<string, any>): void {
    Object.assign(this.settings.connection, updates);
    this._dirtyCategories.add('connection');
  }

  /**
   * 更新监控设置
   * @param {Object} updates - 要更新的设置
   */
  updateMonitoringSettings(updates: Record<string, any>): void {
    Object.assign(this.settings.monitoring, updates);
    this._dirtyCategories.add('monitoring');
  }

  /**
   * 更新UI设置
   * @param {Object} updates - 要更新的设置
   */
  updateUISettings(updates: Record<string, any>): void {
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
  _resolveActualTheme(theme: string): string {
    if (theme === 'system') {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme === 'dark' ? 'dark' : 'light'; // 确保只返回有效值
  }

  /**
   * 设置系统主题变化监听器
   * @private
   */
  _setupSystemThemeListener(): void {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleSystemThemeChange = (e: any) => {
      const newTheme = e.matches ? 'dark' : 'light';
      // 当 UI 选择了“跟随系统”时，更新 UI 主题
      if (this.settings.ui.theme === 'system') {
        log.debug('系统主题变化，自动切换UI主题', { newTheme });
        this.applyTheme('system');
      }

      // 当终端主题选择了 system 时，根据 UI 是否也为 system 决定事件来源：
      // - UI=system: 由 applyTheme('system') 内统一分发 TERMINAL_THEME_UPDATE（避免重复）
      // - UI≠system: 仅此处分发一次 TERMINAL_THEME_UPDATE
      if (this.settings.terminal?.theme === 'system' && this.settings.ui.theme !== 'system') {
        try {
          window.dispatchEvent(
            new CustomEvent(EVENTS.TERMINAL_THEME_UPDATE, { detail: { uiTheme: newTheme } })
          );
        } catch (_) {}
      }
    };

    // 监听系统主题变化（兼容旧浏览器）
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleSystemThemeChange);
    }

    // 保存监听器引用，用于清理
    this._systemThemeListener = {
      mediaQuery,
      handler: handleSystemThemeChange
    };

    // 立即执行一次，确保在设置“终端主题=system”后立刻与系统一致
    try {
      handleSystemThemeChange(mediaQuery);
    } catch (_) {}
  }

  /**
   * 应用主题
   * @param {string} theme - 主题名称 (light, dark, system)
   * @param {Object} options - 选项
   * @param {boolean} options.skipIfSame - 如果主题相同则跳过所有操作
   */
  applyTheme(theme: string = this.settings.ui.theme, options: { skipIfSame?: boolean } = {}): void {
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
  isValidTheme(themeName: string): boolean {
    return VALID_THEMES.includes(themeName);
  }

  /**
   * 获取终端主题配置（公共方法）
   * @param {string} themeName - 主题名称
   * @returns {Object} 终端主题配置
   */
  getTerminalTheme(themeName: string = TERMINAL_THEMES.DARK) {
    // 验证主题名称
    if (!this.isValidTheme(themeName)) {
      log.warn(`无效的主题名称: ${themeName}，使用默认主题 '${TERMINAL_THEMES.DARK}'`);
      themeName = TERMINAL_THEMES.DARK;
    }
    return this._getTerminalTheme(themeName);
  }

  /**
   * 解析当前“终端主题”的有效主题（考虑 system 与 UI 主题）
   * @param {('light'|'dark')=} uiTheme 可选，传入当前UI主题可避免读取DOM
   * @returns {string} 终端实际主题名（light|dark|dracula|vscode|material）
   */
  getEffectiveTerminalThemeForUi(uiTheme = null) {
    try {
      const t = this.settings?.terminal?.theme;
      if (!t || t === TERMINAL_THEMES.DARK || t === TERMINAL_THEMES.LIGHT) return t || TERMINAL_THEMES.DARK;
      if (t === TERMINAL_THEMES.SYSTEM) {
        const ui = uiTheme || document?.documentElement?.getAttribute?.('data-theme');
        if (ui === TERMINAL_THEMES.LIGHT || ui === TERMINAL_THEMES.DARK) return ui;
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches
          ? TERMINAL_THEMES.DARK
          : TERMINAL_THEMES.LIGHT;
      }
      // 自定义主题
      return t;
    } catch (_) {
      return TERMINAL_THEMES.DARK;
    }
  }

  /**
   * 解析当前“终端主题”的有效主题，不依赖外部参数
   */
  getEffectiveTerminalTheme() {
    return this.getEffectiveTerminalThemeForUi();
  }

  /**
   * 获取终端主题配置
   * @param {string} themeName - 主题名称 (light, dark, vscode, dracula, material, system)
   * @returns {Object} 终端主题配置
   * @private
   */
  _getTerminalTheme(themeName: string = TERMINAL_THEMES.DARK) {
    // 不使用缓存，确保能响应UI变量与背景状态的实时变化
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

    // 处理系统主题：优先读取UI已应用的 data-theme，其次回退到系统偏好
    let actualTheme = themeName;
    if (themeName === TERMINAL_THEMES.SYSTEM) {
      const applied = document?.documentElement?.getAttribute?.('data-theme');
      if (applied === TERMINAL_THEMES.DARK || applied === TERMINAL_THEMES.LIGHT) {
        actualTheme = applied;
      } else {
        actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
          ? TERMINAL_THEMES.DARK
          : TERMINAL_THEMES.LIGHT;
      }
    }

    const themeConfig = (themes as any)[actualTheme] || (themes as any)[TERMINAL_THEMES.DARK];

    const resolvedTheme = { ...themeConfig };

    // 获取当前界面主题的CSS变量值
    const computedStyle = getComputedStyle(document.documentElement);
    const uiTextColor = computedStyle.getPropertyValue('--color-text-primary').trim();
    const uiSecondaryColor = computedStyle.getPropertyValue('--color-text-secondary').trim();
    const fbTextOnLight = computedStyle.getPropertyValue('--fallback-text-on-light').trim() || '#303133';
    const fbTextOnDark = computedStyle.getPropertyValue('--fallback-text-on-dark').trim() || '#e5e5e5';
    const fbSecOnLight =
      computedStyle.getPropertyValue('--fallback-text-secondary-on-light').trim() || '#606266';
    const fbSecOnDark =
      computedStyle.getPropertyValue('--fallback-text-secondary-on-dark').trim() || '#b0b0b0';

    // 背景图片启用时：使用 UI 文本色以与整体界面统一；
    // 未启用背景图片时：使用所选终端主题自带的前景/光标色，确保与“主题颜色背景图”形成正确对比。
    const bgEnabled = !!(this._terminalBackground && this._terminalBackground.enabled);
    if (bgEnabled) {
      const fb = actualTheme === 'dark' ? fbTextOnDark : fbTextOnLight;
      const applied = uiTextColor || fb;
      resolvedTheme.foreground = applied;
      resolvedTheme.cursor = applied;
    } else {
      const fb = actualTheme === 'dark' ? fbTextOnDark : fbTextOnLight;
      resolvedTheme.foreground = themeConfig.foreground || resolvedTheme.foreground || fb;
      resolvedTheme.cursor = themeConfig.cursor || resolvedTheme.cursor || fb;
    }

    // 始终使用透明背景，使终端区域与背景图片/页面底色一致
    resolvedTheme.background = 'rgba(0, 0, 0, 0)';

    // 为“颜色图片”背景准备一个基于主题背景色的渐变，作为无背景图时的回退
    try {
      const surfaceColor = themeConfig?.background || '#121212';
      const themeBgImage = `linear-gradient(0deg, ${surfaceColor}, ${surfaceColor})`;
      document.documentElement.style.setProperty('--terminal-theme-bg-image', themeBgImage);
      // 无背景图时，将不透明度设为 1，确保主题切换可见；有背景图时恢复默认
      if (!bgEnabled) {
        document.documentElement.style.setProperty('--terminal-bg-opacity', '1');
      } else {
        try { document.documentElement.style.removeProperty('--terminal-bg-opacity'); } catch (_) {}
      }
      // 宣告当前终端表面模式（供图表/监控读取）
      const uiMode = document.documentElement.getAttribute('data-theme') || 'dark';
      const surfaceMode = bgEnabled ? uiMode : actualTheme; // 背景图启用时随UI，其余随终端主题
      document.documentElement.style.setProperty('--terminal-surface-mode', surfaceMode);
      // 设置终端区域文字/边框颜色（供监控面板等复用）
      const chosenTextColor = bgEnabled
        ? (uiTextColor || (actualTheme === 'dark' ? fbTextOnDark : fbTextOnLight))
        : (themeConfig.foreground || resolvedTheme.foreground || (actualTheme === 'dark' ? fbTextOnDark : fbTextOnLight));
      const chosenSecondaryColor = bgEnabled
        ? (uiSecondaryColor || (actualTheme === 'dark' ? fbSecOnDark : fbSecOnLight))
        : (actualTheme === 'light' ? fbSecOnLight : fbSecOnDark);
      const chosenBorderColor = actualTheme === 'light' ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)';
      document.documentElement.style.setProperty('--terminal-surface-text-color', chosenTextColor);
      document.documentElement.style.setProperty('--terminal-surface-text-secondary', chosenSecondaryColor);
      document.documentElement.style.setProperty('--terminal-surface-border-color', chosenBorderColor);
    } catch (_) {
      // 忽略DOM环境缺失或无效颜色
    }

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
  importSettings(data: any): void {
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
