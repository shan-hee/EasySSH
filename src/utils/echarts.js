/**
 * echarts.js
 * ECharts图表工具函数，优化图表初始化和响应式调整
 */

import * as echarts from 'echarts/core';
import log from '../services/log';

/**
 * 带有被动事件监听器的ECharts初始化函数
 * 解决触摸和滚动事件的性能问题
 *
 * @param {HTMLElement} dom - 图表容器DOM元素
 * @param {string|Object} [theme] - 可选的主题
 * @param {Object} [opts] - 初始化选项
 * @returns {echarts.ECharts} ECharts实例
 */
export function initChartWithPassiveEvents(dom, theme = null, opts = {}) {
  if (!dom) {
    log.error('[ECharts] 初始化图表失败: DOM元素不存在');
    return null;
  }

  // 保存原始的addEventListener方法
  const originalAddEventListener = EventTarget.prototype.addEventListener;

  try {
    // 覆盖addEventListener方法，强制添加passive标志
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      // 对于鼠标滚轮和触摸事件，强制设置为passive
      if (
        type === 'mousewheel' ||
        type === 'wheel' ||
        type === 'touchstart' ||
        type === 'touchmove'
      ) {
        let newOptions = options;

        if (typeof options === 'boolean') {
          newOptions = {
            capture: options,
            passive: true
          };
        } else if (typeof options === 'object') {
          newOptions = {
            ...options,
            passive: true
          };
        } else {
          newOptions = {
            passive: true
          };
        }

        return originalAddEventListener.call(this, type, listener, newOptions);
      }

      // 对于其他事件类型，保持原样
      return originalAddEventListener.call(this, type, listener, options);
    };

    // 使用修改后的addEventListener初始化ECharts
    const chart = echarts.init(dom, theme, {
      renderer: 'canvas',
      useDirtyRect: true,
      ...opts
    });

    return chart;
  } catch (error) {
    log.error('[ECharts] 初始化图表失败:', error);
    return null;
  } finally {
    // 恢复原始的addEventListener方法
    EventTarget.prototype.addEventListener = originalAddEventListener;
  }
}

/**
 * 安全地调整图表大小
 * @param {echarts.ECharts|null} chart - ECharts实例
 * @param {Object} [opts] - 调整选项
 * @returns {boolean} 是否成功调整大小
 */
export function safeResizeChart(chart, opts = {}) {
  if (!chart) return false;

  try {
    chart.resize(opts);
    return true;
  } catch (error) {
    // log.error('[ECharts] 调整图表大小失败:', error);不用打印错误
    return false;
  }
}

/**
 * 安全地销毁图表实例
 * @param {echarts.ECharts|null} chart - ECharts实例
 * @returns {boolean} 是否成功销毁
 */
export function safeDisposeChart(chart) {
  if (!chart) return false;

  try {
    chart.dispose();
    return true;
  } catch (error) {
    log.error('[ECharts] 销毁图表失败:', error);
    return false;
  }
}

/**
 * 安全地设置图表选项
 * @param {echarts.ECharts|null} chart - ECharts实例
 * @param {Object} option - 图表选项
 * @param {Object} [opts] - 设置选项
 * @returns {boolean} 是否成功设置
 */
export function safeSetOption(chart, option, opts = {}) {
  if (!chart || !option) return false;

  try {
    chart.setOption(option, opts);
    return true;
  } catch (error) {
    log.error('[ECharts] 设置图表选项失败:', error);
    return false;
  }
}
