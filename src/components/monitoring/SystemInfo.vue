<template>
  <div class="system-info-section">
    <!-- 系统信息标题 -->
    <div class="monitor-header">
      <div class="monitor-title">
        <monitoring-icon name="system-info" :size="16" class="system-icon" />
        <span>系统信息</span>
      </div>
    </div>

    <!-- 统一加载指示器 -->
    <monitoring-loader
      v-if="!componentState.hasData"
      :state="componentState.state"
      :error-message="componentState.error"
      :skeleton-type="'info'"
      :loading-text="'加载系统信息...'"
      @retry="handleRetry"
    />

    <div v-show="componentState.hasData" class="info-grid">
      <div v-if="systemInfo.os" class="info-item">
        <span class="info-label">系统类型</span>
        <span
          class="info-value tabular-nums"
          @mouseenter="onValueMouseEnter($event, systemInfo.os)"
          @mouseleave="onValueMouseLeave"
        >
          {{ systemInfo.os }}
        </span>
        <button
          class="copy-btn"
          :aria-label="`复制系统类型`"
          @click="onCopy(systemInfo.os, '系统类型')"
        >
          <icon icon="mynaui:copy-solid" width="14" height="14" />
        </button>
      </div>

      <div v-if="systemInfo.hostname" class="info-item">
        <span class="info-label">主机名</span>
        <span
          class="info-value tabular-nums"
          @mouseenter="onValueMouseEnter($event, systemInfo.hostname)"
          @mouseleave="onValueMouseLeave"
        >
          {{ systemInfo.hostname }}
        </span>
        <button
          class="copy-btn"
          :aria-label="`复制主机名`"
          @click="onCopy(systemInfo.hostname, '主机名')"
        >
          <icon icon="mynaui:copy-solid" width="14" height="14" />
        </button>
      </div>

      <div v-if="systemInfo.cpuModel" class="info-item">
        <span class="info-label">CPU型号</span>
        <span
          class="info-value tabular-nums"
          @mouseenter="onValueMouseEnter($event, systemInfo.cpuModel)"
          @mouseleave="onValueMouseLeave"
        >
          {{ systemInfo.cpuModel }}
        </span>
        <button
          class="copy-btn"
          :aria-label="`复制CPU型号`"
          @click="onCopy(systemInfo.cpuModel, 'CPU型号')"
        >
          <icon icon="mynaui:copy-solid" width="14" height="14" />
        </button>
      </div>

      <div v-if="systemInfo.architecture" class="info-item">
        <span class="info-label">系统架构</span>
        <span
          class="info-value tabular-nums"
          @mouseenter="onValueMouseEnter($event, systemInfo.architecture)"
          @mouseleave="onValueMouseLeave"
        >
          {{ systemInfo.architecture }}
        </span>
        <button
          class="copy-btn"
          :aria-label="`复制系统架构`"
          @click="onCopy(systemInfo.architecture, '系统架构')"
        >
          <icon icon="mynaui:copy-solid" width="14" height="14" />
        </button>
      </div>

      <!-- CPU核心信息已隐藏 -->

      <div v-if="systemInfo.loadAverage" class="info-item">
        <span class="info-label">系统负载</span>
        <span
          class="info-value tabular-nums"
          @mouseenter="onValueMouseEnter($event, formatLoadAverage(systemInfo.loadAverage))"
          @mouseleave="onValueMouseLeave"
        >
          {{ formatLoadAverage(systemInfo.loadAverage) }}
        </span>
        <button
          class="copy-btn"
          :aria-label="`复制系统负载`"
          @click="onCopy(formatLoadAverage(systemInfo.loadAverage), '系统负载')"
        >
          <icon icon="mynaui:copy-solid" width="14" height="14" />
        </button>
      </div>

      <div v-if="systemInfo.uptime" class="info-item">
        <span class="info-label">运行时间</span>
        <span
          class="info-value tabular-nums"
          @mouseenter="onValueMouseEnter($event, formatUptime(systemInfo.uptime))"
          @mouseleave="onValueMouseLeave"
        >
          {{ formatUptime(systemInfo.uptime) }}
        </span>
        <button
          class="copy-btn"
          :aria-label="`复制运行时间`"
          @click="onCopy(formatUptime(systemInfo.uptime), '运行时间')"
        >
          <icon icon="mynaui:copy-solid" width="14" height="14" />
        </button>
      </div>

      <div v-if="systemInfo.bootTime" class="info-item">
        <span class="info-label">启动时间</span>
        <span
          class="info-value tabular-nums"
          @mouseenter="onValueMouseEnter($event, formatDateTime(systemInfo.bootTime))"
          @mouseleave="onValueMouseLeave"
        >
          {{ formatDateTime(systemInfo.bootTime) }}
        </span>
        <button
          class="copy-btn"
          :aria-label="`复制启动时间`"
          @click="onCopy(formatDateTime(systemInfo.bootTime), '启动时间')"
        >
          <icon icon="mynaui:copy-solid" width="14" height="14" />
        </button>
      </div>

      <div v-if="systemInfo.internalIp" class="info-item">
        <span class="info-label">内网IP</span>
        <span
          class="info-value tabular-nums"
          @mouseenter="onValueMouseEnter($event, systemInfo.internalIp)"
          @mouseleave="onValueMouseLeave"
        >
          {{ systemInfo.internalIp }}
        </span>
        <button
          class="copy-btn"
          :aria-label="`复制内网IP`"
          @click="onCopy(systemInfo.internalIp, '内网IP')"
        >
          <icon icon="mynaui:copy-solid" width="14" height="14" />
        </button>
      </div>

      <div v-if="systemInfo.publicIp" class="info-item">
        <span class="info-label">公网IP</span>
        <span
          class="info-value tabular-nums"
          @mouseenter="onValueMouseEnter($event, systemInfo.publicIp)"
          @mouseleave="onValueMouseLeave"
        >
          {{ systemInfo.publicIp }}
        </span>
        <button
          class="copy-btn"
          :aria-label="`复制公网IP`"
          @click="onCopy(systemInfo.publicIp, '公网IP')"
        >
          <icon icon="mynaui:copy-solid" width="14" height="14" />
        </button>
      </div>
    </div>

    <!-- 自定义信息悬浮提示：与工具栏风格一致，按需显示 -->
    <teleport to="body">
      <div
        v-if="showInfoTooltip"
        ref="infoTooltipRef"
        class="info-tooltip"
        :class="infoTooltipPlacement === 'top' ? 'info-tooltip--top' : 'info-tooltip--bottom'"
        :style="infoTooltipStyle"
        @mouseenter="onTooltipMouseEnter"
        @mouseleave="onTooltipMouseLeave"
      >
        {{ infoTooltipText }}
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, nextTick } from 'vue';
import { Icon } from '@iconify/vue';
import MonitoringIcon from './MonitoringIcon.vue';
import MonitoringLoader from '../common/MonitoringLoader.vue';
import monitoringStateManager, { MonitoringComponent } from '@/services/monitoringStateManager';
import { copyToClipboard } from '@/services/utils.js';

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

