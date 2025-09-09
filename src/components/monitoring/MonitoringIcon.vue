<template>
  <icon
    :icon="iconName"
    :width="size"
    :height="size"
    :class="['monitoring-icon', `monitoring-icon--${name}`, className]"
    :style="iconStyle"
  />
</template>

<script setup>
import { Icon } from '@iconify/vue';
import { computed } from 'vue';

// Props定义
const props = defineProps({
  name: {
    type: String,
    required: true,
    validator: value => {
      const validIcons = [
        'system-info',
        'cpu',
        'memory',
        'network',
        'disk',
        'upload',
        'download',
        'swap',
        'chart-line',
        'minimize',
        'maximize',
        'compress',
        'close',
        'loading'
      ];
      return validIcons.includes(value);
    }
  },
  size: {
    type: [String, Number],
    default: 16
  },
  color: {
    type: String,
    default: ''
  },
  className: {
    type: String,
    default: ''
  }
});

// 图标映射 - 使用高质量的Material Design Icons
const iconMap = {
  'system-info': 'mdi:information-outline',
  cpu: 'mdi:cpu-64-bit',
  memory: 'mdi:memory',
  network: 'mdi:network',
  disk: 'mdi:harddisk',
  upload: 'mdi:upload',
  download: 'mdi:download',
  swap: 'mdi:swap-horizontal',
  'chart-line': 'mdi:chart-line',
  minimize: 'mdi:window-minimize',
  maximize: 'mdi:window-maximize',
  compress: 'mdi:window-restore',
  close: 'mdi:close',
  loading: 'mdi:loading'
};

// 计算图标名称
const iconName = computed(() => {
  return iconMap[props.name] || 'mdi:help-circle-outline';
});

// 计算图标样式
const iconStyle = computed(() => {
  const style = {};
  if (props.color) {
    style.color = props.color;
  }
  return style;
});
</script>

<style scoped>
.monitoring-icon {
  display: inline-block;
  vertical-align: middle;
  transition: color 0.2s ease;
}

/* 系统信息图标 */
.monitoring-icon--system-info {
  color: #3b82f6;
}

/* CPU图标 */
.monitoring-icon--cpu {
  color: #3b82f6;
}

/* 内存图标 */
.monitoring-icon--memory {
  color: #10b981;
}

/* 网络图标 */
.monitoring-icon--network {
  color: #8b5cf6;
}

/* 硬盘图标 */
.monitoring-icon--disk {
  color: #f59e0b;
}

/* 上传下载图标 */
.monitoring-icon--upload {
  color: #ef4444;
}

.monitoring-icon--download {
  color: #8b5cf6;
}

/* 交换分区图标 */
.monitoring-icon--swap {
  color: #06b6d4;
}

/* 图表图标 */
.monitoring-icon--chart-line {
  color: #3b82f6;
}

/* 控制按钮图标 */
.monitoring-icon--minimize,
.monitoring-icon--maximize,
.monitoring-icon--compress,
.monitoring-icon--close {
  color: currentColor;
}

/* 加载图标 */
.monitoring-icon--loading {
  color: #6b7280;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 悬停效果 */
.monitoring-icon:hover {
  opacity: 0.8;
}

/* 在按钮中的图标样式 */
.btn .monitoring-icon {
  margin-right: 4px;
}

.btn:last-child .monitoring-icon {
  margin-right: 0;
}
</style>
