/**
 * chartPerformance.js - 图表性能优化工具
 * 提供图表渲染性能优化、内存管理和错误处理功能
 */

/**
 * 图表性能监控器
 */
type ChartInfo = {
  instance: any;
  lastUpdate: number;
  updateCount: number;
  renderTime: number;
};

class ChartPerformanceMonitor {
  charts: Map<string, ChartInfo>;
  renderTimes: number[];
  memoryUsage: any[];
  maxRenderTime: number;
  maxMemoryUsage: number;
  constructor() {
    this.charts = new Map<string, ChartInfo>();
    this.renderTimes = [];
    this.memoryUsage = [];
    this.maxRenderTime = 16; // 60fps目标
    this.maxMemoryUsage = 50 * 1024 * 1024; // 50MB
  }

  /**
   * 注册图表实例
   * @param {string} id - 图表ID
   * @param {Chart} chart - Chart.js实例
   */
  registerChart(id: string, chart: any): void {
    this.charts.set(id, {
      instance: chart,
      lastUpdate: Date.now(),
      updateCount: 0,
      renderTime: 0
    });
  }

  /**
   * 注销图表实例
   * @param {string} id - 图表ID
   */
  unregisterChart(id: string): void {
    const chartInfo = this.charts.get(id);
    if (chartInfo && chartInfo.instance) {
      chartInfo.instance.destroy();
    }
    this.charts.delete(id);
  }

  /**
   * 测量图表渲染性能
   * @param {string} id - 图表ID
   * @param {Function} updateFn - 更新函数
   */
  async measureRenderTime(id: string, updateFn: () => Promise<void> | void): Promise<void> {
    const chartInfo = this.charts.get(id);
    if (!chartInfo) return;

    const startTime = performance.now();

    try {
      await updateFn();
      const endTime = performance.now();
      const renderTime = endTime - startTime;

      chartInfo.renderTime = renderTime;
      chartInfo.lastUpdate = Date.now();
      chartInfo.updateCount++;

      this.renderTimes.push(renderTime);
      if (this.renderTimes.length > 100) {
        this.renderTimes.shift();
      }

      // 性能警告
      if (renderTime > this.maxRenderTime) {
        import('@/services/log').then(m => m.default.warn(`图表 ${id} 渲染时间过长`, { renderTimeMs: Number(renderTime.toFixed(2)) }));
      }
    } catch (error: any) {
      import('@/services/log').then(m => m.default.error(`图表 ${id} 渲染错误`, error));
    }
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats(): { chartCount: number; avgRenderTime: string; maxRenderTime: string; totalUpdates: number } {
    const avgRenderTime =
      this.renderTimes.length > 0
        ? this.renderTimes.reduce((a, b) => a + b, 0) / this.renderTimes.length
        : 0;

    const maxRenderTime = this.renderTimes.length > 0 ? Math.max(...this.renderTimes) : 0;

    return {
      chartCount: this.charts.size,
      avgRenderTime: avgRenderTime.toFixed(2),
      maxRenderTime: maxRenderTime.toFixed(2),
      totalUpdates: Array.from(this.charts.values()).reduce(
        (sum, chart) => sum + chart.updateCount,
        0
      )
    };
  }

  /**
   * 清理性能数据
   */
  cleanup(): void {
    this.renderTimes = [];
    this.memoryUsage = [];
  }
}

// 全局性能监控器实例
export const chartPerformanceMonitor = new ChartPerformanceMonitor();

/**
 * 防抖更新函数
 * @param {Function} fn - 要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
export function debounceChartUpdate<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 100
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return function (...args: Parameters<T>) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(undefined as any, args), delay);
  };
}

/**
 * 节流更新函数
 * @param {Function} fn - 要节流的函数
 * @param {number} limit - 限制时间（毫秒）
 * @returns {Function} 节流后的函数
 */
export function throttleChartUpdate<T extends (...args: any[]) => any>(
  fn: T,
  limit: number = 16
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return function (...args: Parameters<T>) {
    if (!inThrottle) {
      fn.apply(undefined as any, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * 批量更新图表
 * @param {Array} updates - 更新任务数组
 */
export async function batchUpdateCharts(
  updates: Array<{ chartId: string; updateFn: () => Promise<void> | void }>
): Promise<void> {
  const promises = updates.map(async ({ chartId, updateFn }) => {
    return chartPerformanceMonitor.measureRenderTime(chartId, updateFn);
  });

  try {
    await Promise.all(promises);
  } catch (error: any) {
    import('@/services/log').then(m => m.default.error('批量更新图表失败', error));
  }
}

/**
 * 图表懒加载管理器
 */
export class ChartLazyLoader {
  observer: IntersectionObserver | null;
  pendingCharts: Map<string, () => Promise<void> | void>;
  loadedCharts: Set<string>;
  constructor() {
    this.observer = null;
    this.pendingCharts = new Map<string, () => Promise<void> | void>();
    this.loadedCharts = new Set<string>();
  }

  /**
   * 初始化懒加载
   */
  init(): void {
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        (entries: IntersectionObserverEntry[]) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const chartId = (entry.target as HTMLElement).dataset.chartId as string;
              this.loadChart(chartId);
            }
          });
        },
        {
          rootMargin: '50px',
          threshold: 0.1
        }
      );
    }
  }

  /**
   * 注册需要懒加载的图表
   * @param {string} chartId - 图表ID
   * @param {HTMLElement} element - 图表容器元素
   * @param {Function} loadFn - 加载函数
   */
  register(chartId: string, element: HTMLElement, loadFn: () => Promise<void> | void): void {
    if (this.loadedCharts.has(chartId)) return;

    this.pendingCharts.set(chartId, loadFn);
    element.dataset.chartId = chartId;

    if (this.observer) {
      this.observer.observe(element);
    } else {
      // 不支持IntersectionObserver时立即加载
      this.loadChart(chartId);
    }
  }

  /**
   * 加载图表
   * @param {string} chartId - 图表ID
   */
  async loadChart(chartId: string): Promise<void> {
    const loadFn = this.pendingCharts.get(chartId);
    if (!loadFn || this.loadedCharts.has(chartId)) return;

    try {
      await loadFn();
      this.loadedCharts.add(chartId);
      this.pendingCharts.delete(chartId);
    } catch (error: any) {
      import('@/services/log').then(m => m.default.error(`懒加载图表 ${chartId} 失败`, error));
    }
  }

  /**
   * 销毁懒加载管理器
   */
  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.pendingCharts.clear();
    this.loadedCharts.clear();
  }
}

