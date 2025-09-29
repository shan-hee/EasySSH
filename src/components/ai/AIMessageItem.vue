<template>
  <div
    class="ai-message-item"
    :class="{
      'ai-message-user': message.type === 'user',
      'ai-message-assistant': message.type === 'assistant',
      'ai-message-system': message.type === 'system',
      'ai-message-mobile': isMobile,
      'ai-message-dark': isDarkTheme,
      'ai-message-streaming': message.isStreaming
    }"
  >
    <!-- 用户消息：简洁气泡样式 -->
    <div v-if="message.type === 'user'" class="ai-user-message-wrapper">
      <div class="ai-user-time">
        {{ formatTime(message.timestamp) }}
      </div>
      <div class="ai-user-bubble">
        <div class="ai-user-content">
          {{ message.content }}
        </div>
      </div>
    </div>

    <!-- 非用户消息：保持原有样式 -->
    <template v-else>
      <!-- 消息头部 -->
      <div class="ai-message-header">
        <div class="ai-message-avatar">
          <svg v-if="message.type === 'assistant'" viewBox="0 0 24 24" width="16" height="16">
            <path
              fill="currentColor"
              d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,6V9H8V11H11V14H13V11H16V9H13V6H11Z"
            />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16">
            <path
              fill="currentColor"
              d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,6V9H8V11H11V14H13V11H16V9H13V6H11Z"
            />
          </svg>
        </div>

        <div class="ai-message-meta">
          <span class="ai-message-sender">
            {{ getSenderName() }}
          </span>
          <span class="ai-message-time">
            {{ formatTime(message.timestamp) }}
          </span>
        </div>
      </div>

      <!-- 消息内容 -->
      <div class="ai-message-content">
        <!-- 纯文本消息 -->
        <div v-if="!hasCodeBlocks" v-safe-html="formattedContent" class="ai-message-text" />

        <!-- 包含代码块的消息 -->
        <div v-else class="ai-message-mixed">
          <div v-for="(part, index) in parsedContent" :key="index" class="ai-content-part">
            <!-- 文本部分 -->
            <div v-if="part.type === 'text'" v-safe-html="part.content" class="ai-message-text" />

            <!-- 代码块部分 -->
            <div v-else-if="part.type === 'code'" class="ai-code-block">
              <div class="ai-code-header">
                <span class="ai-code-language">{{ part.language || 'shell' }}</span>
                <a-i-command-actions
                  :command="part.content"
                  :language="part.language"
                  :is-mobile="isMobile"
                  :is-dark-theme="isDarkTheme"
                  @execute="handleExecuteCommand"
                  @edit="handleEditCommand"
                  @add-to-scripts="handleAddToScripts"
                />
              </div>
              <pre class="ai-code-content"><code>{{ part.content }}</code></pre>
            </div>
          </div>
        </div>
      </div>

      <!-- 消息状态 -->
      <div v-if="message.status" class="ai-message-status">
        <span v-if="message.status === 'sending'" class="ai-status-sending">
          <svg class="ai-status-icon spinning" viewBox="0 0 24 24" width="12" height="12">
            <circle cx="12" cy="12" r="2" fill="currentColor">
              <animate attributeName="r" values="2;4;2" dur="1s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
            </circle>
          </svg>
          发送中...
        </span>
        <span v-else-if="message.status === 'error'" class="ai-status-error">
          <svg class="ai-status-icon" viewBox="0 0 24 24" width="12" height="12">
            <path
              fill="currentColor"
              d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z"
            />
          </svg>
          发送失败
        </span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import AICommandActions from './AICommandActions.vue';
import { parseAIMessage } from '../../services/ai/ai-message-parser.js';
import { aiPerformanceMonitor } from '../../utils/ai-panel-performance.js';
import { sanitizeHtml } from '../../utils/sanitizeHtml.js';

// Props
const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  isMobile: {
    type: Boolean,
    default: false
  },
  isDarkTheme: {
    type: Boolean,
    default: false
  }
});

// Emits
const emit = defineEmits(['execute-command', 'edit-command', 'add-to-scripts']);

// 计算属性
const messageParseResult = computed(() => {
  const startTime = performance.now();
  const result = parseAIMessage(props.message.content);
  const duration = performance.now() - startTime;

  // 记录命令解析性能
  aiPerformanceMonitor.recordCommandParseTime(duration);

  return result;
});

const hasCodeBlocks = computed(() => {
  return messageParseResult.value.hasCodeBlocks;
});

const formattedContent = computed(() => {
  return sanitizeHtml(messageParseResult.value.formattedContent);
});

const parsedContent = computed(() => {
  // 对文本段落做额外消毒，代码块保持原样
  return messageParseResult.value.parsedContent.map(part => {
    if (part.type === 'text') {
      return { ...part, content: sanitizeHtml(part.content) };
    }
    return part;
  });
});

// 方法
const getSenderName = () => {
  switch (props.message.type) {
    case 'user':
      return '用户';
    case 'assistant':
      return 'AI 助手';
    case 'system':
      return '系统';
    default:
      return '未知';
  }
};

const formatTime = timestamp => {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 如果是今天
  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // 如果是昨天
  if (diff < 48 * 60 * 60 * 1000) {
    return `昨天 ${date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  }

  // 其他情况显示日期
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const handleExecuteCommand = command => {
  emit('execute-command', command);
};

const handleEditCommand = command => {
  emit('edit-command', command);
};

const handleAddToScripts = command => {
  emit('add-to-scripts', command);
};

// 组件挂载时记录渲染性能
onMounted(() => {
  const renderTime = performance.now() - (window.messageRenderStart || performance.now());
  aiPerformanceMonitor.recordMessageRenderTime(renderTime);
});
// 安全HTML渲染指令（基于白名单消毒）
const vSafeHtml = {
  mounted(el, binding) {
    el.innerHTML = sanitizeHtml(binding.value);
  },
  updated(el, binding) {
    if (binding.value !== binding.oldValue) {
      el.innerHTML = sanitizeHtml(binding.value);
    }
  }
};
</script>

<style scoped>
/* AI消息项样式已在全局样式文件中定义 */
/* 这里只添加组件特定的样式覆盖 */

/* 用户消息气泡样式 */
.ai-message-user {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
  padding-left: 20%;
}

.ai-user-message-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  max-width: 100%;
}

.ai-user-time {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-bottom: 2px;
  margin-right: 8px;
  opacity: 0.7;
}

.ai-user-bubble {
  display: flex;
  justify-content: flex-end;
}

.ai-user-content {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  padding: 8px 12px;
  border-radius: 16px;
  font-size: 13px;
  line-height: 1.4;
  word-wrap: break-word;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  position: relative;
}

/* 深色主题下的用户气泡 */
.ai-message-dark .ai-user-content {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.ai-message-dark .ai-user-time {
  color: var(--color-text-secondary);
}

/* 移动端适配 */
.ai-message-mobile {
  padding-left: 15%;
}

.ai-message-mobile .ai-user-bubble {
  max-width: 100%;
}

.ai-message-mobile .ai-user-content {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 14px;
  border-bottom-right-radius: 3px;
}

/* 响应式设计 */
@media (max-width: 480px) {
  .ai-message-user {
    padding-left: 10%;
  }

  .ai-user-bubble {
    max-width: 100%;
  }

  .ai-user-content {
    font-size: 12px;
    padding: 6px 10px;
  }
}
</style>
