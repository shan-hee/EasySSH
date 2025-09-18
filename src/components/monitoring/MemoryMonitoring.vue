<template>
  <div class="monitor-section memory-monitoring-section">
    <div class="monitor-header">
      <div class="monitor-title">
        <monitoring-icon name="memory" :size="16" class="memory-icon" />
        <span>内存</span>
      </div>
    </div>

    <div class="monitor-chart-container">
      <div class="memory-chart-layout">
        <!-- 左侧：双圆环嵌套图 -->
        <div class="chart-section">
          <canvas ref="memoryChartRef" class="memory-nested-chart" />
        </div>

        <!-- 右侧：文本和图例 -->
        <div class="info-section">
          <div class="memory-info-item">
            <div class="info-indicator memory-indicator" />
            <div class="info-content">
              <div class="info-label">物理内存</div>
              <div class="info-value tabular-nums">
                {{ formatPercentage(memoryUsage) }}
              </div>
              <div class="info-detail tabular-nums">
                {{ formatBytes(memoryInfo.used) }} / {{ formatBytes(memoryInfo.total) }}
              </div>
            </div>
          </div>

          <div v-if="hasSwap" class="memory-info-item">
            <div class="info-indicator swap-indicator" />
            <div class="info-content">
              <div class="info-label">交换分区</div>
              <div class="info-value tabular-nums">
                {{ formatPercentage(swapUsage) }}
              </div>
              <div class="info-detail tabular-nums">
                {{ formatBytes(swapInfo.used) }} / {{ formatBytes(swapInfo.total) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 统一加载指示器 -->
      <monitoring-loader
        v-if="!componentState.hasData"
        :state="componentState.state"
        :error-message="componentState.error"
        :skeleton-type="'doughnut'"
        :loading-text="'加载内存数据...'"
        @retry="handleRetry"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed, nextTick, markRaw } from 'vue';
import { formatBytes, formatPercentage } from '@/utils/productionFormatters';
import { getCSSVar, watchThemeChange, getThemeBackgroundColor } from '@/utils/chartConfig';
import MonitoringIcon from './MonitoringIcon.vue';
import MonitoringLoader from '../common/MonitoringLoader.vue';
import monitoringStateManager, { MonitoringComponent } from '@/services/monitoringStateManager';

// 按需加载 Chart.js，避免初始包体积过大
let Chart = null;
let registerables = null;
const ensureChart = async () => {
  if (Chart) return;
  const mod = await import('chart.js');
  Chart = mod.Chart;
  registerables = mod.registerables;
  Chart.register(...registerables);
};

// Props
const props = defineProps({
  monitoringData: {
    type: Object,
    default: () => ({})
  },
  stateManager: {
    type: Object,
    default: null
  }
});

// 响应式数据
const memoryChartRef = ref(null);
const memoryChartInstance = ref(null);

// 计算属性
const memoryInfo = computed(() => {
  const memory = props.monitoringData?.memory || {};

  // 后端已经返回字节数，无需转换
  const total = memory.total || 0;
  const used = memory.used || 0;
  const free = memory.free || memory.available || 0;
  const cached = memory.cached || 0;

  return {
    total, // 已经是字节
    used, // 已经是字节
    free, // 已经是字节
    cached, // 已经是字节
    usedPercentage: memory.usedPercentage || (total > 0 ? (used / total) * 100 : 0)
  };
});

const swapInfo = computed(() => {
  const swap = props.monitoringData?.swap || {};

  // 后端已经返回字节数，无需转换
  const total = swap.total || 0;
  const used = swap.used || 0;
  const free = swap.free || 0;

  return {
    total, // 已经是字节
    used, // 已经是字节
    free, // 已经是字节
    usedPercentage: swap.usedPercentage || (total > 0 ? (used / total) * 100 : 0)
  };
});

const memoryUsage = computed(() => {
  return memoryInfo.value.usedPercentage || 0;
});

const swapUsage = computed(() => {
  return swapInfo.value.usedPercentage || 0;
});

const hasSwap = computed(() => {
  return swapInfo.value.total > 0;
});

// 使用传入的状态管理器实例，如果没有则使用全局实例（向后兼容）
const currentStateManager = computed(() => props.stateManager || monitoringStateManager);

// 使用当前状态管理器
const componentState = computed(() => {
  return currentStateManager.value.getComponentState(MonitoringComponent.MEMORY);
});

const hasData = computed(() => {
  return componentState.value.hasData && memoryInfo.value.total > 0;
});

// 重试处理
const handleRetry = () => {
  currentStateManager.value.retry();
};

// 创建双圆环嵌套图表配置
const createNestedDoughnutConfig = () => {
  // 内存监控使用固定颜色，不根据使用率变化
  const isDark =
    document.documentElement.getAttribute('data-theme') === 'dark' ||
    document.documentElement.classList.contains('dark-theme') ||
    (!document.documentElement.getAttribute('data-theme') &&
      !document.documentElement.classList.contains('light-theme') &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const memoryColors = {
    primary: getCSSVar('--monitor-memory-primary'),
    background: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  };
  const swapColors = {
    primary: getCSSVar('--monitor-memory-swap'),
    background: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  };

  return {
    type: 'doughnut',
    data: {
      datasets: [
        // dataset[0] 实际渲染为外圈 - 物理内存
        {
          data: [memoryUsage.value, 100 - memoryUsage.value],
          backgroundColor: [memoryColors.primary, memoryColors.background],
          borderWidth: 0,
          cutout: '50%', // 外圈的内径
          radius: '100%', // 外圈占满整个区域
          label: '物理内存'
        },
        // dataset[1] 实际渲染为内圈 - 交换分区
        {
          data: hasSwap.value ? [swapUsage.value, 100 - swapUsage.value] : [0, 100],
          backgroundColor: hasSwap.value
            ? [swapColors.primary, swapColors.background]
            : ['transparent', 'transparent'],
          borderWidth: 0,
          cutout: '50%', // 内圈的内径
          radius: '100%', // 内圈的外径，与外圈的内径匹配
          label: '交换分区'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          backgroundColor: isDark ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.95)',
          titleColor: isDark ? '#e5e5e5' : '#303133',
          bodyColor: isDark ? '#e5e5e5' : '#303133',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
          borderWidth: 1,
          callbacks: {
            label(context) {
              const datasetLabel = context.dataset.label;
              const value = context.parsed;
              return `${datasetLabel}: ${value.toFixed(1)}%`;
            }
          }
        }
      },
      animation: {
        duration: 300,
        easing: 'easeInOutQuart'
      }
    }
  };
};

// 初始化双圆环图表
const initMemoryChart = async () => {
  await ensureChart();
  await nextTick();

  if (!memoryChartRef.value) return;

  const ctx = memoryChartRef.value.getContext('2d');

  if (memoryChartInstance.value) {
    memoryChartInstance.value.destroy();
  }

  // 创建双圆环嵌套图表
  const config = createNestedDoughnutConfig();
  memoryChartInstance.value = markRaw(new Chart(ctx, config));

  // 监听主题变化
  const themeObserver = watchThemeChange(memoryChartInstance.value, () => {
    // 主题变化时只更新颜色相关的配置，不重新创建数据
    const newConfig = createNestedDoughnutConfig();

    // 只更新背景色，保持数据不变
    if (memoryChartInstance.value.data.datasets[0]) {
      memoryChartInstance.value.data.datasets[0].backgroundColor =
        newConfig.data.datasets[0].backgroundColor;
    }
    if (memoryChartInstance.value.data.datasets[1]) {
      memoryChartInstance.value.data.datasets[1].backgroundColor =
        newConfig.data.datasets[1].backgroundColor;
    }

    // 更新选项（tooltip颜色等）
    memoryChartInstance.value.options = {
      ...memoryChartInstance.value.options,
      ...newConfig.options
    };
    memoryChartInstance.value.update('none');
  });

  // 保存观察器引用以便清理
  memoryChartInstance.value._themeObserver = themeObserver;
};

// 更新双圆环图表数据
const updateCharts = () => {
  try {
    if (memoryChartInstance.value && hasData.value) {
      // 检查图表实例是否有效
      if (!memoryChartInstance.value.data || !memoryChartInstance.value.data.datasets) {
        console.warn('[内存监控] 图表数据结构无效');
        return;
      }

      const memUsed = memoryUsage.value;
      const memFree = 100 - memUsed;
      const swapUsed = swapUsage.value;
      const swapFree = 100 - swapUsed;

      // 更新外圈（物理内存）数据 - dataset[0] - 使用主题感知颜色
      if (memoryChartInstance.value.data.datasets[0]) {
        const memoryColors = {
          primary: getCSSVar('--monitor-memory-primary'),
          background: getThemeBackgroundColor()
        };
        memoryChartInstance.value.data.datasets[0].data = [memUsed, memFree];
        memoryChartInstance.value.data.datasets[0].backgroundColor = [
          memoryColors.primary,
          memoryColors.background
        ];
      }

      // 更新内圈（交换分区）数据 - dataset[1] - 使用主题感知颜色
      if (memoryChartInstance.value.data.datasets[1]) {
        if (hasSwap.value) {
          const swapColors = {
            primary: getCSSVar('--monitor-memory-swap'),
            background: getThemeBackgroundColor()
          };
          memoryChartInstance.value.data.datasets[1].data = [swapUsed, swapFree];
          memoryChartInstance.value.data.datasets[1].backgroundColor = [
            swapColors.primary,
            swapColors.background
          ];
        } else {
          memoryChartInstance.value.data.datasets[1].data = [0, 100];
          memoryChartInstance.value.data.datasets[1].backgroundColor = [
            'transparent',
            'transparent'
          ];
        }
      }

      memoryChartInstance.value.update('none');
    }
  } catch (error) {
    console.error('[内存监控] 更新图表失败:', error);
  }
};

// 暂时禁用自动更新，避免Chart.js错误
// 监听数据变化 - 只监听关键字段避免循环引用
// let updateTimer = null
// watch(() => [props.monitoringData?.memory, props.monitoringData?.swap], ([newMemory, newSwap]) => {
//   // 防抖处理，避免频繁更新
//   if (updateTimer) {
//     clearTimeout(updateTimer)
//   }

//   updateTimer = setTimeout(() => {
//     if ((newMemory || newSwap) && (memoryChartInstance.value || swapChartInstance.value)) {
//       updateCharts()
//     }
//     updateTimer = null
//   }, 100) // 100ms防抖
// }, { deep: true })

// 监听数据变化，重新创建图表以更新双圆环结构
watch(
  () => [memoryUsage.value, swapUsage.value, hasSwap.value],
  () => {
    if (memoryChartInstance.value) {
      updateCharts();
    }
  },
  { immediate: false }
);

// 生命周期
onMounted(() => {
  initMemoryChart();
});

onUnmounted(() => {
  if (memoryChartInstance.value) {
    // 清理主题观察器
    if (memoryChartInstance.value._themeObserver) {
      memoryChartInstance.value._themeObserver.disconnect();
    }
    memoryChartInstance.value.destroy();
  }
});
</script>

<style scoped>
/* 导入监控主题样式 */
@import '@/assets/styles/themes/monitoring-theme.css';

/* 内存监控组件继承通用监控组件样式 */

.memory-icon {
  color: var(--monitor-memory-primary);
}

.memory-capacity-info {
  font-size: 11px;
  color: var(--monitor-text-secondary);
  padding: var(--monitor-spacing-xs);
  background: var(--monitor-bg-secondary);
  border-radius: var(--monitor-radius-sm);
}

.memory-chart-layout {
  display: flex;
  align-items: center;
  height: 100%;
  min-height: 0; /* 允许缩小 */
  padding: 8px; /* 添加内边距，为悬浮提示留空间 */
  overflow: visible; /* 确保悬浮提示可以显示 */
  width: 100%;
  box-sizing: border-box;
  /* 中心分割策略：左右两边平分空间 */
  position: relative;
}

/* 中心分割线（可选，用于调试布局） */
.memory-chart-layout::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 10%;
  bottom: 10%;
  width: 1px;
  background: rgba(var(--monitor-border-color-rgb), 0.1);
  transform: translateX(-50%);
  pointer-events: none;
  /* 可以通过注释这个伪元素来隐藏分割线 */
  display: none; /* 隐藏分割线，布局调试完成 */
}