/**
 * 图表错误边界
 * @param {Function} chartFn - 图表函数
 * @param {Function} fallbackFn - 降级函数
 * @returns {Function} 包装后的函数
 */
export function withChartErrorBoundary<T extends (...args: any[]) => any>(
  chartFn: T,
  fallbackFn: T | null = null
): (...args: Parameters<T>) => Promise<ReturnType<T> | null> {
  return async function (...args: Parameters<T>) {
    try {
      return await chartFn.apply(undefined as any, args);
    } catch (error: any) {
      import('@/services/log').then(m => m.default.error('图表渲染错误', error));

      if (fallbackFn) {
        try {
          return await fallbackFn.apply(undefined as any, args);
        } catch (fallbackError: any) {
          import('@/services/log').then(m => m.default.error('降级渲染也失败', fallbackError));
        }
      }

      // 返回空的占位符
      return null;
    }
  };
}

/**
 * 内存使用监控
 */
export function monitorMemoryUsage(): { used: number; total: number; limit: number } | null {
  if ('memory' in performance) {
    const memory = (performance as any).memory as {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
    return {
      used: Math.round(memory.usedJSHeapSize / 1024 / 1024),
      total: Math.round(memory.totalJSHeapSize / 1024 / 1024),
      limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024)
    };
  }
  return null;
}

/**
 * 图表数据压缩
 * @param {Array} data - 原始数据
 * @param {number} maxPoints - 最大数据点数
 * @returns {Array} 压缩后的数据
 */
export function compressChartData<T extends number | { value: number }>(
  data: Array<T>,
  maxPoints: number = 100
): Array<T> {
  if (data.length <= maxPoints) return data;

  const step = Math.ceil(data.length / maxPoints);
  const compressed: Array<T> = [] as any;

  for (let i = 0; i < data.length; i += step) {
    const chunk = data.slice(i, i + step);
    if (chunk.length === 1) {
      compressed.push(chunk[0]);
    } else {
      // 计算平均值
      const avg =
        chunk.reduce((sum, item) => {
          if (typeof item === 'number') return sum + item;
          if (typeof item === 'object' && item.value !== undefined) return sum + item.value;
          return sum;
        }, 0) / chunk.length;

      compressed.push(
        (typeof data[0] === 'number' ? (avg as any) : ({ ...(chunk[0] as any), value: avg } as any))
      );
    }
  }

  return compressed;
}

/**
 * 清理图表资源
 * @param {Chart} chart - Chart.js实例
 */
export function cleanupChart(chart: any): void {
  if (chart && typeof chart.destroy === 'function') {
    try {
      chart.destroy();
    } catch (error: any) {
      import('@/services/log').then(m => m.default.warn('清理图表资源时出错', error));
    }
  }
}

// 全局懒加载管理器实例
export const chartLazyLoader = new ChartLazyLoader();

// 在页面加载时初始化
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    chartLazyLoader.init();
  });

  // 页面卸载时清理资源
  window.addEventListener('beforeunload', () => {
    chartPerformanceMonitor.cleanup();
    chartLazyLoader.destroy();
  });
}
