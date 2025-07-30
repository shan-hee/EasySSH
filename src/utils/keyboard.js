/**
 * 本地键盘快捷键管理工具
 * 作为window.services.keyboardManager的替代方案
 */

// 存储快捷键配置的键名
const SHORTCUTS_STORAGE_KEY = 'easyssh_keyboard_shortcuts';

// 默认快捷键定义
const DEFAULT_SHORTCUTS = {
  'terminal.copy': { key: 'Ctrl+Shift+C', description: '复制选中内容' },
  'terminal.paste': { key: 'Ctrl+Shift+V', description: '粘贴' },
  'accessibility.increaseFontSize': { key: 'Ctrl+Alt+=', description: '增加字体大小' },
  'accessibility.decreaseFontSize': { key: 'Ctrl+Alt+-', description: '减小字体大小' },
  'settings.open': { key: 'Ctrl+,', description: '打开设置' },
  'terminal.clear': { key: 'Ctrl+L', description: '清空终端' }
};

/**
 * 获取所有快捷键设置
 * @returns {Object} 快捷键设置对象
 */
export function getAllShortcuts() {
  try {
    // 从本地存储获取自定义快捷键设置
    const storedShortcuts = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    const customShortcuts = storedShortcuts ? JSON.parse(storedShortcuts) : {};
    
    // 创建快捷键配置对象，合并默认配置和自定义配置
    const shortcuts = { ...DEFAULT_SHORTCUTS };
    
    // 应用自定义快捷键设置
    Object.keys(customShortcuts).forEach(action => {
      if (shortcuts[action]) {
        shortcuts[action].key = customShortcuts[action];
      }
    });
    
    return shortcuts;
  } catch (error) {
    console.error('获取快捷键设置失败:', error);
    return { ...DEFAULT_SHORTCUTS };
  }
}

/**
 * 获取指定操作的快捷键
 * @param {string} action 操作名称
 * @returns {Object|null} 快捷键配置对象
 */
export function getShortcutForAction(action) {
  const shortcuts = getAllShortcuts();
  return shortcuts[action] || null;
}

/**
 * 获取与给定快捷键冲突的操作
 * @param {string} key 快捷键
 * @param {string} excludeAction 排除的操作名称（可选）
 * @returns {Object|null} 冲突的操作信息
 */
export function getConflictingShortcut(key, excludeAction = null) {
  const shortcuts = getAllShortcuts();
  
  // 查找使用了相同快捷键的其他操作
  for (const action in shortcuts) {
    if (action !== excludeAction && shortcuts[action].key === key) {
      return {
        action,
        description: shortcuts[action].description,
        key: shortcuts[action].key
      };
    }
  }
  
  return null;
}

/**
 * 检查快捷键是否有效（格式正确）
 * @param {string} key 快捷键
 * @returns {boolean} 是否有效
 */
export function isValidShortcut(key) {
  // 基本验证：非空，且格式为X+Y或单个键
  return Boolean(key && typeof key === 'string' && key.trim().length > 0);
}

/**
 * 设置快捷键
 * @param {string} action 操作名称
 * @param {string} key 快捷键
 * @returns {boolean} 设置是否成功
 */
export function setShortcut(action, key) {
  try {
    // 检查操作是否有效
    if (!DEFAULT_SHORTCUTS[action]) {
      throw new Error(`未知的操作: ${action}`);
    }
    
    // 检查快捷键格式是否有效
    if (!isValidShortcut(key)) {
      throw new Error(`无效的快捷键格式: ${key}`);
    }
    
    // 获取现有自定义快捷键
    const storedShortcuts = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    const customShortcuts = storedShortcuts ? JSON.parse(storedShortcuts) : {};
    
    // 检查快捷键冲突
    const conflictingShortcut = getConflictingShortcut(key, action);
    if (conflictingShortcut) {
      throw new Error(`快捷键 "${key}" 已被 "${conflictingShortcut.description}" 使用`);
    }
    
    // 设置新快捷键
    customShortcuts[action] = key;
    
    // 保存到本地存储
    localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(customShortcuts));
    
    return true;
  } catch (error) {
    console.error('设置快捷键失败:', error);
    throw error;
  }
}

/**
 * 重置快捷键到默认值
 * @param {string} action 操作名称（可选，如果不提供则重置所有快捷键）
 * @returns {boolean} 重置是否成功
 */
export function resetShortcuts(action) {
  try {
    if (action) {
      // 重置特定快捷键
      const storedShortcuts = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
      if (!storedShortcuts) {
        return true; // 没有自定义设置，不需要重置
      }

      const customShortcuts = JSON.parse(storedShortcuts);
      if (customShortcuts[action]) {
        delete customShortcuts[action];
        localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(customShortcuts));
      }
    } else {
      // 重置所有快捷键 - 直接清空整个存储
      localStorage.removeItem(SHORTCUTS_STORAGE_KEY);
    }

    return true;
  } catch (error) {
    console.error('重置快捷键失败:', error);
    return false;
  }
}

/**
 * 创建一个本地键盘管理器对象
 * 兼容window.services.keyboardManager的接口
 */
export const localKeyboardManager = {
  getShortcutForAction,
  setCustomShortcut: setShortcut,
  resetShortcut: action => resetShortcuts(action),
  resetAllShortcuts: () => resetShortcuts(),
  getConflictingShortcut,
  isValidShortcut
}; 