// 使用传入的状态管理器实例，如果没有则使用全局实例（向后兼容）
const currentStateManager = computed(() => props.stateManager || monitoringStateManager);

// 使用当前状态管理器
const componentState = computed(() => {
  return currentStateManager.value.getComponentState(MonitoringComponent.SYSTEM_INFO);
});

// 重试处理
const handleRetry = () => {
  currentStateManager.value.retry();
};

// 复制功能
const onCopy = (value, _label = '') => {
  if (value === undefined || value === null) return;
  try {
    copyToClipboard(String(value), true);
  } catch (e) {
    // 忽略异常，copyToClipboard 内部已处理提示
  }
};


// 自定义信息悬浮提示（替代原生title）
const showInfoTooltip = ref(false);
const infoTooltipHover = ref(false);
const infoTooltipText = ref('');
const infoTooltipRef = ref(null);
const infoTooltipPlacement = ref('top'); // 固定上方展示
const infoTooltipStyle = ref({
  position: 'fixed',
  zIndex: 10000,
  top: '0px',
  left: '0px',
  display: 'none'
});
let hideTimer = null;

const updateInfoTooltipPosition = targetEl => {
  if (!targetEl) return;
  const rect = targetEl.getBoundingClientRect();
  const tooltipOffsetStr =
    getComputedStyle(document.documentElement).getPropertyValue('--tooltip-offset').trim() ||
    '10px';
  const arrowSizeStr =
    getComputedStyle(document.documentElement).getPropertyValue('--tooltip-arrow-size').trim() ||
    '5px';
  const offset = parseInt(tooltipOffsetStr) || 10;
  const arrowSize = parseInt(arrowSizeStr) || 5;

  // 初始：固定在目标元素上方（下一帧用实际尺寸校正）
  infoTooltipPlacement.value = 'top';
  infoTooltipStyle.value = {
    position: 'fixed',
    zIndex: 10000,
    backgroundColor: 'var(--tooltip-bg)',
    color: 'var(--tooltip-color)',
    padding: 'var(--tooltip-padding-vertical) var(--tooltip-padding-horizontal)',
    borderRadius: 'var(--tooltip-border-radius)',
    fontFamily: 'var(--tooltip-font-family)',
    fontSize: 'var(--tooltip-font-size)',
    fontWeight: 'var(--tooltip-font-weight)',
    lineHeight: 'var(--tooltip-line-height)',
    whiteSpace: 'nowrap',
    maxWidth: 'var(--tooltip-max-width)',
    boxShadow: 'var(--tooltip-shadow)',
    top: `${rect.top - arrowSize}px`,
    left: `${rect.left + rect.width / 2}px`,
    transform: 'none'
  };

  // 下一帧测量尺寸并修正（保持在上方）
  nextTick(() => {
    const el = infoTooltipRef.value;
    if (!el) return;
    const ttRect = el.getBoundingClientRect();
    const viewportW = window.innerWidth || document.documentElement.clientWidth;
    const margin = 8; // 左右留白

    // 让箭头尖端贴近文本顶边，避免产生可见空隙
    let top = rect.top - ttRect.height - arrowSize;
    if (top < margin) top = margin; // 若越界，贴近上边缘

    // 水平居中并做边界裁剪
    let left = rect.left + rect.width / 2 - ttRect.width / 2;
    if (left < margin) left = margin;
    if (left + ttRect.width > viewportW - margin) left = viewportW - margin - ttRect.width;

    infoTooltipStyle.value = {
      ...infoTooltipStyle.value,
      top: `${top}px`,
      left: `${left}px`,
      transform: 'none'
    };
  });
};

