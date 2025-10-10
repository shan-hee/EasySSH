/**
 * 键盘快捷键管理服务（TypeScript 迁移版）
 */
import EventEmitter from './EventEmitter';
import settingsService from '@/services/settings';
import accessibilityService from './accessibility';

export const ModifierKeys = {
  ALT: 'Alt',
  CTRL: 'Control',
  SHIFT: 'Shift',
  META: 'Meta'
} as const;

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
} as const;

export const KeyScope = {
  GLOBAL: 'global',
  APP: 'app',
  EDITOR: 'editor',
  TERMINAL: 'terminal',
  DIALOG: 'dialog',
  CONTEXTMENU: 'contextmenu',
  MODAL: 'modal'
} as const;

type ShortcutHandler = () => void;
type Shortcut = { action: string; description?: string; handler?: ShortcutHandler };

export class KeyboardManager extends EventEmitter {
  private static instanceRef: KeyboardManager | null = null;

  private shortcuts: Record<string, Record<string, Shortcut>> = {};
  private scopeStack: string[] = [KeyScope.GLOBAL];
  private activeModifiers: Set<string> = new Set();
  private keySequence: Array<{ key: string; time: number }> = [];
  private keySequenceTimeout = 1000;
  private keySequenceTimer: any = null;

  private settings: any = settingsService;
  private defaultShortcuts: Record<string, any> = {};
  private customShortcuts: Record<string, string> = {};

  static getInstance(): KeyboardManager {
    if (!KeyboardManager.instanceRef) {
      KeyboardManager.instanceRef = new KeyboardManager();
    }
    return KeyboardManager.instanceRef;
  }

  constructor() {
    super();
    this._registerEventHandlers();
    this._loadFromSettings();
    this._initDefaultShortcuts();
  }

  private _registerEventHandlers() {
    document.addEventListener('keydown', this._handleKeyDown.bind(this));
    document.addEventListener('keyup', this._handleKeyUp.bind(this));
    window.addEventListener('blur', () => this.activeModifiers.clear());
    this.settings?.addChangeListener?.(this._loadFromSettings.bind(this));
  }

  private _loadFromSettings() {
    this.customShortcuts = this.settings?.get?.('advanced.keyboard.shortcuts', {}) || {};
    this._applyShortcuts();
  }

