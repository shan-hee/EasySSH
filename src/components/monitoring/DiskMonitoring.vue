<template>
  <div class="monitor-section disk-monitoring-section">
    <div class="monitor-header">
      <div class="monitor-title">
        <monitoring-icon name="disk" :size="16" class="disk-icon" />
        <span>硬盘</span>
      </div>
      <div class="monitor-info">
        <div v-if="diskInfo.total" class="disk-usage-info">
          <span class="usage-percentage tabular-nums" :class="getUsageStatusClass(diskUsage)">{{
            formatPercentage(diskUsage)
          }}</span>
          <span class="usage-text tabular-nums"
            >{{ formatBytes(diskInfo.used) }}/{{ formatBytes(diskInfo.total) }}</span
          >
        </div>
      </div>
    </div>

    <div class="monitor-chart-container">
      <!-- 堆叠柱形图 -->
      <div class="chart-item stacked-bar-chart">
        <canvas ref="diskChartRef" class="disk-chart" />
      </div>

      <!-- 统一加载指示器 -->
      <monitoring-loader
        v-if="!componentState.hasData"
        :state="componentState.state"
        :error-message="componentState.error"
        :skeleton-type="'chart'"
        :loading-text="'加载硬盘数据...'"
        @retry="handleRetry"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, markRaw } from 'vue';
import { formatBytes, formatPercentage } from '@/utils/productionFormatters';
import {
  getDiskChartConfig,
  getMonitoringColors,
  watchThemeChange,
  getThemeBackgroundColor
} from '@/utils/chartConfig';
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
const diskChartRef = ref(null);
const chartInstance = ref(null);

// 计算属性
const diskInfo = computed(() => {
  const disk = props.monitoringData?.disk || {};

  // 后端已经返回字节数，无需转换
  const total = disk.total || 0;
  const used = disk.used || 0;
  const free = disk.free || disk.available || 0;

  return {
    total, // 已经是字节
    used, // 已经是字节
    available: free, // 已经是字节
    usedPercentage: disk.usedPercentage || (total > 0 ? (used / total) * 100 : 0)
  };
});

const diskUsage = computed(() => {
  return diskInfo.value.usedPercentage || 0;
});

// 使用传入的状态管理器实例，如果没有则使用全局实例（向后兼容）
const currentStateManager = computed(() => props.stateManager || monitoringStateManager);

// 使用当前状态管理器
const componentState = computed(() => {
  return currentStateManager.value.getComponentState(MonitoringComponent.DISK);
});

const hasData = computed(() => {
  return componentState.value.hasData && diskInfo.value.total > 0;
});

// 重试处理
const handleRetry = () => {
  currentStateManager.value.retry();
};

// 获取使用率状态样式类
const getUsageStatusClass = usage => {
  if (usage >= 95) return 'monitor-status-critical';
  if (usage >= 80) return 'monitor-status-warning';
  return 'monitor-status-normal';
};

// 初始化硬盘图表 - 堆叠柱形图版本
const initChart = async () => {
  await ensureChart();
  await nextTick();

  if (!diskChartRef.value) return;

  const ctx = diskChartRef.value.getContext('2d');

  if (chartInstance.value) {
    chartInstance.value.destroy();
  }

  // 使用配置工具创建硬盘堆叠柱形图
  const config = getDiskChartConfig();

  // 设置初始数据
  const used = diskUsage.value;
  const free = 100 - used;
  const diskColors = getMonitoringColors(used, 'disk');

  config.data.datasets[0].data = [used];
  config.data.datasets[1].data = [free];
  config.data.datasets[0].backgroundColor = diskColors.primary;

  // 设置tooltip回调函数 - 根据悬浮区域显示不同信息
  config.options.plugins.tooltip.callbacks.label = function (context) {
    const datasetIndex = context.datasetIndex;
    const value = context.parsed.x;

    if (datasetIndex === 0) {
      // 悬浮在已用区域 - 显示已用信息
      const usedBytes = diskInfo.value.used || 0;
      return `已用：${value.toFixed(1)}%(${formatBytes(usedBytes)})`;
    } else if (datasetIndex === 1) {
      // 悬浮在可用区域 - 显示可用信息
      const totalBytes = diskInfo.value.total || 0;
      const usedBytes = diskInfo.value.used || 0;
      const freeBytes = totalBytes - usedBytes;
      return `可用：${value.toFixed(1)}%(${formatBytes(freeBytes)})`;
    }

    return null;
  };

  chartInstance.value = markRaw(new Chart(ctx, config));

  // 监听主题变化
  const themeObserver = watchThemeChange(chartInstance.value, () => {
    // 主题变化时只更新颜色相关的配置，不重新创建数据
    const newConfig = getDiskChartConfig();

    // 只更新背景色，保持数据不变
    if (chartInstance.value.data.datasets[1]) {
      chartInstance.value.data.datasets[1].backgroundColor =
        newConfig.data.datasets[1].backgroundColor;
      chartInstance.value.data.datasets[1].borderColor = newConfig.data.datasets[1].borderColor;
    }

    // 更新选项（tooltip颜色等）
    chartInstance.value.options = { ...chartInstance.value.options, ...newConfig.options };
    chartInstance.value.update('none');
  });

  // 柱形图不需要设置数据点，直接完成初始化
  nextTick(() => {
    if (chartInstance.value) {
      chartInstance.value.update('none');
    }
  });

  // 保存观察器引用以便清理
  chartInstance.value._themeObserver = themeObserver;
};