// 仅当元素真正被 CSS 省略号截断时显示（系统加的 ...）
const shouldShowTooltip = (el /*, text */) => {
  if (!el) return false;
  try {
    const style = window.getComputedStyle(el);
    const usesEllipsis = (style.textOverflow || '').includes('ellipsis');
    const noWrap = (style.whiteSpace || '').includes('nowrap');
    const hiddenOverflow = (style.overflow || '').includes('hidden') ||
      (style.overflowX || '').includes('hidden');
    const truncated = el.scrollWidth - el.clientWidth > 1; // 容差1px
    return usesEllipsis && noWrap && hiddenOverflow && truncated;
  } catch {
    return false;
  }
};

const onValueMouseEnter = (evt, text) => {
  const target = evt.currentTarget;
  // 仅在需要时显示
  if (!shouldShowTooltip(target, text)) return;
  infoTooltipText.value = String(text ?? '');
  // 清除潜在隐藏定时器，避免闪烁
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  showInfoTooltip.value = true;
  updateInfoTooltipPosition(target);
};

const scheduleHide = () => {
  if (hideTimer) clearTimeout(hideTimer);
  if (!infoTooltipHover.value) {
    showInfoTooltip.value = false;
  }
};

const onValueMouseLeave = evt => {
  const nextEl = evt?.relatedTarget;
  if (infoTooltipRef.value && nextEl && infoTooltipRef.value.contains(nextEl)) {
    return; // 移入提示框时不隐藏
  }
  showInfoTooltip.value = false;
};

