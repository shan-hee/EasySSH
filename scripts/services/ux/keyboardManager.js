/**
 * 键盘快捷键管理服务
 * 提供全局快捷键、组合键和手势的管理
 */

import { EventEmitter } from './EventEmitter.js';
// Settings类已移除，使用统一的设置服务
import settingsService from '../../../src/services/settings.js';
import accessibilityService from './accessibility.js';

// 修饰键常量
export const ModifierKeys = {
  ALT: 'Alt',
  CTRL: 'Control',
  SHIFT: 'Shift',
  META: 'Meta' // Windows键/Command键
};

// 特殊键常量
export const SpecialKeys = {
  ESCAPE: 'Escape',
  ENTER: 'Enter',
  SPACE: ' ',
  BACKSPACE: 'Backspace',
  DELETE: 'Delete',
  TAB: 'Tab',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  HOME: 'Home',
  END: 'End',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown',
  PLUS: '+',
  MINUS: '-'
};

// 快捷键作用域
export const KeyScope = {
  GLOBAL: 'global',      // 全局范围
  APP: 'app',            // 应用范围
  EDITOR: 'editor',      // 编辑器范围
  TERMINAL: 'terminal',  // 终端范围
  DIALOG: 'dialog',      // 对话框范围
  CONTEXTMENU: 'contextmenu', // 上下文菜单范围
  MODAL: 'modal'         // 模态窗口范围
};

/**
 * 键盘快捷键管理服务
 */
export class KeyboardManager extends EventEmitter {
  /**
   * 构造函数
   */
  constructor() {
    super();
    
    // 快捷键映射 - 格式: { [scope]: { [keyCombo]: { action, handler, description } } }
    this.shortcuts = {};
    
    // 当前活动的作用域栈 (后进先出)
    this.scopeStack = [KeyScope.GLOBAL];
    
    // 当前按下的修饰键
    this.activeModifiers = new Set();
    
    // 最近按下的键序列及时间戳
    this.keySequence = [];
    this.keySequenceTimeout = 1000; // 键序列超时时间(毫秒)
    this.keySequenceTimer = null;
    
    // 设置
    this.settings = settingsService;
    
    // 默认快捷键定义
    this.defaultShortcuts = {};
    
    // 自定义快捷键配置
    this.customShortcuts = {};
    
    // 注册事件处理器
    this._registerEventHandlers();
    
    // 从设置加载自定义快捷键
    this._loadFromSettings();
    
    // 初始化默认快捷键
    this._initDefaultShortcuts();
  }
  
  /**
   * 注册全局事件处理器
   * @private
   */
  _registerEventHandlers() {
    // 处理键盘按下事件
    document.addEventListener('keydown', this._handleKeyDown.bind(this));
    
    // 处理键盘释放事件
    document.addEventListener('keyup', this._handleKeyUp.bind(this));
    
    // 处理页面失焦事件 - 清除所有修饰键状态
    window.addEventListener('blur', () => {
      this.activeModifiers.clear();
    });
    
    // 监听设置变更
    this.settings.addChangeListener(this._loadFromSettings.bind(this));
  }
  
  /**
   * 从设置加载自定义快捷键
   * @private
   */
  _loadFromSettings() {
    this.customShortcuts = this.settings.get('advanced.keyboard.shortcuts', {});

    // 重新注册所有快捷键
    this._applyShortcuts();
  }
  
