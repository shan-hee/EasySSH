/**
 * 辅助功能服务
 * 提供无障碍支持和用户体验增强
 */

import { EventEmitter } from './EventEmitter.js';
// Settings类已移除，使用统一的设置服务
import settingsService from '../../../src/services/settings';

// 对比度级别
export const ContrastLevel = {
  NORMAL: 'normal',
  HIGH: 'high',
  VERY_HIGH: 'very-high'
};

// 动效级别
export const AnimationLevel = {
  FULL: 'full',
  REDUCED: 'reduced',
  NONE: 'none'
};

// 焦点模式
export const FocusMode = {
  STANDARD: 'standard',
  ENHANCED: 'enhanced',
  HIGH_VISIBILITY: 'high-visibility'
};

// 字体大小级别
export const FontSizeLevel = {
  SMALL: 'small',    // 小字体
  MEDIUM: 'medium',  // 中等字体
  LARGE: 'large',    // 大字体
  EXTRA_LARGE: 'extra-large' // 超大字体
};

// 字体大小映射(根字体大小，px)
const FONT_SIZE_MAP = {
  [FontSizeLevel.SMALL]: 14,
  [FontSizeLevel.MEDIUM]: 16,
  [FontSizeLevel.LARGE]: 18,
  [FontSizeLevel.EXTRA_LARGE]: 20
};

// 默认配置
const DEFAULT_CONFIG = {
  // 字体大小级别
  fontSize: FontSizeLevel.MEDIUM,

  // 高对比度模式
  highContrast: false,

  // 对比度级别
  contrastLevel: ContrastLevel.NORMAL,

  // 减少动效
  reduceMotion: false,

  // 动效级别
  animationLevel: AnimationLevel.FULL,

  // 屏幕阅读器友好模式
  screenReaderFriendly: false,

  // 键盘导航增强
  enhancedKeyboardNavigation: true,

  // 焦点可见性
  focusMode: FocusMode.STANDARD,

  // 焦点边框宽度(px)
  focusBorderWidth: 2,

  // 自动阅读标题
  autoAnnounceTitle: true,

  // 表单标签位置
  formLabelsPosition: 'top',

  // 禁用悬停效果
  disableHoverEffects: false,

  // 简化界面
  simplifiedInterface: false
};

/**
 * 辅助功能服务类
 */
export class AccessibilityService extends EventEmitter {
  /**
   * 构造函数
   */
  constructor() {
    super();

    // 当前配置
    this.config = { ...DEFAULT_CONFIG };

    // 设置服务
    this.settings = settingsService;

    // 从设置加载配置
    this._loadFromSettings();

    // 监听设置变化
    this.settings.addChangeListener(this._loadFromSettings.bind(this));

    // 系统偏好检测
    this._detectSystemPreferences();

    // LiveRegion用于屏幕阅读器通知
    this._initLiveRegion();

    // 应用初始配置
    this._applyConfig();
  }

  /**
   * 从设置加载配置
   * @private
   */
  _loadFromSettings() {
    const accessibilitySettings = this.settings.get('advanced.accessibility', {});

    // 合并设置到当前配置
    const newConfig = { ...this.config, ...accessibilitySettings };

    // 检查是否有变化
    const hasChanges = JSON.stringify(this.config) !== JSON.stringify(newConfig);

    if (hasChanges) {
      const oldConfig = { ...this.config };
      this.config = newConfig;

      // 应用新配置
      this._applyConfig();

      // 触发配置变更事件
      this.emit('config:change', this.config, oldConfig);
    }
  }