const onTooltipMouseEnter = () => {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  infoTooltipHover.value = true;
};

const onTooltipMouseLeave = () => {
  infoTooltipHover.value = false;
  showInfoTooltip.value = false; // 立即隐藏
};

// 窗口尺寸变化时更新位置（简单处理：隐藏，避免误位移）
const handleResize = () => {
  showInfoTooltip.value = false;
};

onMounted(() => {
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  if (hideTimer) clearTimeout(hideTimer);
});


// 系统信息数据
const systemInfo = computed(() => {
  const data = props.monitoringData;

  // 监控数据处理（不输出日志，用户可在WebSocket中查看）

  return {
    // 操作系统信息 - 新格式
    os: data.os?.release || data.os?.platform || data.system?.os || '',
    hostname: data.os?.hostname || data.system?.hostname || '',
    architecture: data.os?.arch || data.system?.arch || data.system?.architecture || '',

    // CPU信息 - 从cpu对象获取
    cpuModel: data.cpu?.model || data.system?.cpu_model || '',
    cpuCores: data.cpu?.cores || data.system?.cpu_cores || '',

    // 系统负载 - 从cpu.loadAverage获取
    loadAverage: data.cpu?.loadAverage || data.system?.load_average || data.system?.loadavg || '',

    // 运行时间和启动时间 - 从os对象获取
    uptime: data.os?.uptime || data.system?.uptime || '',
    bootTime: data.os?.bootTime || data.system?.boot_time || data.system?.bootTime || '',

    // IP地址信息 - 新增
    internalIp: data.ip?.internal || '',
    publicIp: data.ip?.public || ''
  };
});

// 格式化负载平均值
const formatLoadAverage = loadAvg => {
  if (!loadAvg) return '-';

  // 处理对象格式 {load1: 2.5, load5: 0.98, load15: 0.48}
  if (typeof loadAvg === 'object' && !Array.isArray(loadAvg)) {
    const load1 = parseFloat(loadAvg.load1 || 0).toFixed(2);
    const load5 = parseFloat(loadAvg.load5 || 0).toFixed(2);
    const load15 = parseFloat(loadAvg.load15 || 0).toFixed(2);
    return `${load1}, ${load5}, ${load15}`;
  }

  // 处理数组格式
  if (Array.isArray(loadAvg)) {
    return loadAvg
      .slice(0, 3)
      .map(val => parseFloat(val).toFixed(2))
      .join(', ');
  }

  // 处理字符串格式
  if (typeof loadAvg === 'string') {
    return loadAvg;
  }

  // 处理单个数值
  return parseFloat(loadAvg).toFixed(2);
};