  /**
   * 初始化默认快捷键
   * @private
   */
  _initDefaultShortcuts() {
    // 全局快捷键
    this.registerShortcut({
      scope: KeyScope.GLOBAL,
      key: `${ModifierKeys.CTRL}+,`,
      action: 'settings.open',
      description: '打开设置',
      handler: () => this.emit('action', 'settings.open')
    });
    
    // 终端范围的快捷键
    this.registerShortcut({
      scope: KeyScope.TERMINAL,
      key: `${ModifierKeys.CTRL}+${ModifierKeys.SHIFT}+c`,
      action: 'terminal.copy',
      description: '复制',
      handler: () => this.emit('action', 'terminal.copy')
    });
    
    this.registerShortcut({
      scope: KeyScope.TERMINAL,
      key: `${ModifierKeys.CTRL}+${ModifierKeys.SHIFT}+v`,
      action: 'terminal.paste',
      description: '粘贴',
      handler: () => this.emit('action', 'terminal.paste')
    });
    
    // 添加清空终端快捷键
    this.registerShortcut({
      scope: KeyScope.TERMINAL,
      key: `${ModifierKeys.CTRL}+l`,
      action: 'terminal.clear',
      description: '清空终端',
      handler: () => this.emit('action', 'terminal.clear')
    });
    
    // 辅助功能相关快捷键
    this.registerShortcut({
      scope: KeyScope.GLOBAL,
      key: `${ModifierKeys.CTRL}+${ModifierKeys.ALT}+=`,
      action: 'accessibility.increaseFontSize',
      description: '增加字体大小',
      handler: () => accessibilityService.increaseFontSize()
    });
    
    this.registerShortcut({
      scope: KeyScope.GLOBAL,
      key: `${ModifierKeys.CTRL}+${ModifierKeys.ALT}+-`,
      action: 'accessibility.decreaseFontSize',
      description: '减小字体大小',
      handler: () => accessibilityService.decreaseFontSize()
    });
  }
  
  /**
   * 应用所有快捷键
   * @private
   */
  _applyShortcuts() {
    // 清除所有现有快捷键
    this.shortcuts = {};
    
    // 先应用默认快捷键
    Object.entries(this.defaultShortcuts).forEach(([action, shortcut]) => {
      this.registerShortcut(shortcut);
    });
    
    // 再应用自定义快捷键覆盖
    Object.entries(this.customShortcuts).forEach(([action, keyCombo]) => {
      const defaultShortcut = this.defaultShortcuts[action];
      if (defaultShortcut) {
        this.registerShortcut({
          ...defaultShortcut,
          key: keyCombo
        });
      }
    });
  }
  