  /**
   * 检测系统辅助功能偏好
   * @private
   */
  _detectSystemPreferences() {
    // 检测减少动效偏好
    if (window.matchMedia) {
      const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

      if (motionQuery.matches) {
        this.config.reduceMotion = true;
        this.config.animationLevel = AnimationLevel.REDUCED;
      }

      // 监听变化
      try {
        motionQuery.addEventListener('change', e => {
          const reduceMotion = e.matches;
          this.setReduceMotion(reduceMotion);
        });
      } catch (err) {
        // 兼容旧版API
        motionQuery.addListener(e => {
          const reduceMotion = e.matches;
          this.setReduceMotion(reduceMotion);
        });
      }

      // 检测高对比度偏好
      const contrastQuery = window.matchMedia('(prefers-contrast: more)');

      if (contrastQuery.matches) {
        this.config.highContrast = true;
        this.config.contrastLevel = ContrastLevel.HIGH;
      }

      // 监听变化
      try {
        contrastQuery.addEventListener('change', e => {
          const highContrast = e.matches;
          this.setHighContrast(highContrast);
        });
      } catch (err) {
        // 兼容旧版API
        contrastQuery.addListener(e => {
          const highContrast = e.matches;
          this.setHighContrast(highContrast);
        });
      }
    }
  }

  /**
   * 初始化LiveRegion
   * @private
   */
  _initLiveRegion() {
    // 创建LiveRegion元素用于屏幕阅读器通知
    this.liveRegion = document.getElementById('a11y-live-region');

    if (!this.liveRegion) {
      this.liveRegion = document.createElement('div');
      this.liveRegion.id = 'a11y-live-region';
      this.liveRegion.className = 'sr-only';
      this.liveRegion.setAttribute('aria-live', 'polite');
      this.liveRegion.setAttribute('aria-atomic', 'true');
      document.body.appendChild(this.liveRegion);
    }

    // 创建警报区域
    this.alertRegion = document.getElementById('a11y-alert-region');

    if (!this.alertRegion) {
      this.alertRegion = document.createElement('div');
      this.alertRegion.id = 'a11y-alert-region';
      this.alertRegion.className = 'sr-only';
      this.alertRegion.setAttribute('aria-live', 'assertive');
      this.alertRegion.setAttribute('role', 'alert');
      this.alertRegion.setAttribute('aria-atomic', 'true');
      document.body.appendChild(this.alertRegion);
    }
  }

  /**
   * 应用配置到DOM
   * @private
   */
  _applyConfig() {
    const { documentElement } = document;

    // 设置根字体大小
    const fontSize = FONT_SIZE_MAP[this.config.fontSize] || FONT_SIZE_MAP.MEDIUM;
    documentElement.style.setProperty('--root-font-size', `${fontSize}px`);

    // 设置高对比度
    documentElement.classList.toggle('high-contrast', this.config.highContrast);
    documentElement.setAttribute('data-contrast', this.config.contrastLevel);

    // 设置动效级别
    documentElement.classList.toggle('reduce-motion', this.config.reduceMotion);
    documentElement.setAttribute('data-motion', this.config.animationLevel);

    // 设置焦点可见性
    documentElement.setAttribute('data-focus-mode', this.config.focusMode);
    documentElement.style.setProperty('--focus-border-width', `${this.config.focusBorderWidth}px`);

    // 设置屏幕阅读器友好模式
    documentElement.classList.toggle('sr-friendly', this.config.screenReaderFriendly);

    // 设置表单标签位置
    documentElement.setAttribute('data-form-labels', this.config.formLabelsPosition);

    // 设置简化界面
    documentElement.classList.toggle('simplified-ui', this.config.simplifiedInterface);

    // 设置禁用悬停效果
    documentElement.classList.toggle('no-hover', this.config.disableHoverEffects);
  }

  /**
   * 保存配置到设置
   * @private
   */
  _saveConfig() {
    this.settings.set('advanced.accessibility', { ...this.config });
  }

  /**
   * 更新配置
   * @param {Object} newConfig 新配置
   */
  updateConfig(newConfig) {
    const oldConfig = { ...this.config };

    // 合并配置
    this.config = { ...this.config, ...newConfig };

    // 应用新配置
    this._applyConfig();

    // 保存到设置
    this._saveConfig();

    // 触发事件
    this.emit('config:change', this.config, oldConfig);
  }

