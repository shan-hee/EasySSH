/**
 * resizeObserver.js
 * 提供基于ResizeObserver API的工具函数，用于监听DOM元素大小变化
 */

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => void>(fn: T, delay: number = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function (...args: Parameters<T>) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(undefined as any, args);
      timer = null;
    }, delay);
  } as (...args: Parameters<T>) => void;
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
export function createResizeObserver(
  element: HTMLElement | null,
  callback: (rect: DOMRectReadOnly) => void,
  options: { debounceTime?: number; immediate?: boolean } = {}
): ResizeObserver | null {
  if (!element || typeof callback !== 'function') {
  import('@/services/log').then(m => m.default.warn('无效的元素或回调函数'));
    return null;
  }

  const { debounceTime = 150, immediate = false } = options;

  // 使用防抖包装回调函数
  const debouncedCallback = debounce((entries: ResizeObserverEntry[]) => {
    for (const entry of entries) {
      callback(entry.contentRect);
    }
  }, debounceTime);

  try {
    const observer = new ResizeObserver(debouncedCallback);

    observer.observe(element);

    // 如果设置立即执行，则立即触发一次回调
    if (immediate) {
      const rect = element.getBoundingClientRect();
      // DOMRect implements DOMRectReadOnly
      callback(rect as DOMRectReadOnly);
    }

    return observer;
  } catch (error: any) {
    import('@/services/log').then(m => m.default.error('创建ResizeObserver失败', error));
    return null;
  }
}

/**
 * 取消元素大小监听
 * @param {ResizeObserver} observer - ResizeObserver实例
 * @param {HTMLElement} [element] - 可选，指定要取消监听的元素
 */
export function disconnectResizeObserver(observer?: ResizeObserver | null, element?: HTMLElement | null): void {
  if (!observer) return;

  try {
    if (element) {
      observer.unobserve(element);
    } else {
      observer.disconnect();
    }
  } catch (error: any) {
    import('@/services/log').then(m => m.default.error('取消ResizeObserver监听失败', error));
  }
}

/**
 * 兼容性检查
 * @returns {boolean} 当前环境是否支持ResizeObserver
 */
export function isResizeObserverSupported(): boolean {
  return typeof ResizeObserver !== 'undefined';
}
