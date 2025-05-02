/**
 * 菜单管理模块
 * 负责处理菜单的折叠/展开和相关交互功能
 */

import { uiConfig, storageConfig } from '../core/config.js';
import { saveToStorage, getFromStorage } from '../utils/storage.js';

// 默认菜单状态
let isMenuCollapsed = uiConfig.defaultMenuState === 'collapsed';

// 缓存DOM选择器结果
const domCache = {
  sidebar: null,
  mainContent: null,
  menuToggle: null,
  menuItems: null
};

/**
 * 初始化菜单管理器
 */
function init() {
  // 从本地存储读取菜单状态
  const savedState = getFromStorage(storageConfig.keys.menuState);
  
  if (savedState !== null) {
    isMenuCollapsed = savedState === 'collapsed';
  }
  
  // 缓存常用DOM元素引用
  domCache.sidebar = document.querySelector('.sidebar');
  domCache.mainContent = document.querySelector('.main-content');
  domCache.menuToggle = document.getElementById('menuToggle');
  domCache.menuList = document.querySelector('.menu__list');
  
  // 应用菜单状态 - 使用requestAnimationFrame避免强制同步布局
  window.requestAnimationFrame(() => {
    updateMenuState();
  });
  
  // 设置事件监听 - 使用事件委托减少监听器数量
  setupEventListeners();
  
  // 设置响应式行为 - 防抖处理resize事件
  setupResponsiveBehavior();
  
  console.log(`菜单管理初始化完成`);
}

/**
 * 设置事件监听
 */
function setupEventListeners() {
  // 菜单折叠切换
  if (domCache.menuToggle) {
    domCache.menuToggle.addEventListener('click', toggleMenu);
  }
  
  // 使用事件委托处理菜单项点击
  if (domCache.menuList) {
    domCache.menuList.addEventListener('click', handleMenuItemClick);
  }
}

/**
 * 处理菜单项点击 - 使用事件委托
 * @param {Event} event 点击事件
 */
function handleMenuItemClick(event) {
  // 查找最近的菜单项元素
  const menuItem = event.target.closest('.menu__item');
  if (!menuItem) return;
  
  // 获取菜单项数据
  const menuId = menuItem.getAttribute('id');
  const href = menuItem.getAttribute('data-href');
  
  // 设置活动菜单项
  if (menuId) {
    setActiveMenuItem(menuId);
  }
  
  // 处理导航
  if (href) {
    console.log(`导航到: ${href}`);
    // 可以在此处实现路由逻辑
  }
}

/**
 * 切换菜单折叠状态
 */
function toggleMenu() {
  isMenuCollapsed = !isMenuCollapsed;
  
  // 使用requestAnimationFrame优化视觉更新
  window.requestAnimationFrame(() => {
    updateMenuState();
  });
  
  // 保存到本地存储
  saveToStorage(storageConfig.keys.menuState, isMenuCollapsed ? 'collapsed' : 'expanded');
  
  // 触发菜单状态变更事件
  document.dispatchEvent(new CustomEvent('menuStateChanged', { 
    detail: { collapsed: isMenuCollapsed } 
  }));
}

/**
 * 更新菜单UI状态 - 使用classList.toggle优化
 */
function updateMenuState() {
  if (!domCache.sidebar) return;
  
  // 使用classList.toggle优化多个类的操作
  domCache.sidebar.classList.toggle('collapsed', isMenuCollapsed);
  
  if (domCache.mainContent) {
    domCache.mainContent.classList.toggle('expanded', isMenuCollapsed);
  }
  
  // 更新菜单切换按钮图标
  updateMenuToggleIcon();
}

/**
 * 更新菜单切换按钮图标 - 最小化DOM操作
 */
function updateMenuToggleIcon() {
  const icon = domCache.menuToggle ? domCache.menuToggle.querySelector('i') : null;
  if (!icon) return;
  
  // 使用classList.toggle简化类操作
  icon.classList.toggle('fa-angle-right', isMenuCollapsed);
  icon.classList.toggle('fa-angle-left', !isMenuCollapsed);
}

/**
 * 设置响应式行为 - 使用防抖函数优化
 */
function setupResponsiveBehavior() {
  const mobileBreakpoint = 768; // 移动设备断点
  
  // 初始检查
  checkScreenSize();
  
  // 使用防抖函数处理resize事件
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(checkScreenSize, 100);
  });
  
  function checkScreenSize() {
    if (window.innerWidth <= mobileBreakpoint && !isMenuCollapsed) {
      toggleMenu(); // 在小屏幕上自动折叠菜单
    }
  }
}

/**
 * 设置菜单项的活动状态 - 使用DocumentFragment优化
 * @param {string} menuId 要激活的菜单项ID
 */
function setActiveMenuItem(menuId) {
  if (!domCache.menuList) return;
  
  // 创建一个副本，避免多次重绘
  const fragment = document.createDocumentFragment();
  const allItems = domCache.menuList.querySelectorAll('.menu-item');
  
  // 在片段上执行操作，减少DOM重绘
  allItems.forEach(item => {
    // 使用classList.toggle更高效
    item.classList.toggle('active', item.id === menuId);
    fragment.appendChild(item.cloneNode(true));
  });
  
  // 一次性更新DOM
  if (fragment.childNodes.length > 0) {
    domCache.menuList.innerHTML = '';
    domCache.menuList.appendChild(fragment);
  }
}

/**
 * 获取当前菜单折叠状态
 * @returns {boolean} 菜单是否折叠
 */
function isCollapsed() {
  return isMenuCollapsed;
}

export default {
  init,
  toggleMenu,
  updateMenuState,
  setActiveMenuItem,
  isCollapsed
};

