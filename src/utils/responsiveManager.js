/**
 * 响应式布局管理器
 * 处理监控面板的响应式布局和自适应调整
 */

import { PANEL_CONFIG, PANEL_UTILS } from '@/config/monitoringPanel';

class ResponsiveManager {
  constructor() {
    this.breakpoints = PANEL_CONFIG.breakpoints;
    this.currentBreakpoint = null;
    this.listeners = new Set();
    this.resizeObserver = null;
    this.mediaQueries = new Map();
    
    // 初始化
    this.init();
  }

  /**
   * 初始化响应式管理器
   */
  init() {
    // 设置媒体查询监听
    this.setupMediaQueries();
    
    // 设置窗口大小变化监听
    this.setupResizeListener();
    
    // 初始化当前断点
    this.updateCurrentBreakpoint();
  }

  /**
   * 设置媒体查询监听
   */
  setupMediaQueries() {
    Object.entries(this.breakpoints).forEach(([name, width]) => {
      const mediaQuery = window.matchMedia(`(max-width: ${width}px)`);
      
      mediaQuery.addListener((e) => {
        this.handleBreakpointChange(name, e.matches);
      });
      
      this.mediaQueries.set(name, mediaQuery);
    });
  }

  /**
   * 设置窗口大小变化监听
   */
  setupResizeListener() {
    let resizeTimer;
    
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.updateCurrentBreakpoint();
        this.notifyListeners('resize', {
          width: window.innerWidth,
          height: window.innerHeight,
          breakpoint: this.currentBreakpoint
        });
      }, 100); // 防抖处理
    };
    
    window.addEventListener('resize', handleResize);
    
    // 存储清理函数
    this.cleanup = () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimer);
    };
  }

  /**
   * 处理断点变化
   * @param {string} breakpoint 断点名称
   * @param {boolean} matches 是否匹配
   */
  handleBreakpointChange(breakpoint, matches) {
    const previousBreakpoint = this.currentBreakpoint;
    this.updateCurrentBreakpoint();
    
    if (previousBreakpoint !== this.currentBreakpoint) {
      this.notifyListeners('breakpointChange', {
        from: previousBreakpoint,
        to: this.currentBreakpoint,
        breakpoint,
        matches
      });
    }
  }

  /**
   * 更新当前断点
   */
  updateCurrentBreakpoint() {
    const width = window.innerWidth;
    
    if (width < this.breakpoints.mobile) {
      this.currentBreakpoint = 'mobile';
    } else if (width < this.breakpoints.tablet) {
      this.currentBreakpoint = 'tablet';
    } else {
      this.currentBreakpoint = 'desktop';
    }
  }

  /**
   * 获取当前断点
   * @returns {string} 当前断点名称
   */
  getCurrentBreakpoint() {
    return this.currentBreakpoint;
  }

  /**
   * 检查是否为移动设备
   * @returns {boolean} 是否为移动设备
   */
  isMobile() {
    return this.currentBreakpoint === 'mobile';
  }

  /**
   * 检查是否为平板设备
   * @returns {boolean} 是否为平板设备
   */
  isTablet() {
    return this.currentBreakpoint === 'tablet';
  }

  /**
   * 检查是否为桌面设备
   * @returns {boolean} 是否为桌面设备
   */
  isDesktop() {
    return this.currentBreakpoint === 'desktop';
  }

  /**
   * 获取响应式配置
   * @param {number} width 可选的宽度，默认使用当前窗口宽度
   * @returns {Object} 响应式配置
   */
  getResponsiveConfig(width = window.innerWidth) {
    return PANEL_UTILS.getResponsiveConfig(width);
  }

  /**
   * 计算面板最佳尺寸
   * @param {Object} constraints 约束条件
   * @returns {Object} 最佳尺寸
   */
  calculateOptimalPanelSize(constraints = {}) {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const config = this.getResponsiveConfig();
    
    // 默认约束
    const defaultConstraints = {
      minWidth: PANEL_CONFIG.defaults.minWidth,
      minHeight: PANEL_CONFIG.defaults.minHeight,
      maxWidth: windowWidth * 0.9,
      maxHeight: windowHeight * 0.9,
      aspectRatio: null // 可选的宽高比
    };
    
    const finalConstraints = { ...defaultConstraints, ...constraints };
    
    let optimalWidth, optimalHeight;
    
    if (this.isMobile()) {
      // 移动设备：几乎全屏
      optimalWidth = Math.min(windowWidth * 0.95, finalConstraints.maxWidth);
      optimalHeight = Math.min(windowHeight * 0.8, finalConstraints.maxHeight);
    } else if (this.isTablet()) {
      // 平板设备：适中大小
      optimalWidth = Math.min(windowWidth * 0.8, finalConstraints.maxWidth);
      optimalHeight = Math.min(windowHeight * 0.7, finalConstraints.maxHeight);
    } else {
      // 桌面设备：使用默认大小或约束
      optimalWidth = Math.min(PANEL_CONFIG.defaults.width, finalConstraints.maxWidth);
      optimalHeight = Math.min(PANEL_CONFIG.defaults.height, finalConstraints.maxHeight);
    }
    
    // 应用最小尺寸约束
    optimalWidth = Math.max(optimalWidth, finalConstraints.minWidth);
    optimalHeight = Math.max(optimalHeight, finalConstraints.minHeight);
    
    // 应用宽高比约束
    if (finalConstraints.aspectRatio) {
      const currentRatio = optimalWidth / optimalHeight;
      if (currentRatio > finalConstraints.aspectRatio) {
        optimalWidth = optimalHeight * finalConstraints.aspectRatio;
      } else {
        optimalHeight = optimalWidth / finalConstraints.aspectRatio;
      }
    }
    
    return {
      width: Math.round(optimalWidth),
      height: Math.round(optimalHeight),
      breakpoint: this.currentBreakpoint,
      config
    };
  }

  /**
   * 计算面板最佳位置
   * @param {Object} size 面板尺寸
   * @param {string} position 位置偏好
   * @returns {Object} 最佳位置
   */
  calculateOptimalPanelPosition(size, position = 'center') {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    let x, y;
    
    switch (position) {
      case 'top-left':
        x = 20;
        y = 20;
        break;
      case 'top-right':
        x = windowWidth - size.width - 20;
        y = 20;
        break;
      case 'bottom-left':
        x = 20;
        y = windowHeight - size.height - 20;
        break;
      case 'bottom-right':
        x = windowWidth - size.width - 20;
        y = windowHeight - size.height - 20;
        break;
      case 'center':
      default:
        x = (windowWidth - size.width) / 2;
        y = (windowHeight - size.height) / 2;
        break;
    }
    
    // 确保面板在可视区域内
    x = Math.max(0, Math.min(x, windowWidth - size.width));
    y = Math.max(0, Math.min(y, windowHeight - size.height));
    
    return {
      x: Math.round(x),
      y: Math.round(y)
    };
  }

  /**
   * 添加响应式变化监听器
   * @param {Function} listener 监听器函数
   */
  addListener(listener) {
    this.listeners.add(listener);
  }

  /**
   * 移除响应式变化监听器
   * @param {Function} listener 监听器函数
   */
  removeListener(listener) {
    this.listeners.delete(listener);
  }

  /**
   * 通知所有监听器
   * @param {string} event 事件类型
   * @param {Object} data 事件数据
   */
  notifyListeners(event, data) {
    this.listeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (error) {
        console.error('响应式监听器执行错误:', error);
      }
    });
  }

  /**
   * 创建ResizeObserver监听元素大小变化
   * @param {HTMLElement} element 要监听的元素
   * @param {Function} callback 回调函数
   * @returns {ResizeObserver} ResizeObserver实例
   */
  observeElementResize(element, callback) {
    if (!window.ResizeObserver) {
      console.warn('ResizeObserver not supported');
      return null;
    }
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        callback({ width, height, element: entry.target });
      }
    });
    
    observer.observe(element);
    return observer;
  }

  /**
   * 获取设备信息
   * @returns {Object} 设备信息
   */
  getDeviceInfo() {
    return {
      breakpoint: this.currentBreakpoint,
      isMobile: this.isMobile(),
      isTablet: this.isTablet(),
      isDesktop: this.isDesktop(),
      windowSize: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      devicePixelRatio: window.devicePixelRatio || 1,
      touchSupport: 'ontouchstart' in window,
      orientation: window.screen?.orientation?.type || 'unknown'
    };
  }

  /**
   * 销毁响应式管理器
   */
  destroy() {
    // 清理窗口监听器
    if (this.cleanup) {
      this.cleanup();
    }
    
    // 清理媒体查询监听器
    this.mediaQueries.forEach((mediaQuery) => {
      mediaQuery.removeListener();
    });
    
    // 清理ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    
    // 清理监听器
    this.listeners.clear();
    
    console.log('响应式管理器已销毁');
  }
}

// 创建单例实例
const responsiveManager = new ResponsiveManager();

export default responsiveManager;
