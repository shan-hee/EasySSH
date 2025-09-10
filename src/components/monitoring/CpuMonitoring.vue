<template>
  <div class="monitor-section cpu-monitoring-section">
    <div class="monitor-header">
      <div class="monitor-title">
        <monitoring-icon name="cpu" :size="16" class="cpu-icon" />
        <span>CPU</span>
      </div>
      <div class="monitor-info">
        <div class="cpu-stats">
          <span class="usage-value">{{ formatPercentage(currentUsage) }}</span>
          <span v-if="cpuCores > 0" class="cores-info">{{ cpuCores }}核</span>
        </div>
      </div>
    </div>

    <div class="monitor-chart-container">
      <canvas v-show="componentState.hasData" ref="cpuChartRef" class="cpu-chart" />

      <!-- 统一加载指示器 -->
      <monitoring-loader
        v-if="!componentState.hasData"
        :state="componentState.state"
        :error-message="componentState.error"
        :skeleton-type="'chart'"
        :loading-text="'加载CPU数据...'"
        @retry="handleRetry"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick, markRaw, watch } from 'vue';
import { Chart, registerables } from 'chart.js';
import { formatPercentage } from '@/utils/productionFormatters';
import { getCpuChartConfig, getMonitoringColors, watchThemeChange } from '@/utils/chartConfig';
import MonitoringIcon from './MonitoringIcon.vue';
import MonitoringLoader from '../common/MonitoringLoader.vue';
import monitoringConfigManager from '@/services/monitoringConfigManager';
import monitoringStateManager, { MonitoringComponent } from '@/services/monitoringStateManager';

// 注册Chart.js组件
Chart.register(...registerables);

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
const cpuChartRef = ref(null);
const chartInstance = ref(null);
// 真实历史数据记录
let historyData = [];
const maxDataPoints = 10;
// 当前更新间隔
const currentUpdateInterval = ref(1000);
// 上次CPU使用率，用于检测变化
let lastCpuUsage = 0;
// 防抖定时器
let debounceTimer = null;
// 动画状态标记，避免动画冲突
let isAnimating = false;

// 计算属性
const currentUsage = computed(() => {
  const cpu = props.monitoringData?.cpu;
  if (!cpu) return 0;

  // 兼容不同的数据格式
  return cpu.usage || cpu.usedPercentage || 0;
});

// CPU核心数
const cpuCores = computed(() => {
  const cpu = props.monitoringData?.cpu;
  if (!cpu) return 0;

  return cpu.cores || 0;
});

// 使用传入的状态管理器实例，如果没有则使用全局实例（向后兼容）
const currentStateManager = computed(() => props.stateManager || monitoringStateManager);

// 使用当前状态管理器
const componentState = computed(() => {
  return currentStateManager.value.getComponentState(MonitoringComponent.CPU);
});

// 旧的 hasData 计算未使用，移除以降低噪音