  /**
   * 设置字体大小
   * @param {string} sizeLevel 字体大小级别
   */
  setFontSize(sizeLevel) {
    if (!Object.values(FontSizeLevel).includes(sizeLevel)) {
      throw new Error(`无效的字体大小级别: ${sizeLevel}`);
    }

    this.updateConfig({ fontSize: sizeLevel });
    this.announce(`字体大小已更改为${this._getFontSizeText(sizeLevel)}`);
  }

  /**
   * 获取字体大小描述文本
   * @param {string} sizeLevel 字体大小级别
   * @returns {string} 描述文本
   * @private
   */
  _getFontSizeText(sizeLevel) {
    switch (sizeLevel) {
    case FontSizeLevel.SMALL: return '小号';
    case FontSizeLevel.MEDIUM: return '中号';
    case FontSizeLevel.LARGE: return '大号';
    case FontSizeLevel.EXTRA_LARGE: return '超大号';
    default: return '中号';
    }
  }

  /**
   * 增加字体大小
   */
  increaseFontSize() {
    const currentIndex = Object.values(FontSizeLevel).indexOf(this.config.fontSize);
    const levels = Object.values(FontSizeLevel);

    if (currentIndex < levels.length - 1) {
      this.setFontSize(levels[currentIndex + 1]);
    }
  }

  /**
   * 减小字体大小
   */
  decreaseFontSize() {
    const currentIndex = Object.values(FontSizeLevel).indexOf(this.config.fontSize);
    const levels = Object.values(FontSizeLevel);

    if (currentIndex > 0) {
      this.setFontSize(levels[currentIndex - 1]);
    }
  }

  /**
   * 设置高对比度模式
   * @param {boolean} enabled 是否启用
   * @param {string} [level] 对比度级别
   */
  setHighContrast(enabled, level = ContrastLevel.HIGH) {
    if (enabled && !Object.values(ContrastLevel).includes(level)) {
      level = ContrastLevel.HIGH;
    }

    this.updateConfig({
      highContrast: enabled,
      contrastLevel: enabled ? level : ContrastLevel.NORMAL
    });

    this.announce(`高对比度模式已${enabled ? '启用' : '禁用'}`);
  }

  /**
   * 设置减少动效
   * @param {boolean} enabled 是否启用
   * @param {string} [level] 动效级别
   */
  setReduceMotion(enabled, level = AnimationLevel.REDUCED) {
    if (enabled && !Object.values(AnimationLevel).includes(level)) {
      level = AnimationLevel.REDUCED;
    }

    this.updateConfig({
      reduceMotion: enabled,
      animationLevel: enabled ? level : AnimationLevel.FULL
    });

    this.announce(`动画效果已${enabled ? '减少' : '恢复正常'}`);
  }

  /**
   * 设置焦点模式
   * @param {string} mode 焦点模式
   */
  setFocusMode(mode) {
    if (!Object.values(FocusMode).includes(mode)) {
      throw new Error(`无效的焦点模式: ${mode}`);
    }

    this.updateConfig({ focusMode: mode });
  }

  /**
   * 设置屏幕阅读器友好模式
   * @param {boolean} enabled 是否启用
   */
  setScreenReaderFriendly(enabled) {
    this.updateConfig({ screenReaderFriendly: enabled });

    if (enabled) {
      this.announce('屏幕阅读器友好模式已启用');
    }
  }

  /**
   * 设置简化界面模式
   * @param {boolean} enabled 是否启用
   */
  setSimplifiedInterface(enabled) {
    this.updateConfig({ simplifiedInterface: enabled });
    this.announce(`简化界面模式已${enabled ? '启用' : '禁用'}`);
  }

  /**
   * 通过LiveRegion进行屏幕阅读器通知
   * @param {string} message 消息内容
   * @param {Object} options 选项
   */
  announce(message, options = {}) {
    const { assertive = false, clear = true } = options;

    const region = assertive ? this.alertRegion : this.liveRegion;

    if (clear) {
      region.textContent = '';

      // 强制浏览器重绘
      void region.offsetWidth;
    }

    region.textContent = message;
  }