// 更新图表数据 - 堆叠柱形图版本
const updateChart = () => {
  if (!chartInstance.value || !hasData.value) return;

  try {
    const used = diskUsage.value;
    const free = 100 - used;

    // 检查图表实例是否有效
    if (
      !chartInstance.value.data ||
      !chartInstance.value.data.datasets ||
      chartInstance.value.data.datasets.length < 2
    ) {
      console.warn('[硬盘监控] 图表数据结构无效');
      return;
    }

    // 使用硬盘专属颜色工具函数
    const diskColors = getMonitoringColors(used, 'disk');

    // 更新堆叠柱形图数据
    chartInstance.value.data.datasets[0].data = [used]; // 已使用
    chartInstance.value.data.datasets[1].data = [free]; // 可用空间
    chartInstance.value.data.datasets[0].backgroundColor = diskColors.primary;
    // 更新可用空间的背景色，使其主题感知
    chartInstance.value.data.datasets[1].backgroundColor = getThemeBackgroundColor();

    // 更新tooltip回调函数 - 根据悬浮区域显示不同信息
    if (chartInstance.value.options.plugins.tooltip.callbacks) {
      chartInstance.value.options.plugins.tooltip.callbacks.label = function (context) {
        const datasetIndex = context.datasetIndex;
        const value = context.parsed.x;

        if (datasetIndex === 0) {
          // 悬浮在已用区域 - 显示已用信息
          const usedBytes = diskInfo.value.used || 0;
          return `已用：${value.toFixed(1)}%(${formatBytes(usedBytes)})`;
        } else if (datasetIndex === 1) {
          // 悬浮在可用区域 - 显示可用信息
          const totalBytes = diskInfo.value.total || 0;
          const usedBytes = diskInfo.value.used || 0;
          const freeBytes = totalBytes - usedBytes;
          return `可用：${value.toFixed(1)}%(${formatBytes(freeBytes)})`;
        }

        return null;
      };
    }

    // 使用自定义transition模式保持动画
    chartInstance.value.update('dataUpdate');
  } catch (error) {
    console.error('[硬盘监控] 更新图表失败:', error);
  }
};

// 监听数据变化 - 堆叠柱形图支持动态更新
watch(
  () => props.monitoringData?.disk,
  newDisk => {
    if (newDisk && chartInstance.value && hasData.value) {
      try {
        updateChart();
      } catch (error) {
        console.error('[硬盘监控] 更新图表失败:', error);
      }
    }
  },
  { deep: true }
);

// 生命周期
onMounted(() => {
  initChart();
});

onUnmounted(() => {
  if (chartInstance.value) {
    // 清理主题观察器
    if (chartInstance.value._themeObserver) {
      chartInstance.value._themeObserver.disconnect();
    }
    chartInstance.value.destroy();
  }
});
</script>

<style scoped>
/* 导入监控主题样式 */
@import '@/assets/styles/themes/monitoring-theme.css';

/* 硬盘监控组件继承通用监控组件样式 */

.disk-icon {
  color: var(--monitor-disk-primary);
}

/* 硬盘使用信息样式 */
.disk-usage-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  /* gap: 2px; */
}

.usage-text {
  font-size: 11px;
  color: var(--monitor-text-secondary);
  /* 与全局字体保持一致 */
  font-family: var(--font-family-base);
  /* 数字对齐，避免抖动 */
  font-variant-numeric: tabular-nums;
}

.usage-percentage {
  font-size: 14px;
  font-weight: 700;
  color: var(--monitor-disk-primary);
  /* 与全局字体保持一致 */
  font-family: var(--font-family-base);
  /* 数字对齐，避免抖动 */
  font-variant-numeric: tabular-nums;
}

.usage-percentage.monitor-status-warning {
  color: var(--monitor-warning);
}

.usage-percentage.monitor-status-critical {
  color: var(--monitor-error);
}

/* 堆叠柱形图样式 */
.chart-item.stacked-bar-chart {
  position: relative;
  width: 100%;
  height: 50px; /* 水平柱形图高度 */
}

.disk-chart {
  width: 100%;
  height: 100%;
}

/* 确保Chart.js tooltip显示在最上层 */
:deep(.chartjs-tooltip) {
  z-index: var(--z-tooltip) !important;
  position: absolute !important;
}

/* 硬盘监控组件固定高度适配 */
.disk-monitoring-section {
  height: 100%; /* 使用父容器的固定高度 */
  overflow: hidden; /* 防止内容溢出 */
}

.disk-monitoring-section .monitor-chart-container {
  flex: 1; /* 图表容器占用剩余空间 */
  min-height: 0; /* 允许flex子项缩小 */
  display: flex;
  align-items: center; /* 垂直居中 */
}

/* 旧的进度条样式已移除，现在使用堆叠柱形图 */

/* 移除响应式样式，保持桌面端布局 */
</style>
