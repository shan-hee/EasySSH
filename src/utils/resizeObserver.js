/**
 * resizeObserver.js
 * 提供基于ResizeObserver API的工具函数，用于监听DOM元素大小变化
 */

/**
 * 防抖函数
 * @param {Function} fn - 需要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖处理后的函数
 */
export function debounce(fn, delay = 300) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };
}

/**
 * 为DOM元素创建大小监听器，带防抖功能
 * @param {HTMLElement} element - 要监听的DOM元素
 * @param {Function} callback - 大小变化时的回调函数
 * @param {Object} [options] - 配置选项
 * @param {number} [options.debounceTime=150] - 防抖延迟时间(毫秒)
 * @param {boolean} [options.immediate=false] - 是否立即执行一次回调
 * @returns {ResizeObserver|null} ResizeObserver实例，如果创建失败则返回null
 */
export function createResizeObserver(element, callback, options = {}) {
  if (!element || typeof callback !== 'function') {
    console.warn('无效的元素或回调函数');
    return null;
  }
  
  const { debounceTime = 150, immediate = false } = options;
  
  // 使用防抖包装回调函数
  const debouncedCallback = debounce((entries) => {
    for (const entry of entries) {
      callback(entry.contentRect);
    }
  }, debounceTime);
  
  try {
    const observer = new ResizeObserver(debouncedCallback);
    
    observer.observe(element);
    
    // 如果设置立即执行，则立即触发一次回调
    if (immediate) {
      callback({
        width: element.clientWidth,
        height: element.clientHeight,
        top: 0,
        left: 0,
        right: element.clientWidth,
        bottom: element.clientHeight
      });
    }
    
    return observer;
  } catch (error) {
    console.error('创建ResizeObserver失败:', error);
    return null;
  }
}

/**
 * 取消元素大小监听
 * @param {ResizeObserver} observer - ResizeObserver实例
 * @param {HTMLElement} [element] - 可选，指定要取消监听的元素
 */
export function disconnectResizeObserver(observer, element) {
  if (!observer) return;
  
  try {
    if (element) {
      observer.unobserve(element);
    } else {
      observer.disconnect();
    }
  } catch (error) {
    console.error('取消ResizeObserver监听失败:', error);
  }
}

/**
 * 兼容性检查
 * @returns {boolean} 当前环境是否支持ResizeObserver
 */
export function isResizeObserverSupported() {
  return typeof ResizeObserver !== 'undefined';
} 