  /**
   * 使用AlertRegion进行屏幕阅读器警告
   * @param {string} message 消息内容
   */
  alert(message) {
    this.announce(message, { assertive: true });
  }

  /**
   * 设置页面标题并通知屏幕阅读器
   * @param {string} title 标题内容
   * @param {boolean} announce 是否通知
   */
  setPageTitle(title, announce = true) {
    document.title = title;

    if (announce && this.config.autoAnnounceTitle) {
      this.announce(`页面: ${title}`);
    }
  }

  /**
   * 为元素添加可访问性标签
   * @param {HTMLElement} element 目标元素
   * @param {Object} attributes 属性集合
   */
  addA11yAttributes(element, attributes) {
    if (!element) return;

    Object.entries(attributes).forEach(([key, value]) => {
      if (value === null || value === false) {
        element.removeAttribute(key);
      } else if (value === true) {
        element.setAttribute(key, '');
      } else {
        element.setAttribute(key, value);
      }
    });
  }

  /**
   * 创建可访问的HTML元素
   * @param {string} tagName 标签名
   * @param {Object} attributes 属性集合
   * @param {string|Array} [children] 子内容
   * @returns {HTMLElement} HTML元素
   */
  createA11yElement(tagName, attributes = {}, children = null) {
    const element = document.createElement(tagName);

    this.addA11yAttributes(element, attributes);

    if (children) {
      if (Array.isArray(children)) {
        children.forEach(child => {
          if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
          } else if (child instanceof Node) {
            element.appendChild(child);
          }
        });
      } else if (typeof children === 'string') {
        element.textContent = children;
      }
    }