// 初始化图表 - 静态版本避免响应式冲突
const initChart = async () => {
  await nextTick();

  if (!cpuChartRef.value) return;

  try {
    const ctx = cpuChartRef.value.getContext('2d');

    // 销毁现有图表
    if (chartInstance.value) {
      chartInstance.value.destroy();
    }

    // 使用简化的配置工具创建图表
    const config = getCpuChartConfig();

    // 添加当前数据点到历史记录
    const currentCpuUsage = currentUsage.value || 0;
    const now = new Date();
    const timeLabel = now.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // 只在初始化时添加当前数据点
    if (historyData.length === 0) {
      historyData.push({
        time: timeLabel,
        value: currentCpuUsage,
        timestamp: now.getTime()
      });
    }

    // 使用真实历史数据
    const labels = historyData.map(item => item.time);
    const data = historyData.map(item => item.value);

    config.data.labels = labels;
    config.data.datasets[0].data = data;

    // 根据当前使用率设置CPU专属颜色
    const cpuColors = getMonitoringColors(currentCpuUsage, 'cpu');
    config.data.datasets[0].borderColor = cpuColors.primary;
    config.data.datasets[0].pointBackgroundColor = cpuColors.primary;
    config.data.datasets[0].pointBorderColor = '#ffffff';
    config.data.datasets[0].pointBorderWidth = 1;
    config.data.datasets[0].pointRadius = 0; // 默认不显示点
    config.data.datasets[0].pointHoverRadius = 3; // 悬浮时显示小点
    config.data.datasets[0].pointHoverBackgroundColor = cpuColors.primary;
    config.data.datasets[0].pointHoverBorderColor = '#ffffff';
    config.data.datasets[0].pointHoverBorderWidth = 1;

    // 创建渐变背景
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, `${cpuColors.primary}CC`);
    gradient.addColorStop(1, `${cpuColors.primary}33`);
    config.data.datasets[0].backgroundColor = gradient;

    // 使用 markRaw 防止 Chart.js 实例被 Vue 响应式系统追踪
    chartInstance.value = markRaw(new Chart(ctx, config));

    // 监听主题变化
    const themeObserver = watchThemeChange(chartInstance.value, () => {
      // 主题变化时重新获取配置并更新图表
      const newConfig = getCpuChartConfig();
      chartInstance.value.options = { ...chartInstance.value.options, ...newConfig.options };
      chartInstance.value.update('none');
    });

    // 简单确保数据点隐藏（transition配置会处理动画时的隐藏）
    nextTick(() => {
      if (chartInstance.value && chartInstance.value.data.datasets[0]) {
        chartInstance.value.data.datasets[0].pointRadius = 0;
        chartInstance.value.data.datasets[0].pointHoverRadius = 3;
        chartInstance.value.update('none');
      }
    });

    // 保存观察器引用以便清理
    chartInstance.value._themeObserver = themeObserver;
  } catch (error) {
    console.error('[CPU监控] 初始化图表失败:', error);
  }
};

// 增量更新图表数据（性能优化版本）
const updateChartData = () => {
  if (!chartInstance.value || !cpuChartRef.value) return;

  const currentCpuUsage = currentUsage.value || 0;

  // 检测数据是否真正发生变化
  if (Math.abs(currentCpuUsage - lastCpuUsage) < 0.1) {
    return; // 变化太小，跳过更新
  }

  try {
    const now = new Date();
    const timeLabel = now.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // 添加新数据点到历史记录
    historyData.push({
      time: timeLabel,
      value: currentCpuUsage,
      timestamp: now.getTime()
    });

    // 限制数据点数量
    if (historyData.length > maxDataPoints) {
      historyData = historyData.slice(-maxDataPoints);
    }

    // 更新图表数据
    const labels = historyData.map(item => item.time);
    const data = historyData.map(item => item.value);

    chartInstance.value.data.labels = labels;
    chartInstance.value.data.datasets[0].data = data;

    // 根据当前使用率更新CPU专属颜色
    const cpuColors = getMonitoringColors(currentCpuUsage, 'cpu');
    chartInstance.value.data.datasets[0].borderColor = cpuColors.primary;
    chartInstance.value.data.datasets[0].pointBackgroundColor = cpuColors.primary;
    chartInstance.value.data.datasets[0].pointHoverBackgroundColor = cpuColors.primary;

    // 更新渐变背景
    const ctx = cpuChartRef.value.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, `${cpuColors.primary}CC`);
    gradient.addColorStop(1, `${cpuColors.primary}33`);
    chartInstance.value.data.datasets[0].backgroundColor = gradient;

    // 使用自定义transition模式：既有动画又隐藏数据点
    if (!isAnimating) {
      isAnimating = true;
      chartInstance.value.update('dataUpdate');
      // 动画完成后重置标记
      setTimeout(() => {
        isAnimating = false;
      }, 400); // 与动画时长一致
    }

    // 强制重新设置数据点配置（多层级确保生效）
    chartInstance.value.data.datasets[0].pointRadius = 0; // 默认不显示
    chartInstance.value.data.datasets[0].pointHoverRadius = 3; // 悬浮时显示小点
    chartInstance.value.data.datasets[0].pointBorderWidth = 1;
    chartInstance.value.data.datasets[0].pointHoverBorderWidth = 1;

    // 同时在options级别强制设置
    if (chartInstance.value.options.elements && chartInstance.value.options.elements.point) {
      chartInstance.value.options.elements.point.radius = 0;
      chartInstance.value.options.elements.point.hoverRadius = 3;
    }

    // 更新上次使用率
    lastCpuUsage = currentCpuUsage;
  } catch (error) {
    console.error('[CPU监控] 增量更新图表失败:', error);
  }
};

