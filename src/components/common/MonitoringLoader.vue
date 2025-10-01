<template>
  <div class="monitoring-loader" :class="loaderClasses">
    <!-- 连接状态指示器 -->
    <div v-if="state === 'connecting' || state === 'reconnecting'" class="loader-connecting">
      <div class="connecting-animation">
        <div class="connecting-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div class="loader-text">
        {{ state === 'reconnecting' ? '重新连接中...' : '连接监控服务...' }}
      </div>
    </div>

    <!-- 数据加载指示器 -->
    <div v-else-if="state === 'loading'" class="loader-loading">
      <div class="loading-animation">
        <div class="loading-spinner">
          <monitoring-icon name="loading" :size="16" class="spinner-icon" />
        </div>
        <div v-if="showProgress" class="loading-progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: `${progress}%` }" />
          </div>
          <span class="progress-text">{{ progress }}%</span>
        </div>
      </div>
      <div class="loader-text">
        {{ loadingText }}
      </div>
    </div>

    <!-- 错误状态指示器 -->
    <div v-else-if="state === 'error'" class="loader-error">
      <div class="error-animation">
        <monitoring-icon name="close" :size="16" class="error-icon" />
      </div>
      <div class="loader-text error-text">
        {{ errorMessage || '加载失败' }}
      </div>
      <button v-if="showRetry" class="retry-button" @click="onRetry">重试</button>
    </div>

    <!-- 骨架屏加载器 -->
    <div v-else-if="state === 'skeleton'" class="loader-skeleton">
      <div class="skeleton-content">
        <!-- 图表骨架 -->
        <div v-if="skeletonType === 'chart'" class="skeleton-chart">
          <div class="skeleton-header">
            <div class="skeleton-title" />
            <div class="skeleton-value" />
          </div>
          <div class="skeleton-graph">
            <div
              v-for="i in 5"
              :key="i"
              class="skeleton-line"
              :style="{ height: `${20 + Math.random() * 40}%` }"
            />
          </div>
        </div>

        <!-- 圆环图骨架 -->
        <div v-else-if="skeletonType === 'doughnut'" class="skeleton-doughnut">
          <div class="skeleton-header">
            <div class="skeleton-title" />
          </div>
          <div class="skeleton-circle">
            <div class="skeleton-ring" />
          </div>
        </div>

        <!-- 信息卡片骨架 -->
        <div v-else class="skeleton-info">
          <div v-for="i in 3" :key="i" class="skeleton-row">
            <div class="skeleton-label" />
            <div class="skeleton-value" />
          </div>
        </div>
      </div>
    </div>

    <!-- 初始状态 -->
    <div v-else-if="state === 'initial'" class="loader-initial">
      <div class="initial-animation">
        <monitoring-icon name="chart-line" :size="16" class="initial-icon" />
      </div>
      <div class="loader-text">准备监控数据...</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import MonitoringIcon from '../monitoring/MonitoringIcon.vue';

// Props定义
const props = defineProps({
  state: {
    type: String,
    required: true,
    validator: value =>
      ['initial', 'connecting', 'loading', 'loaded', 'error', 'reconnecting', 'skeleton'].includes(
        value
      )
  },
  progress: {
    type: Number,
    default: 0,
    validator: value => value >= 0 && value <= 100
  },
  showProgress: {
    type: Boolean,
    default: false
  },
  loadingText: {
    type: String,
    default: '加载监控数据...'
  },
  errorMessage: {
    type: String,
    default: ''
  },
  showRetry: {
    type: Boolean,
    default: true
  },
  skeletonType: {
    type: String,
    default: 'chart',
    validator: value => ['chart', 'doughnut', 'info'].includes(value)
  },
  size: {
    type: String,
    default: 'normal',
    validator: value => ['small', 'normal', 'large'].includes(value)
  }
});

// 事件定义
const emit = defineEmits(['retry']);
const onRetry = () => emit('retry');

// 计算属性
const loaderClasses = computed(() => ({
  [`loader-${props.state}`]: true,
  [`loader-size-${props.size}`]: true
}));
</script>

<style scoped>

.monitoring-loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 80px;
  padding: var(--monitor-spacing-md);
  color: var(--monitor-text-secondary);
  font-size: 12px;
}

/* 尺寸变体 */
.loader-size-small {
  min-height: 60px;
  padding: var(--monitor-spacing-sm);
  font-size: 11px;
}

.loader-size-large {
  min-height: 120px;
  padding: var(--monitor-spacing-lg);
  font-size: 13px;
}

/* 连接状态动画 */
.loader-connecting .connecting-animation {
  margin-bottom: var(--monitor-spacing-sm);
}

.connecting-dots {
  display: flex;
  gap: 4px;
}