.chart-section {
  /* 左半区域：图表向右对齐（靠近中心） */
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end; /* 图表向右对齐，靠近中心分割线 */
  padding-right: calc(var(--monitor-spacing-lg) / 2); /* 到中心的间距 */
  position: relative; /* 为悬浮提示定位 */
  overflow: visible; /* 确保悬浮提示可以显示 */
}
.memory-nested-chart {
  width: 100%;
  height: 100px; /* 固定高度 */
}

.info-section {
  /* 右半区域：信息向左对齐（靠近中心） */
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center; /* 垂直居中 */
  align-items: flex-start; /* 信息向左对齐，靠近中心分割线 */
  gap: var(--monitor-spacing-sm);
  min-height: 0; /* 允许缩小 */
  overflow: hidden; /* 防止溢出 */
  padding-left: calc(var(--monitor-spacing-lg) / 2); /* 到中心的间距 */
}

.memory-info-item {
  display: flex;
  align-items: center;
  gap: var(--monitor-spacing-xs); /* 减小间距 */
  margin-bottom: var(--monitor-spacing-xs); /* 减小底部间距 */
}

.info-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.memory-indicator {
  background-color: var(--monitor-memory-primary);
}

.swap-indicator {
  background-color: var(--monitor-memory-swap);
}

.info-content {
  flex: 1;
  min-height: 0; /* 允许缩小 */
}