// 格式化运行时间
const formatUptime = uptime => {
  if (!uptime) return '-';

  const seconds = parseInt(uptime);
  if (isNaN(seconds)) return uptime;

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}天 ${hours}小时 ${minutes}分钟`;
  } else if (hours > 0) {
    return `${hours}小时 ${minutes}分钟`;
  } else {
    return `${minutes}分钟`;
  }
};

// 格式化日期时间
const formatDateTime = timestamp => {
  if (!timestamp) return '-';

  try {
    const date = new Date(timestamp * 1000); // 假设是Unix时间戳
    if (isNaN(date.getTime())) {
      // 如果不是时间戳，尝试直接解析
      const directDate = new Date(timestamp);
      if (isNaN(directDate.getTime())) return timestamp;
      return directDate.toLocaleString('zh-CN');
    }
    return date.toLocaleString('zh-CN');
  } catch (error) {
    return timestamp;
  }
};
</script>

<style scoped>
/* 导入监控主题样式，确保主题变量可用 */
@import '@/assets/styles/themes/monitoring-theme.css';
.system-info-section {
  /* 移除装饰样式，保持简洁 */
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 12px;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  width: 100%;
  flex-shrink: 0;
  height: 100%; /* 使用父容器的固定高度 */
  overflow: hidden; /* 防止内容溢出 */
  margin-bottom: 0;
}

.monitor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--monitor-header-spacing, 10px); /* 统一使用主题变量 */
  flex-shrink: 0;
}

.monitor-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--monitor-text-primary, var(--color-text-primary, #e5e5e5));
}

.system-icon {
  font-size: 16px;
  color: #3b82f6;
}

.info-grid {
  display: flex;
  flex-direction: column;
  /* gap: 3px; */
  flex: 1;
}

.info-item {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  border-radius: 0; /* 移除圆角 */
  flex-shrink: 0;
  min-height: 20px; /* 减小最小高度 */
  margin-bottom: 2px; /* 添加小间距 */
  gap: 8px; /* 添加标签和值之间的间距 */
}

.info-label {
  font-size: 12px;
  color: var(--monitor-text-secondary, var(--color-text-secondary, #b0b0b0));
  font-weight: 500;
  min-width: 60px;
  flex-shrink: 0;
  line-height: 1.4;
  padding-top: 0;
}

.info-value {
  font-size: 12px;
  color: var(--monitor-text-primary, var(--color-text-primary, #e5e5e5));
  text-align: left;
  flex: 1;
  min-width: 0; /* 使省略号在flex子项中生效 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap; /* 不换行，超出显示省略号 */
  line-height: 1.4;
  font-weight: 400;
  /* 数字对齐，避免抖动 */
  font-variant-numeric: tabular-nums;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 6px;
  color: var(--monitor-text-secondary, #b0b0b0);
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  border-radius: 4px;
  transition: color var(--monitor-transition-fast), background var(--monitor-transition-fast);
}

.copy-btn:hover {
  color: var(--monitor-text-primary, #e5e5e5);
  background: var(--monitor-bg-secondary, transparent);
}

.copy-btn:active {
  transform: translateY(0.5px);
}

/* 信息悬浮提示 - 与工具栏风格一致 */
.info-tooltip {
  position: fixed;
  z-index: var(--z-tooltip);
  background-color: var(--tooltip-bg);
  color: var(--tooltip-color);
  padding: var(--tooltip-padding-vertical) var(--tooltip-padding-horizontal);
  border-radius: var(--tooltip-border-radius);
  font-family: var(--tooltip-font-family);
  font-size: var(--tooltip-font-size);
  font-weight: var(--tooltip-font-weight);
  line-height: var(--tooltip-line-height);
  white-space: nowrap;
  max-width: var(--tooltip-max-width);
  box-shadow: var(--tooltip-shadow);
  pointer-events: auto;
}

/* 底部箭头（tooltip 在目标元素下方） */
.info-tooltip--bottom:after {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: var(--tooltip-arrow-size);
  border-style: solid;
  border-color: transparent transparent var(--tooltip-arrow-color) transparent;
}

/* 顶部箭头（tooltip 在目标元素上方） */
.info-tooltip--top:after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: var(--tooltip-arrow-size);
  border-style: solid;
  border-color: var(--tooltip-arrow-color) transparent transparent transparent;
}

/* 移除所有响应式样式，保持桌面端布局 */

/* 移除480px响应式样式，保持行内布局 */

/* 主题适配 - 使用统一的主题变量 */
:root[data-theme='dark'] .system-info-section,
.dark-theme .system-info-section {
  --monitor-text-primary: #e5e5e5;
  --monitor-text-secondary: #b0b0b0;
}

:root[data-theme='light'] .system-info-section,
.light-theme .system-info-section {
  --monitor-text-primary: #303133;
  --monitor-text-secondary: #606266;
}

/* 系统图标主题适配 */
:root[data-theme='dark'] .system-icon,
.dark-theme .system-icon {
  color: #3b82f6;
}

:root[data-theme='light'] .system-icon,
.light-theme .system-icon {
  color: #1890ff;
}
</style>
