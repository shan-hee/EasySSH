<template>
  <div
    class="loading-indicator"
    :class="{ 'loading-indicator--inline': inline }"
  >
    <div
      v-if="loading"
      class="loading-content"
    >
      <div class="loading-spinner">
        <div class="spinner" />
      </div>
      <div class="loading-text">
        {{ message }}
      </div>
    </div>

    <div
      v-else-if="error"
      class="error-content"
    >
      <div class="error-icon">
        ⚠️
      </div>
      <div class="error-text">
        {{ error }}
      </div>
      <button
        v-if="showRetry"
        class="retry-button"
        @click="$emit('retry')"
      >
        重试
      </button>
    </div>

    <div
      v-else-if="empty"
      class="empty-content"
    >
      <div class="empty-icon">
        📭
      </div>
      <div class="empty-text">
        {{ emptyMessage || '暂无数据' }}
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'LoadingIndicator',
  props: {
    loading: {
      type: Boolean,
      default: false
    },
    error: {
      type: String,
      default: ''
    },
    empty: {
      type: Boolean,
      default: false
    },
    message: {
      type: String,
      default: '加载中...'
    },
    emptyMessage: {
      type: String,
      default: ''
    },
    showRetry: {
      type: Boolean,
      default: true
    },
    inline: {
      type: Boolean,
      default: false
    }
  },
  emits: ['retry']
});
</script>

<style scoped>
.loading-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  min-height: 200px;
}

.loading-indicator--inline {
  min-height: auto;
  padding: 1rem;
}

.loading-content,
.error-content,
.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.loading-spinner {
  margin-bottom: 1rem;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #409eff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.loading-text,
.error-text,
.empty-text {
  color: #666;
  font-size: 14px;
  margin-top: 0.5rem;
}

.error-icon,
.empty-icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.error-content {
  color: #f56c6c;
}

.retry-button {
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  background-color: #409eff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
}

.retry-button:hover {
  background-color: #66b1ff;
}

.retry-button:active {
  background-color: #3a8ee6;
}
</style>