// 定期更新图表数据
let updateInterval = null;

const startPeriodicUpdate = () => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }

  updateInterval = setInterval(() => {
    if (cpuChartRef.value && chartInstance.value && currentUsage.value >= 0) {
      try {
        // 使用增量更新而不是重新初始化
        updateChartData();
      } catch (error) {
        console.error('[CPU监控] 定时更新图表失败:', error);
      }
    }
  }, currentUpdateInterval.value); // 使用动态配置的更新间隔
};

const stopPeriodicUpdate = () => {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
};

// 配置变更监听器
let configListener = null;

// 初始化监控配置
const initMonitoringConfig = async () => {
  try {
    // 初始化配置管理器
    await monitoringConfigManager.init();

    // 获取当前配置
    const config = monitoringConfigManager.getConfig();
    currentUpdateInterval.value = config.updateInterval;

    // 添加配置变更监听器
    configListener = newConfig => {
      const oldInterval = currentUpdateInterval.value;
      currentUpdateInterval.value = newConfig.updateInterval;

      // 如果间隔发生变化，重新启动定期更新
      if (oldInterval !== newConfig.updateInterval) {
        console.log(`[CPU监控] 更新间隔变更: ${oldInterval}ms → ${newConfig.updateInterval}ms`);

        // 清空历史数据，重新初始化图表以适应新的时间间隔
        historyData = [];
        lastCpuUsage = 0;

        stopPeriodicUpdate();

        // 重新初始化图表以适应新的时间间隔
        setTimeout(() => {
          initChart();
          startPeriodicUpdate();
        }, 100);
      }
    };

    monitoringConfigManager.addListener(configListener);
  } catch (error) {
    console.error('[CPU监控] 初始化监控配置失败:', error);
    // 使用默认值
    currentUpdateInterval.value = 1000;
  }
};

// 监听CPU使用率变化，实现响应式更新
watch(
  () => currentUsage.value,
  (newUsage, oldUsage) => {
    // 只有在图表已初始化且数据真正变化时才更新
    if (chartInstance.value && Math.abs(newUsage - (oldUsage || 0)) >= 0.1) {
      // 使用防抖避免过于频繁的更新
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        updateChartData();
      }, 100);
    }
  },
  { immediate: false }
);

// 重试处理
const handleRetry = () => {
  currentStateManager.value.retry();
};

// 生命周期
onMounted(async () => {
  // 先初始化监控配置
  await initMonitoringConfig();

  // 然后初始化图表和定期更新
  initChart();
  startPeriodicUpdate();
});

onUnmounted(() => {
  stopPeriodicUpdate();

  // 清理防抖定时器
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  // 移除配置监听器
  if (configListener) {
    monitoringConfigManager.removeListener(configListener);
    configListener = null;
  }

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

/* CPU监控组件继承通用监控组件样式 */

.cpu-icon {
  color: var(--monitor-cpu-primary);
}

.cpu-stats {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.usage-value {
  color: var(--monitor-cpu-primary);
  font-weight: 600;
  font-size: 14px;
  line-height: 1;
}

.cores-info {
  font-size: 12px;
  color: var(--monitor-text-secondary);
  opacity: 0.8;
  line-height: 1;
}

.cpu-cores-info {
  font-size: 11px;
  color: var(--monitor-text-secondary);
  padding: var(--monitor-spacing-xs);
  background: var(--monitor-bg-secondary);
  border-radius: var(--monitor-radius-sm);
}

.cpu-chart {
  width: 100%;
  height: var(--monitor-chart-height-md);
}

/* CPU监控组件固定高度适配 */
.cpu-monitoring-section {
  height: 100%; /* 使用父容器的固定高度 */
  overflow: hidden; /* 防止内容溢出 */
}

.cpu-monitoring-section .monitor-chart-container {
  flex: 1; /* 图表容器占用剩余空间 */
  min-height: 0; /* 允许flex子项缩小 */
}

/* 旧样式已移除，使用统一的监控主题样式 */

/* 移除响应式样式，保持桌面端布局 */
</style>