    return element;
  }

  /**
   * 将键盘事件转换为可访问的动作
   * @param {Event} event 键盘事件
   * @returns {string|null} 动作名称
   */
  getA11yAction(event) {
    if (!event || !event.key) return null;

    // 基础键映射
    const keyMap = {
      'Enter': 'activate',
      ' ': 'activate',
      'Escape': 'dismiss',
      'Tab': event.shiftKey ? 'previousFocus' : 'nextFocus',
      'ArrowUp': 'up',
      'ArrowDown': 'down',
      'ArrowLeft': 'left',
      'ArrowRight': 'right',
      'Home': 'first',
      'End': 'last',
      'PageUp': 'pageUp',
      'PageDown': 'pageDown'
    };

    return keyMap[event.key] || null;
  }

  /**
   * 捕获键盘事件并处理常见的可访问性动作
   * @param {Event} event 键盘事件
   * @param {Object} handlers 处理函数映射
   * @returns {boolean} 是否已处理
   */
  handleA11yKeyEvent(event, handlers) {
    const action = this.getA11yAction(event);

    if (action && handlers[action]) {
      handlers[action](event);
      event.preventDefault();
      return true;
    }

    return false;
  }

  /**
   * 创建或更新可访问的菜单/列表导航
   * @param {HTMLElement} container 容器元素
   * @param {Object} options 导航选项
   * @returns {Object} 导航控制器
   */
  createA11yNavigation(container, options = {}) {
    if (!container) {
      throw new Error('必须提供容器元素');
    }

    const {
      role = 'menu',
      orientation = 'vertical',
      loop = true,
      typeAhead = true,
      items = null,
      onActivate = null,
      onNavigate = null
    } = options;

    let currentIndex = -1;
    let itemElements = [];

    // 设置容器属性
    this.addA11yAttributes(container, {
      role,
      'aria-orientation': orientation,
      'tabindex': '0'
    });

    // 查找项目元素
    const getItems = () => {
      if (typeof items === 'function') {
        return items();
      } else if (Array.isArray(items)) {
        return items;
      } else {
        return Array.from(container.querySelectorAll('[role="menuitem"], [role="option"], li, button, a'));
      }
    };

    // 更新项目状态
    const updateItems = () => {
      itemElements = getItems();

      itemElements.forEach((item, index) => {
        this.addA11yAttributes(item, {
          'tabindex': index === currentIndex ? '0' : '-1',
          'aria-selected': role.includes('list') ? index === currentIndex : null
        });
      });
    };

    // 设置当前项目
    const setCurrentItem = (index, userInitiated = true) => {
      if (index < 0 || index >= itemElements.length) {
        if (loop) {
          index = (index < 0) ? itemElements.length - 1 : 0;
        } else {
          return;
        }
      }

      const previousIndex = currentIndex;
      currentIndex = index;

      // 更新tabindex
      if (previousIndex >= 0 && previousIndex < itemElements.length) {
        itemElements[previousIndex].setAttribute('tabindex', '-1');
        if (role.includes('list')) {
          itemElements[previousIndex].setAttribute('aria-selected', 'false');
        }
      }

      const currentItem = itemElements[currentIndex];
      currentItem.setAttribute('tabindex', '0');
      if (role.includes('list')) {
        currentItem.setAttribute('aria-selected', 'true');
      }

      // 聚焦到当前项目
      if (userInitiated) {
        currentItem.focus();
      }

      // 调用导航回调
      if (onNavigate && typeof onNavigate === 'function') {
        onNavigate(currentIndex, currentItem);
      }
    };

    // 键盘事件处理
    const handleKeyDown = (event) => {
      const horizontal = orientation === 'horizontal';

      // 基础导航
      const handlers = {
        up: () => horizontal ? null : setCurrentItem(currentIndex - 1),
        down: () => horizontal ? null : setCurrentItem(currentIndex + 1),
        left: () => horizontal ? setCurrentItem(currentIndex - 1) : null,
        right: () => horizontal ? setCurrentItem(currentIndex + 1) : null,
        first: () => setCurrentItem(0),
        last: () => setCurrentItem(itemElements.length - 1),
        activate: () => {
          if (currentIndex >= 0 && onActivate && typeof onActivate === 'function') {
            onActivate(currentIndex, itemElements[currentIndex]);
          }
        }
      };

      this.handleA11yKeyEvent(event, handlers);

      // 类型预览
      if (typeAhead && event.key.length === 1) {
        const searchChar = event.key.toLowerCase();
        const startIndex = (currentIndex + 1) % itemElements.length;

        // 查找以该字符开头的项目
        for (let i = 0; i < itemElements.length; i++) {
          const index = (startIndex + i) % itemElements.length;
          const text = itemElements[index].textContent.trim().toLowerCase();

          if (text.startsWith(searchChar)) {
            setCurrentItem(index);
            event.preventDefault();
            break;
          }
        }
      }
    };

    // 初始化
    const init = () => {
      updateItems();

      // 设置初始索引
      if (currentIndex < 0 && itemElements.length > 0) {
        // 查找已设置tabindex=0的项
        const activeIndex = itemElements.findIndex(item =>
          item.getAttribute('tabindex') === '0' ||
          item.getAttribute('aria-selected') === 'true'
        );

        setCurrentItem(activeIndex >= 0 ? activeIndex : 0, false);
      }

      // 绑定事件
      container.addEventListener('keydown', handleKeyDown);
    };

    init();

    // 返回控制器
    return {
      refresh: () => {
        updateItems();
        return currentIndex;
      },
      getItems,
      getCurrentIndex: () => currentIndex,
      setCurrentItem,
      destroy: () => {
        container.removeEventListener('keydown', handleKeyDown);
      }
    };
  }

  /**
   * 单例实例
   */
  static instance = null;

  /**
   * 获取服务实例
   * @returns {AccessibilityService} 辅助功能服务实例
   */
  static getInstance() {
    if (!AccessibilityService.instance) {
      AccessibilityService.instance = new AccessibilityService();
    }
    return AccessibilityService.instance;
  }
}

// 导出默认实例
export default AccessibilityService.getInstance();