  private _initDefaultShortcuts() {
    this.registerShortcut({
      scope: KeyScope.GLOBAL,
      key: `${ModifierKeys.CTRL}+,`,
      action: 'settings.open',
      description: '打开设置',
      handler: () => this.emit('action', 'settings.open')
    });

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

    this.registerShortcut({
      scope: KeyScope.TERMINAL,
      key: `${ModifierKeys.CTRL}+l`,
      action: 'terminal.clear',
      description: '清空终端',
      handler: () => this.emit('action', 'terminal.clear')
    });

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

  private _applyShortcuts() {
    this.shortcuts = {};
    Object.values(this.defaultShortcuts).forEach((shortcut: any) => this.registerShortcut(shortcut));
    Object.entries(this.customShortcuts).forEach(([action, keyCombo]) => {
      const def = this.defaultShortcuts[action];
      if (def) this.registerShortcut({ ...def, key: keyCombo });
    });
  }

  private _handleKeyDown(event: KeyboardEvent) {
    const key = event.key;

    if (Object.values(ModifierKeys as any).includes(key as any)) {
      this.activeModifiers.add(key);
    }

    const keyCombo = this._buildKeyCombo(key);
    this._updateKeySequence(keyCombo);

    if (this._executeShortcut(keyCombo)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private _handleKeyUp(event: KeyboardEvent) {
    const key = event.key;
    if (Object.values(ModifierKeys as any).includes(key as any)) {
      this.activeModifiers.delete(key);
    }
  }

  private _buildKeyCombo(key: string): string {
    if (Object.values(ModifierKeys as any).includes(key as any)) {
      return [...this.activeModifiers].join('+');
    }
    const modifiers = [...this.activeModifiers];
    return modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key;
  }

  private _updateKeySequence(keyCombo: string) {
    const now = Date.now();
    if (this.keySequenceTimer) clearTimeout(this.keySequenceTimer);

    if (this.keySequence.length === 0 || now - this.keySequence[this.keySequence.length - 1].time > this.keySequenceTimeout) {
      this.keySequence = [{ key: keyCombo, time: now }];
    } else {
      this.keySequence.push({ key: keyCombo, time: now });
    }

    if (this.keySequence.length > 5) this.keySequence.shift();

    this.keySequenceTimer = setTimeout(() => {
      this.keySequence = [];
    }, this.keySequenceTimeout);

    const sequence = this.keySequence.map(i => i.key).join(' ');
    this.emit('sequence', sequence);
  }

  private _executeShortcut(keyCombo: string): boolean {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const scope = this.scopeStack[i];
      const shortcuts = this.shortcuts[scope];
      if (shortcuts && shortcuts[keyCombo]) {
        const { action, handler } = shortcuts[keyCombo];
        this.emit('shortcut:executed', { scope, action, keyCombo });
        if (typeof handler === 'function') handler();
        return true;
      }
    }
    return false;
  }

  registerShortcut({ scope, key, action, description, handler }: { scope: string; key: string; action: string; description?: string; handler?: ShortcutHandler; }): string {
    if (!scope || !key || !action) throw new Error('注册快捷键需要提供scope、key和action');
    if (!this.shortcuts[scope]) this.shortcuts[scope] = {};
    this.shortcuts[scope][key] = { action, description, handler };
    if (!this.defaultShortcuts[action]) this.defaultShortcuts[action] = { scope, key, action, description, handler };
    this.emit('shortcut:registered', { scope, key, action, description });
    return key;
  }

  unregisterShortcut(scope: string, key: string) {
    if (this.shortcuts[scope]?.[key]) {
      const { action } = this.shortcuts[scope][key];
      delete this.shortcuts[scope][key];
      this.emit('shortcut:unregistered', { scope, key, action });
    }
  }

  getShortcutsForScope(scope: string) { return this.shortcuts[scope] || {}; }
  getAllShortcuts() { return { ...this.shortcuts }; }

  getShortcutForAction(action: string): any | null {
    for (const scope in this.shortcuts) {
      for (const key in this.shortcuts[scope]) {
        if (this.shortcuts[scope][key].action === action) {
          return { scope, key, ...this.shortcuts[scope][key] };
        }
      }
    }
    return null;
  }

  pushScope(scope: string) {
    if (!Object.values(KeyScope).includes(scope as any)) throw new Error(`无效的作用域: ${scope}`);
    if (this.scopeStack[this.scopeStack.length - 1] === scope) return;
    const index = this.scopeStack.indexOf(scope);
    if (index !== -1) this.scopeStack.splice(index, 1);
    this.scopeStack.push(scope);
    this.emit('scope:changed', this.scopeStack);
  }

  popScope(): string | null {
    if (this.scopeStack.length <= 1) return null;
    const scope = this.scopeStack.pop() || null;
    this.emit('scope:changed', this.scopeStack);
    return scope;
  }

  removeScope(scope: string): boolean {
    if (scope === KeyScope.GLOBAL) return false;
    const index = this.scopeStack.indexOf(scope);
    if (index !== -1) this.scopeStack.splice(index, 1);
    this.emit('scope:changed', this.scopeStack);
    return index !== -1;
  }

  getScopeStack(): string[] { return [...this.scopeStack]; }
  resetScopeStack() { this.scopeStack = [KeyScope.GLOBAL]; this.emit('scope:changed', this.scopeStack); }

  setCustomShortcut(action: string, keyCombo: string) {
    if (!this.defaultShortcuts[action]) throw new Error(`未知的动作: ${action}`);
    for (const existingAction in this.customShortcuts) {
      if (existingAction !== action && this.customShortcuts[existingAction] === keyCombo) {
        throw new Error(`组合键 "${keyCombo}" 已被 "${existingAction}" 使用`);
      }
    }
    this.customShortcuts[action] = keyCombo;
    this.settings?.set?.('advanced.keyboard.shortcuts', this.customShortcuts);
    this._applyShortcuts();
  }

  resetShortcut(action: string) {
    if (!this.defaultShortcuts[action]) throw new Error(`未知的动作: ${action}`);
    delete this.customShortcuts[action];
    this.settings?.set?.('advanced.keyboard.shortcuts', this.customShortcuts);
    this._applyShortcuts();
  }

  resetAllShortcuts() {
    this.customShortcuts = {};
    this.settings?.set?.('advanced.keyboard.shortcuts', this.customShortcuts);
    this._applyShortcuts();
  }

  formatKeyCombo(keyCombo?: string): string {
    if (!keyCombo) return '';
    const keyMap: Record<string, string> = {
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
    return keyCombo.split('+').map(k => keyMap[k] || k.toUpperCase()).join(' + ');
  }
}

export default KeyboardManager.getInstance();

