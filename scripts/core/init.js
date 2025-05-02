/**
 * 应用初始化模块
 * 负责应用的初始启动和核心模块加载
 */

import config from './config.js';
import themeModule from '../modules/theme.js';
import menuModule from '../modules/menu.js';
import connectionsModule from '../modules/connections.js';
import ElementComponents from '../../lib/element/element-components.js';

// 应用实例
let app = null;

/**
 * 初始化应用
 */
export function initApp() {
  console.log('初始化 Easyssh 应用...');
  
  // 创建Vue应用实例
  createVueApp();
  
  // 初始化模块
  initModules();
  
  // 设置全局事件
  setupGlobalEvents();
  
  // 添加动画效果
  addAnimationEffects();
  
  console.log('应用初始化完成');
}

/**
 * 创建Vue应用实例
 */
function createVueApp() {
  try {
    // 创建Vue应用
    app = Vue.createApp({
      data() {
        return {
          appName: 'Easyssh',
          appVersion: '1.0.0',
          isLoading: false,
          errorMessage: null
        };
      },
      mounted() {
        console.log('Vue 应用已挂载');
      },
      methods: {
        showLoading() {
          this.isLoading = true;
        },
        hideLoading() {
          this.isLoading = false;
        },
        showError(message) {
          this.errorMessage = message;
          setTimeout(() => {
            this.errorMessage = null;
          }, config.ui.notificationDuration);
        }
      }
    });
    
    // 注册全局组件
    registerGlobalComponents();
    
    // 挂载应用
    app.mount('#app');
    
    console.log('Vue 应用创建成功');
  } catch (error) {
    console.error('创建Vue应用失败:', error);
  }
}

/**
 * 注册全局组件
 */
function registerGlobalComponents() {
  if (!app) return;
  
  try {
    // 注册Element Plus组件 - 按需引入
    ElementComponents.install(app);
    
    console.log('全局组件注册完成');
  } catch (error) {
    console.error('注册全局组件失败:', error);
  }
}

/**
 * 初始化应用模块
 */
function initModules() {
  try {
    // 初始化主题模块
    themeModule.init();
    
    // 初始化菜单模块
    menuModule.init();
    
    // 初始化连接模块
    connectionsModule.init();
    
    console.log('应用模块初始化完成');
  } catch (error) {
    console.error('初始化应用模块失败:', error);
    showErrorMessage('模块初始化失败，请刷新页面重试');
  }
}

/**
 * 设置全局事件处理
 */
function setupGlobalEvents() {
  // 处理全局错误
  window.addEventListener('error', handleGlobalError);
  
  // 处理未捕获的Promise错误
  window.addEventListener('unhandledrejection', handlePromiseError);
  
  // 添加移动设备检测
  checkMobileDevice();
  
  console.log('全局事件处理已设置');
}

/**
 * 处理全局错误
 * @param {ErrorEvent} event 错误事件
 */
function handleGlobalError(event) {
  console.error('全局错误:', event.error || event.message);
  showErrorMessage('应用发生错误，请刷新页面重试');
  
  // 防止错误冒泡
  event.preventDefault();
}

/**
 * 处理Promise错误
 * @param {PromiseRejectionEvent} event Promise拒绝事件
 */
function handlePromiseError(event) {
  console.error('未处理的Promise错误:', event.reason);
  
  // 防止错误冒泡
  event.preventDefault();
}

/**
 * 检测移动设备
 */
function checkMobileDevice() {
  const isMobile = window.innerWidth <= config.ui.breakpoints.mobile;
  
  if (isMobile) {
    document.body.classList.add('mobile-device');
  } else {
    document.body.classList.remove('mobile-device');
  }
  
  // 监听屏幕大小变化
  window.addEventListener('resize', () => {
    const isMobileNow = window.innerWidth <= config.ui.breakpoints.mobile;
    
    if (isMobileNow) {
      document.body.classList.add('mobile-device');
    } else {
      document.body.classList.remove('mobile-device');
    }
  });
}

/**
 * 添加动画效果
 */
function addAnimationEffects() {
  // 设置CSS变量
  document.documentElement.style.setProperty(
    '--animation-duration', 
    `${config.ui.animationDuration}ms`
  );
  
  // 为可动画元素添加过渡类
  document.querySelectorAll('.animatable').forEach(element => {
    element.style.transition = `all ${config.ui.animationDuration}ms ease-in-out`;
  });
}

/**
 * 显示错误消息
 * @param {string} message 错误消息
 */
function showErrorMessage(message) {
  const errorElement = document.getElementById('errorMessage');
  
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.classList.add('visible');
    
    setTimeout(() => {
      errorElement.classList.remove('visible');
    }, config.ui.notificationDuration);
  } else if (app) {
    app.showError(message);
  } else {
    alert(message);
  }
}

/**
 * 获取应用实例
 * @returns {Object|null} Vue应用实例
 */
export function getAppInstance() {
  return app;
}

// 导出初始化函数
export default {
  initApp,
  getAppInstance
};
