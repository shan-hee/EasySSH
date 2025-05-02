/**
 * 主题管理模块
 * 负责处理应用主题切换和相关功能
 */

import { uiConfig, storageConfig } from '../core/config.js';
import { saveToStorage, getFromStorage } from '../utils/storage.js';

// 支持的主题列表
const THEMES = {
  LIGHT: 'light',
  DARK: 'dark'
};

// 当前主题
let currentTheme = uiConfig.defaultTheme;

/**
 * 初始化主题管理器
 */
function init() {
  // 从本地存储读取主题设置
  const savedTheme = getFromStorage(storageConfig.keys.theme);
  
  if (savedTheme) {
    currentTheme = savedTheme;
  }
  
  // 应用当前主题
  applyTheme(currentTheme);
  
  // 监听主题切换按钮
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
    updateThemeToggleIcon();
  }
  
  console.log(`主题管理初始化完成，当前主题: ${currentTheme}`);
}

/**
 * 切换主题
 */
function toggleTheme() {
  currentTheme = currentTheme === THEMES.LIGHT ? THEMES.DARK : THEMES.LIGHT;
  applyTheme(currentTheme);
  updateThemeToggleIcon();
  
  // 保存到本地存储
  saveToStorage(storageConfig.keys.theme, currentTheme);
  
  console.log(`主题已切换为: ${currentTheme}`);
  
  // 触发主题变更事件
  document.dispatchEvent(new CustomEvent('themeChanged', { 
    detail: { theme: currentTheme } 
  }));
}

/**
 * 应用指定主题
 * @param {string} theme 主题名称
 */
function applyTheme(theme) {
  const body = document.body;
  
  // 移除所有主题相关的class
  body.classList.remove('light-theme');
  body.classList.remove('dark-theme');
  
  // 添加当前主题的class
  if (theme === THEMES.LIGHT) {
    body.classList.add('light-theme');
  } else {
    body.classList.add('dark-theme');
  }
  
  // 更新meta标签的theme-color
  const themeColor = theme === THEMES.LIGHT ? '#ffffff' : '#1e293b';
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', themeColor);
  } else {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = themeColor;
    document.head.appendChild(meta);
  }
}

/**
 * 更新主题切换按钮图标
 */
function updateThemeToggleIcon() {
  const icon = document.querySelector('#themeToggle i');
  if (!icon) return;
  
  if (currentTheme === THEMES.LIGHT) {
    icon.classList.remove('fa-sun');
    icon.classList.add('fa-moon');
  } else {
    icon.classList.remove('fa-moon');
    icon.classList.add('fa-sun');
  }
}

/**
 * 获取当前主题
 * @returns {string} 当前主题名称
 */
function getCurrentTheme() {
  return currentTheme;
}

export default {
  init,
  toggleTheme,
  applyTheme,
  getCurrentTheme,
  THEMES
};