.connecting-dots span {
  width: 6px;
  height: 6px;
  background: var(--monitor-info);
  border-radius: 50%;
  animation: connecting-pulse 1.4s ease-in-out infinite both;
}

.connecting-dots span:nth-child(1) {
  animation-delay: -0.32s;
}
.connecting-dots span:nth-child(2) {
  animation-delay: -0.16s;
}
.connecting-dots span:nth-child(3) {
  animation-delay: 0s;
}

@keyframes connecting-pulse {
  0%,
  80%,
  100% {
    transform: scale(0.8);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

/* 加载状态动画 */
.loader-loading .loading-animation {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--monitor-spacing-sm);
  margin-bottom: var(--monitor-spacing-sm);
}

.loading-spinner .spinner-icon {
  color: var(--monitor-info);
  animation: spin 1s linear infinite;
}

.loading-progress {
  display: flex;
  align-items: center;
  gap: var(--monitor-spacing-sm);
  width: 100px;
}

.progress-bar {
  flex: 1;
  height: 3px;
  background: var(--monitor-bg-secondary);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--monitor-info);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 10px;
  color: var(--monitor-text-muted);
  min-width: 30px;
}

/* 错误状态 */
.loader-error .error-animation {
  margin-bottom: var(--monitor-spacing-sm);
}

.error-icon {
  color: var(--monitor-error);
}

.error-text {
  color: var(--monitor-error);
  margin-bottom: var(--monitor-spacing-sm);
}

.retry-button {
  background: var(--monitor-error);
  color: white;
  border: none;
  padding: 4px 8px;
  border-radius: var(--monitor-radius-sm);
  font-size: 11px;
  cursor: pointer;
  transition: opacity var(--monitor-transition-fast);
}

.retry-button:hover {
  opacity: 0.8;
}

/* 初始状态 */
.loader-initial .initial-animation {
  margin-bottom: var(--monitor-spacing-sm);
}

.initial-icon {
  color: var(--monitor-text-muted);
  opacity: 0.6;
}

/* 通用文本样式 */
.loader-text {
  text-align: center;
  line-height: 1.4;
}

/* 骨架屏样式 */
.loader-skeleton {
  width: 100%;
  height: 100%;
}

.skeleton-content {
  width: 100%;
  height: 100%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

/* 图表骨架 */
.skeleton-chart {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.skeleton-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--monitor-spacing-md);
}

.skeleton-title {
  width: 60px;
  height: 12px;
  background: var(--monitor-bg-primary);
  border-radius: var(--monitor-radius-sm);
}

.skeleton-value {
  width: 40px;
  height: 12px;
  background: var(--monitor-bg-primary);
  border-radius: var(--monitor-radius-sm);
}

.skeleton-graph {
  flex: 1;
  display: flex;
  align-items: end;
  gap: 2px;
  padding: var(--monitor-spacing-sm) 0;
}

.skeleton-line {
  flex: 1;
  background: var(--monitor-bg-primary);
  border-radius: 1px;
  min-height: 20%;
  animation: skeleton-wave 2s ease-in-out infinite;
}

.skeleton-line:nth-child(1) {
  animation-delay: 0s;
}
.skeleton-line:nth-child(2) {
  animation-delay: 0.2s;
}
.skeleton-line:nth-child(3) {
  animation-delay: 0.4s;
}
.skeleton-line:nth-child(4) {
  animation-delay: 0.6s;
}
.skeleton-line:nth-child(5) {
  animation-delay: 0.8s;
}

/* 圆环图骨架 */
.skeleton-doughnut {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.skeleton-circle {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: var(--monitor-spacing-md);
}

.skeleton-ring {
  width: 80px;
  height: 80px;
  border: 8px solid var(--monitor-bg-primary);
  border-top: 8px solid var(--monitor-bg-secondary);
  border-radius: 50%;
  animation: skeleton-rotate 2s linear infinite;
}

/* 信息卡片骨架 */
.skeleton-info {
  display: flex;
  flex-direction: column;
  gap: var(--monitor-spacing-md);
  height: 100%;
  justify-content: center;
}

.skeleton-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.skeleton-label {
  width: 50px;
  height: 10px;
  background: var(--monitor-bg-primary);
  border-radius: var(--monitor-radius-sm);
}

.skeleton-row .skeleton-value {
  width: 35px;
  height: 10px;
  background: var(--monitor-bg-primary);
  border-radius: var(--monitor-radius-sm);
}

/* 骨架屏动画 */
@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

@keyframes skeleton-wave {
  0%,
  100% {
    transform: scaleY(1);
  }
  50% {
    transform: scaleY(1.3);
  }
}

@keyframes skeleton-rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* 动画定义 */
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