  /**
   * 处理键盘按下事件
   * @param {KeyboardEvent} event 键盘事件
   * @private
   */
  _handleKeyDown(event) {
    const key = event.key;
    
    // 记录修饰键状态
    if (Object.values(ModifierKeys).includes(key)) {
      this.activeModifiers.add(key);
    }
    
    // 构建组合键字符串
    const keyCombo = this._buildKeyCombo(key);
    
    // 更新键序列
    this._updateKeySequence(keyCombo);
    
    // 检查是否有匹配的快捷键
    if (this._executeShortcut(keyCombo)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  
  /**
   * 处理键盘释放事件
   * @param {KeyboardEvent} event 键盘事件
   * @private
   */
  _handleKeyUp(event) {
    const key = event.key;
    
    // 更新修饰键状态
    if (Object.values(ModifierKeys).includes(key)) {
      this.activeModifiers.delete(key);
    }
  }
  
  /**
   * 构建组合键字符串
   * @param {string} key 当前按下的键
   * @returns {string} 组合键字符串
   * @private
   */
  _buildKeyCombo(key) {
    // 如果按下的键本身就是修饰键，不要将其包含在组合键中
    if (Object.values(ModifierKeys).includes(key)) {
      return [...this.activeModifiers].join('+');
    }
    
    const modifiers = [...this.activeModifiers];
    return modifiers.length > 0 ? modifiers.join('+') + '+' + key : key;
  }
  
  /**
   * 更新键序列
   * @param {string} keyCombo 组合键字符串
   * @private
   */
  _updateKeySequence(keyCombo) {
    const now = Date.now();
    
    // 清除之前的定时器
    if (this.keySequenceTimer) {
      clearTimeout(this.keySequenceTimer);
    }
    
    // 如果键序列为空或已过期，重新开始
    if (this.keySequence.length === 0 || now - this.keySequence[this.keySequence.length - 1].time > this.keySequenceTimeout) {
      this.keySequence = [{ key: keyCombo, time: now }];
    } else {
      // 添加到现有序列
      this.keySequence.push({ key: keyCombo, time: now });
    }
    
    // 限制序列长度
    if (this.keySequence.length > 5) {
      this.keySequence.shift();
    }
    
    // 设置新的定时器
    this.keySequenceTimer = setTimeout(() => {
      this.keySequence = [];
    }, this.keySequenceTimeout);
    
    // 发送键序列事件
    const sequence = this.keySequence.map(item => item.key).join(' ');
    this.emit('sequence', sequence);
  }
  
  /**
   * 执行匹配的快捷键
   * @param {string} keyCombo 组合键字符串
   * @returns {boolean} 是否找到并执行了快捷键
   * @private
   */
  _executeShortcut(keyCombo) {
    // 按照作用域栈的顺序从上到下查找匹配的快捷键
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const scope = this.scopeStack[i];
      const shortcuts = this.shortcuts[scope];
      
      if (shortcuts && shortcuts[keyCombo]) {
        const { action, handler } = shortcuts[keyCombo];
        
        // 发送事件
        this.emit('shortcut:executed', { scope, action, keyCombo });
        
        // 执行处理器
        if (typeof handler === 'function') {
          handler();
        }
        
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 注册快捷键
   * @param {Object} options 快捷键选项
   * @param {string} options.scope 作用域
   * @param {string} options.key 键或组合键
   * @param {string} options.action 动作名称
   * @param {string} options.description 描述
   * @param {Function} options.handler 处理函数
   * @returns {string} 注册的键或组合键
   */
  registerShortcut({ scope, key, action, description, handler }) {
    if (!scope || !key || !action) {
      throw new Error('注册快捷键需要提供scope、key和action');
    }
    
    // 确保作用域存在
    if (!this.shortcuts[scope]) {
      this.shortcuts[scope] = {};
    }
    
    // 存储快捷键
    this.shortcuts[scope][key] = { action, description, handler };
    
    // 更新默认快捷键定义
    if (!this.defaultShortcuts[action]) {
      this.defaultShortcuts[action] = { scope, key, action, description, handler };
    }
    
    this.emit('shortcut:registered', { scope, key, action, description });
    
    return key;
  }
  
  /**
   * 注销快捷键
   * @param {string} scope 作用域
   * @param {string} key 键或组合键
   */
  unregisterShortcut(scope, key) {
    if (this.shortcuts[scope] && this.shortcuts[scope][key]) {
      const { action } = this.shortcuts[scope][key];
      delete this.shortcuts[scope][key];
      
      this.emit('shortcut:unregistered', { scope, key, action });
    }
  }
  
  /**
   * 获取指定作用域的所有快捷键
   * @param {string} scope 作用域
   * @returns {Object} 快捷键映射
   */
  getShortcutsForScope(scope) {
    return this.shortcuts[scope] || {};
  }
  
  /**
   * 获取所有已注册的快捷键
   * @returns {Object} 按作用域分组的快捷键
   */
  getAllShortcuts() {
    return { ...this.shortcuts };
  }
  
  /**
   * 获取指定动作的快捷键
   * @param {string} action 动作名称
   * @returns {Object|null} 快捷键对象
   */
  getShortcutForAction(action) {
    for (const scope in this.shortcuts) {
      for (const key in this.shortcuts[scope]) {
        if (this.shortcuts[scope][key].action === action) {
          return {
            scope,
            key,
            ...this.shortcuts[scope][key]
          };
        }
      }
    }
    
    return null;
  }
  
  /**
   * 推送作用域到栈顶
   * @param {string} scope 作用域
   */
  pushScope(scope) {
    if (!Object.values(KeyScope).includes(scope)) {
      throw new Error(`无效的作用域: ${scope}`);
    }
    
    // 如果作用域已在栈顶，不做任何操作
    if (this.scopeStack[this.scopeStack.length - 1] === scope) {
      return;
    }
    
    // 如果作用域已存在于栈中，先移除它
    const index = this.scopeStack.indexOf(scope);
    if (index !== -1) {
      this.scopeStack.splice(index, 1);
    }
    
    // 添加到栈顶
    this.scopeStack.push(scope);
    
    this.emit('scope:changed', this.scopeStack);
  }
  
  /**
   * 从栈中弹出顶层作用域
   * @returns {string|null} 被弹出的作用域
   */
  popScope() {
    if (this.scopeStack.length <= 1) {
      return null; // 不允许弹出全局作用域
    }
    
    const scope = this.scopeStack.pop();
    this.emit('scope:changed', this.scopeStack);
    
    return scope;
  }
  
  /**
   * 移除指定作用域
   * @param {string} scope 作用域
   * @returns {boolean} 是否成功移除
   */
  removeScope(scope) {
    if (scope === KeyScope.GLOBAL) {
      return false; // 不允许移除全局作用域
    }
    
    const index = this.scopeStack.indexOf(scope);
    if (index !== -1) {
      this.scopeStack.splice(index, 1);
      this.emit('scope:changed', this.scopeStack);
      return true;
    }
    
    return false;
  }
  
  /**
   * 获取当前活动的作用域
   * @returns {string} 当前活动作用域
   */
  getCurrentScope() {
    return this.scopeStack[this.scopeStack.length - 1];
  }
  
  /**
   * 获取当前作用域栈
   * @returns {Array<string>} 作用域栈
   */
  getScopeStack() {
    return [...this.scopeStack];
  }
  
  /**
   * 重置作用域栈到初始状态
   */
  resetScopeStack() {
    this.scopeStack = [KeyScope.GLOBAL];
    this.emit('scope:changed', this.scopeStack);
  }
  
  /**
   * 设置自定义快捷键
   * @param {string} action 动作名称
   * @param {string} keyCombo 组合键字符串
   */
  setCustomShortcut(action, keyCombo) {
    // 检查动作是否有效
    if (!this.defaultShortcuts[action]) {
      throw new Error(`未知的动作: ${action}`);
    }
    
    // 检查组合键是否与其他快捷键冲突
    for (const existingAction in this.customShortcuts) {
      if (existingAction !== action && this.customShortcuts[existingAction] === keyCombo) {
        throw new Error(`组合键 "${keyCombo}" 已被 "${existingAction}" 使用`);
      }
    }
    
    // 更新自定义快捷键
    this.customShortcuts[action] = keyCombo;
    
    // 保存到设置
    this.settings.set('advanced.keyboard.shortcuts', this.customShortcuts);
    
    // 重新应用快捷键
    this._applyShortcuts();
  }
  
  /**
   * 重置动作的快捷键到默认值
   * @param {string} action 动作名称
   */
  resetShortcut(action) {
    if (!this.defaultShortcuts[action]) {
      throw new Error(`未知的动作: ${action}`);
    }
    
    // 移除自定义快捷键
    delete this.customShortcuts[action];
    
    // 保存到设置
    this.settings.set('advanced.keyboard.shortcuts', this.customShortcuts);
    
    // 重新应用快捷键
    this._applyShortcuts();
  }
  
  /**
   * 重置所有快捷键到默认值
   */
  resetAllShortcuts() {
    this.customShortcuts = {};
    
    // 保存到设置
    this.settings.set('advanced.keyboard.shortcuts', this.customShortcuts);
    
    // 重新应用快捷键
    this._applyShortcuts();
  }
  
  /**
   * 获取组合键的格式化文本
   * @param {string} keyCombo 组合键字符串
   * @returns {string} 格式化文本
   */
  formatKeyCombo(keyCombo) {
    if (!keyCombo) return '';
    
    const keyMap = {
      [ModifierKeys.CTRL]: '⌃',
      [ModifierKeys.ALT]: '⌥',
      [ModifierKeys.SHIFT]: '⇧',
      [ModifierKeys.META]: '⌘',
      [SpecialKeys.ESCAPE]: 'Esc',
      [SpecialKeys.ENTER]: '⏎',
      [SpecialKeys.SPACE]: 'Space',
      [SpecialKeys.BACKSPACE]: '⌫',
      [SpecialKeys.DELETE]: 'Del',
      [SpecialKeys.TAB]: 'Tab',
      [SpecialKeys.ARROW_UP]: '↑',
      [SpecialKeys.ARROW_DOWN]: '↓',
      [SpecialKeys.ARROW_LEFT]: '←',
      [SpecialKeys.ARROW_RIGHT]: '→',
      [SpecialKeys.HOME]: 'Home',
      [SpecialKeys.END]: 'End',
      [SpecialKeys.PAGE_UP]: 'PgUp',
      [SpecialKeys.PAGE_DOWN]: 'PgDn'
    };
    
    return keyCombo.split('+').map(key => {
      return keyMap[key] || key.toUpperCase();
    }).join(' + ');
  }
  
  /**
   * 单例实例
   */
  static instance = null;
  
  /**
   * 获取服务实例
   * @returns {KeyboardManager} 键盘管理器实例
   */
  static getInstance() {
    if (!KeyboardManager.instance) {
      KeyboardManager.instance = new KeyboardManager();
    }
    return KeyboardManager.instance;
  }
}

// 导出默认实例
export default KeyboardManager.getInstance();