.info-label {
  font-size: 10px; /* 缩小字体 */
  color: var(--monitor-text-secondary);
  margin-bottom: 1px; /* 减小间距 */
  line-height: 1.2; /* 紧凑行高 */
}

.info-value {
  font-size: 14px; /* 缩小字体 */
  font-weight: 700;
  color: var(--monitor-text-primary);
  /* 使用全局基础字体栈，保持与全局一致 */
  font-family: var(--font-family-base);
  margin-bottom: 1px;
  line-height: 1.2; /* 紧凑行高 */
  /* 数字对齐，避免抖动 */
  font-variant-numeric: tabular-nums;
}

.info-detail {
  font-size: 9px; /* 缩小字体 */
  color: var(--monitor-text-secondary);
  /* 使用全局基础字体栈，保持与全局一致 */
  font-family: var(--font-family-base);
  line-height: 1.2; /* 紧凑行高 */
  /* 数字对齐，避免抖动 */
  font-variant-numeric: tabular-nums;
}

/* 内存监控组件固定高度适配 */
.memory-monitoring-section {
  height: 100%; /* 使用父容器的固定高度 */
  overflow: hidden; /* 防止内容溢出 */
}

.memory-monitoring-section .monitor-chart-container {
  flex: 1; /* 图表容器占用剩余空间 */
  min-height: 0; /* 允许flex子项缩小 */
}

/* 移除响应式样式，保持桌面端布局 */
</style>
