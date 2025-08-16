<template>
  <div class="ai-combined-panel" :class="{ 'ai-panel-mobile': isMobile }">
    <!-- AI输入栏 - 始终显示 -->
    <div class="ai-input-section">
      <!-- 输入框区域 -->
      <div class="ai-input-wrapper">
        <el-input
          v-model="inputText"
          type="textarea"
          :placeholder="getPlaceholder()"
          :rows="1"
          :maxlength="200"
          resize="none"
          class="ai-input-field"
          ref="inputRef"
          @keydown="handleKeydown"
          @focus="handleInputFocus"
          @blur="handleInputBlur"
          @input="handleInputChange"
          :disabled="isProcessing"
        />
      </div>

      <!-- 输入区域底部：模式按钮和控制区域 -->
      <div class="ai-input-footer">
        <div class="ai-mode-buttons">
          <div class="ai-mode-button-group">
            <button
              class="ai-mode-btn"
              :class="{ 'ai-mode-btn-active': selectedMode === 'chat' }"
              @click="selectMode('chat')"
              :disabled="isProcessing"
            >
              💬 Chat
            </button>
            <button
              class="ai-mode-btn"
              :class="{ 'ai-mode-btn-active': selectedMode === 'agent' }"
              @click="selectMode('agent')"
              :disabled="isProcessing"
            >
              🤖 Agent
            </button>
            <button
              class="ai-mode-btn"
              :class="{ 'ai-mode-btn-active': selectedMode === 'exec' }"
              @click="selectMode('exec')"
              :disabled="isProcessing"
            >
              ⚡ 执行
            </button>
          </div>
        </div>

        <div class="ai-footer-controls">
          <!-- 展开/收起按钮 -->
          <button
            class="ai-control-btn ai-expand-btn"
            @click="togglePanel"
            :title="isPanelExpanded ? '收起AI面板' : '展开AI面板'"
            v-if="messages.length > 0"
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path fill="currentColor" :d="isPanelExpanded ? 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z' : 'M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z'"/>
            </svg>
          </button>

          <!-- 发送按钮 -->
          <button
            class="ai-send-button"
            @click="canSend && !isProcessing ? handleSend() : null"
            :class="{ 'disabled': !canSend || isProcessing }"
            :disabled="!canSend || isProcessing"
          >
            <svg
              v-if="!isProcessing"
              class="send-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              :class="{ 'send-icon-disabled': !canSend }"
            >
              <path fill="currentColor" d="M2,21L23,12L2,3V10L17,12L2,14V21Z"/>
            </svg>
            <svg
              v-else
              class="send-icon loading-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
            >
              <circle cx="12" cy="12" r="2" fill="currentColor">
                <animate attributeName="r" values="2;4;2" dur="1s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/>
              </circle>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- AI交互面板 - 可展开/收起 -->
    <div
      class="ai-interaction-section ai-interaction-panel ai-panel-bottom-expand"
      :class="{
        'ai-panel-visible': isPanelExpanded,
        'ai-panel-expanded': isPanelExpanded,
        'ai-panel-dark': isDarkTheme,
        'ai-panel-streaming': isStreaming
      }"
      v-show="isPanelExpanded && messages.length > 0"
      :style="panelStyle"
    >
      <!-- 调整大小指示器 -->
      <div
        v-show="!isMobile"
        class="ai-panel-resize-indicator ai-panel-resize-top"
        @mousedown="startResize"
      >
        <div class="resize-handle"></div>
      </div>

      <!-- 面板头部 -->
      <div class="ai-panel-header">
        <div class="ai-panel-title">
          <svg class="ai-icon" viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,6V9H8V11H11V14H13V11H16V9H13V6H11Z"/>
          </svg>
          <span>AI 助手</span>
        </div>
        
        <div class="ai-panel-controls">
          <!-- 清空历史按钮 -->
          <button 
            class="ai-control-btn"
            @click="clearHistory"
            title="清空历史"
            :disabled="messages.length === 0"
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
            </svg>
          </button>
          
          <!-- 收起按钮 -->
          <button 
            class="ai-control-btn"
            @click="togglePanel"
            title="收起面板"
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- 消息列表容器 -->
      <div 
        class="ai-panel-content"
        ref="contentRef"
      >
        <div class="ai-messages-container" ref="messagesRef">
          <!-- 消息列表 -->
          <div class="ai-messages-list">
            <AIMessageItem
              v-for="(message, index) in messages"
              :key="message.id || index"
              :message="message"
              :is-mobile="isMobile"
              :is-dark-theme="isDarkTheme"
              @execute-command="handleExecuteCommand"
              @edit-command="handleEditCommand"
              @add-to-scripts="handleAddToScripts"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { ElInput, ElMessage } from 'element-plus'
import settingsService from '../../services/settings'
import AIMessageItem from './AIMessageItem.vue'
import { aiPerformanceMonitor, debounce } from '../../utils/ai-panel-performance.js'
import { withErrorHandling, ErrorSeverity } from '../../utils/ai-panel-error-handler.js'

// Props
const props = defineProps({
  terminalId: {
    type: String,
    required: true
  },
  messages: {
    type: Array,
    default: () => []
  },
  maxHeight: {
    type: Number,
    default: 300
  },
  isMobile: {
    type: Boolean,
    default: false
  },
  isStreaming: {
    type: Boolean,
    default: false
  },
  aiService: {
    type: Object,
    required: true
  }
})

// Emits
const emit = defineEmits([
  'ai-response',
  'ai-streaming', 
  'mode-change',
  'input-focus',
  'input-blur',
  'execute-command',
  'clear-history',
  'edit-command',
  'add-to-scripts',
  'height-change',
  'height-change-start',
  'height-change-end'
])

// 响应式数据
const inputText = ref('')
const selectedMode = ref('chat')
const isProcessing = ref(false)
const isPanelExpanded = ref(false)
const currentHeight = ref(0)
const isResizing = ref(false)
const contentRef = ref(null)
const messagesRef = ref(null)
const inputRef = ref(null)

// 计算属性
const isDarkTheme = computed(() => {
  if (!settingsService.isInitialized) return false
  const theme = settingsService.get('ui.theme', 'dark')
  return settingsService._resolveActualTheme(theme) === 'dark'
})

const canSend = computed(() => {
  return inputText.value.trim().length > 0 && !isProcessing.value && props.aiService?.isEnabled
})

const panelStyle = computed(() => {
  const style = {}

  if (isPanelExpanded.value) {
    style.height = `${currentHeight.value}px`
    style.maxHeight = `${props.maxHeight}px`
  } else {
    style.height = '0px'
  }

  return style
})

// 方法
const getPlaceholder = () => {
  if (!props.aiService?.isEnabled) {
    return 'AI服务未启用，请在设置中配置'
  }

  const mode = selectedMode.value
  const placeholders = {
    chat: '输入问题与AI对话，如：如何优化Linux性能？',
    agent: '描述需要分析的问题，如：分析这个错误',
    exec: '输入命令直接执行，如：ls -la'
  }

  return placeholders[mode] || '输入您的问题...'
}

const selectMode = (mode) => {
  if (isProcessing.value) return

  selectedMode.value = mode
  emit('mode-change', mode)

  // 更新输入框占位符
  const inputEl = document.querySelector('.ai-input-field textarea')
  if (inputEl) {
    inputEl.placeholder = getPlaceholder()
  }
}

const togglePanel = () => {
  const startTime = performance.now()

  isPanelExpanded.value = !isPanelExpanded.value

  if (isPanelExpanded.value) {
    nextTick(() => {
      adjustHeight()
      scrollToBottom()

      // 记录性能指标
      const duration = performance.now() - startTime
      aiPerformanceMonitor.recordPanelToggleTime(duration)
    })
  } else {
    // 记录性能指标
    const duration = performance.now() - startTime
    aiPerformanceMonitor.recordPanelToggleTime(duration)
  }
}

const handleKeydown = (event) => {
  // Enter 发送（不按Shift时）
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }

  // Shift+Enter 换行（默认行为，不需要特殊处理）

  // Escape 清空输入
  if (event.key === 'Escape') {
    inputText.value = ''
    nextTick(() => {
      adjustInputHeight()
    })
  }
}

const handleInputFocus = () => {
  emit('input-focus')
}

const handleInputBlur = () => {
  emit('input-blur')
}

// 处理输入框内容变化，自动调整高度
const handleInputChange = () => {
  nextTick(() => {
    adjustInputHeight()
  })
}

// 自动调整输入框高度
const adjustInputHeight = () => {
  if (!inputRef.value) return

  const textarea = inputRef.value.$el.querySelector('textarea')
  if (!textarea) return

  // 重置高度以获取正确的scrollHeight
  textarea.style.height = 'auto'

  // 计算所需高度
  const scrollHeight = textarea.scrollHeight

  // 计算行高（基于字体大小和line-height）
  const computedStyle = window.getComputedStyle(textarea)
  const fontSize = parseFloat(computedStyle.fontSize) || 13
  const lineHeight = parseFloat(computedStyle.lineHeight) || fontSize * 1.4

  // 计算最小和最大高度
  const minHeight = lineHeight + 16 // 1行 + padding
  const maxHeight = Math.max(150, Math.floor(props.maxHeight * 0.4)) // 最大高度为面板高度的40%，至少150px

  // 限制高度范围
  const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight))

  // 应用新高度
  textarea.style.height = `${newHeight}px`

  // 如果内容超过最大高度，显示滚动条
  if (scrollHeight > maxHeight) {
    textarea.style.overflowY = 'auto'
  } else {
    textarea.style.overflowY = 'hidden'
  }
}

const handleSend = async () => {
  if (!canSend.value) return

  const text = inputText.value.trim()
  if (!text) return

  try {
    isProcessing.value = true

    // 构建上下文信息
    const context = buildTerminalContext()

    // 根据模式处理
    if (selectedMode.value === 'exec') {
      // 执行模式：直接执行命令，不显示响应
      await executeCommand(text)
      // 清空输入框
      inputText.value = ''
    } else {
      // AI模式（chat/agent）
      let result
      if (selectedMode.value === 'chat') {
        // 聊天模式
        result = await props.aiService.requestChat({
          question: text,
          prompt: text,
          ...context
        })
      } else {
        // Agent模式
        result = await props.aiService.requestAgent({
          prompt: text,
          operationType: 'auto',
          ...context
        })
      }

      if (result && result.success && result.content) {
        // 发送响应事件到终端显示
        emit('ai-response', {
          mode: selectedMode.value,
          userMessage: text, // 添加用户消息
          content: result.content,
          success: true
        })

        // 清空输入框并重置高度
        inputText.value = ''
        nextTick(() => {
          adjustInputHeight()
        })

        // 自动展开面板显示响应
        if (!isPanelExpanded.value) {
          isPanelExpanded.value = true
          nextTick(() => {
            adjustHeight()
            scrollToBottom()
          })
        }

        ElMessage.success('AI响应成功')
      } else {
        throw new Error('AI响应失败')
      }
    }

  } catch (error) {
    console.error('AI请求失败:', error)

    // 发送错误响应事件
    emit('ai-response', {
      mode: selectedMode.value,
      userMessage: text, // 添加用户消息
      content: error.message,
      success: false
    })

    ElMessage.error('AI请求失败')
  } finally {
    isProcessing.value = false
  }
}

// 执行命令
const executeCommand = async (command) => {
  try {
    // 直接通过emit发送命令到父组件（Terminal.vue）
    emit('execute-command', {
      terminalId: props.terminalId,
      command: command.trim()
    })

    return {
      success: true,
      content: `命令已执行: ${command}`
    }
  } catch (error) {
    console.error('执行命令失败:', error)
    return {
      success: false,
      content: `执行失败: ${error.message}`
    }
  }
}

const clearHistory = withErrorHandling(() => {
  emit('clear-history')
}, { component: 'AICombinedPanel', action: 'clearHistory' }, ErrorSeverity.LOW)

const handleExecuteCommand = (command) => {
  emit('execute-command', { command, terminalId: props.terminalId })
}

const handleEditCommand = (command) => {
  emit('edit-command', { command, terminalId: props.terminalId })
}

const handleAddToScripts = (command) => {
  emit('add-to-scripts', { command, terminalId: props.terminalId })
}

// 自动调整高度
const adjustHeight = () => {
  if (!isPanelExpanded.value || !messagesRef.value) return

  const messagesHeight = messagesRef.value.scrollHeight
  const headerHeight = 32 // 头部高度
  const padding = 16 // 内边距
  const totalHeight = Math.min(messagesHeight + headerHeight + padding, props.maxHeight)

  if (totalHeight !== currentHeight.value) {
    currentHeight.value = totalHeight
    emit('height-change', totalHeight)
  }
}

// 滚动到底部
const scrollToBottom = () => {
  if (!contentRef.value) return

  nextTick(() => {
    contentRef.value.scrollTop = contentRef.value.scrollHeight
  })
}

// 调整大小功能
const startResize = (event) => {
  event.preventDefault()
  isResizing.value = true

  const startY = event.clientY
  const startHeight = currentHeight.value
  const minHeight = 100
  const maxHeight = props.maxHeight

  // 发送调整开始事件
  emit('height-change-start')

  // 添加视觉反馈
  document.body.style.cursor = 'ns-resize'
  document.body.style.userSelect = 'none'

  // 使用requestAnimationFrame优化性能
  let animationFrameId = null

  const handleMouseMove = (e) => {
    if (!isResizing.value) return

    e.preventDefault()

    // 取消之前的动画帧
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
    }

    // 使用requestAnimationFrame确保流畅的动画
    animationFrameId = requestAnimationFrame(() => {
      const currentY = e.clientY
      const deltaY = currentY - startY

      // 顶部调整器：向上拖拽增加高度，向下拖拽减少高度
      const sensitivity = 1.0
      const heightChange = -deltaY * sensitivity

      let newHeight = startHeight + heightChange

      // 确保高度在合理范围内
      newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight))

      // 只有当高度真正改变时才更新
      if (Math.abs(newHeight - currentHeight.value) > 0.5) {
        currentHeight.value = Math.round(newHeight)
      }
    })
  }

  const handleMouseUp = () => {
    isResizing.value = false

    // 取消任何待处理的动画帧
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }

    // 恢复默认样式
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    // 移除事件监听器
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)

    // 发送调整结束事件和最终高度
    emit('height-change', currentHeight.value)
    emit('height-change-end')
  }

  // 添加事件监听器
  document.addEventListener('mousemove', handleMouseMove, { passive: false })
  document.addEventListener('mouseup', handleMouseUp)
}

// 构建终端上下文信息
const buildTerminalContext = () => {
  try {
    // 尝试获取终端输出（简化版本）
    const terminalElement = document.querySelector(`[data-terminal-id="${props.terminalId}"]`)
    let terminalOutput = ''

    if (terminalElement) {
      // 获取终端的可见文本内容
      const textContent = terminalElement.textContent || ''
      // 取最后1000个字符作为上下文
      terminalOutput = textContent.slice(-1000)
    }

    // 简单的OS和Shell检测
    const osHint = detectOS(terminalOutput)
    const shellHint = detectShell(terminalOutput)
    const errorDetected = detectError(terminalOutput)

    return {
      terminalOutput,
      osHint,
      shellHint,
      errorDetected
    }
  } catch (error) {
    console.error('构建终端上下文失败:', error)
    return {
      terminalOutput: '',
      osHint: 'unknown',
      shellHint: 'unknown',
      errorDetected: false
    }
  }
}

// 检测操作系统
const detectOS = (output) => {
  if (/ubuntu|debian/i.test(output)) return 'ubuntu'
  if (/centos|rhel|redhat/i.test(output)) return 'centos'
  if (/alpine/i.test(output)) return 'alpine'
  if (/windows/i.test(output)) return 'windows'
  if (/darwin|macos/i.test(output)) return 'macos'
  return 'linux'
}

// 检测Shell类型
const detectShell = (output) => {
  if (/bash/i.test(output)) return 'bash'
  if (/zsh/i.test(output)) return 'zsh'
  if (/fish/i.test(output)) return 'fish'
  if (/sh/i.test(output)) return 'sh'
  return 'bash'
}

// 检测错误
const detectError = (output) => {
  const errorPatterns = [
    /error/i,
    /failed/i,
    /cannot/i,
    /permission denied/i,
    /command not found/i,
    /no such file/i
  ]

  return errorPatterns.some(pattern => pattern.test(output))
}

// 监听消息变化
watch(() => props.messages, (newMessages, oldMessages) => {
  // 如果有新消息且当前不可见，自动显示面板
  if (newMessages.length > (oldMessages?.length || 0)) {
    if (!isPanelExpanded.value) {
      isPanelExpanded.value = true
    }
  }

  if (isPanelExpanded.value) {
    nextTick(() => {
      adjustHeight()
      scrollToBottom()
    })
  }
}, { deep: true })

// 监听流式输出状态
watch(() => props.isStreaming, (streaming) => {
  if (streaming && !isPanelExpanded.value) {
    // 流式输出开始时自动显示面板
    isPanelExpanded.value = true

    nextTick(() => {
      adjustHeight()
      scrollToBottom()
    })
  }
})

// 监听AI服务状态变化
watch(() => props.aiService?.isEnabled, (newValue) => {
  if (!newValue) {
    isProcessing.value = false
  }
})

// 监听窗口大小变化（使用防抖优化性能）
const handleResize = debounce(() => {
  if (isPanelExpanded.value) {
    adjustHeight()
  }
}, 150)

onMounted(() => {
  window.addEventListener('resize', handleResize)

  // 初始化输入框高度
  nextTick(() => {
    adjustInputHeight()
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

// 暴露方法给父组件
defineExpose({
  show: () => {
    isPanelExpanded.value = true
    nextTick(() => {
      adjustHeight()
      scrollToBottom()
    })
  },
  hide: () => {
    isPanelExpanded.value = false
  },
  scrollToBottom
})
</script>

<style scoped>
/* AI合并面板基础样式 */
.ai-combined-panel {
  display: flex;
  flex-direction: column;
  background: transparent;
  border-top: 1px solid var(--color-border-default);
  border-radius: 8px 8px 0 0;
  transition:
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    box-shadow 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  height: auto;
  max-height: none;
  overflow: visible;
}

/* AI输入区域 - 始终显示 */
.ai-input-section {
  order: 2; /* 输入区域在下方 */
  flex-shrink: 0;
  background: transparent;
  padding: 8px;
  min-height: 60px;
  max-height: none; /* 移除固定最大高度限制 */
}

/* 输入底部控制栏 */
.ai-input-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  background: transparent;
  min-height: 28px;
  flex-shrink: 0;
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.ai-footer-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.ai-expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.ai-expand-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

/* 模式按钮样式 */
.ai-mode-buttons {
  display: flex;
  justify-content: center;
  margin-top: 4px;
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.ai-mode-button-group {
  display: flex;
  gap: 4px;
}

.ai-mode-btn {
  font-size: 11px;
  padding: 4px 8px;
  height: 28px;
  border: none;
  border-radius: 16px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 60px;
}

.ai-mode-btn:hover:not(:disabled) {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.ai-mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-mode-btn-active {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
  font-weight: 500;
}

/* 输入框包装器 */
.ai-input-wrapper {
  position: relative;
  width: 100%;
}

.ai-input-field {
  width: 100%;
}

.ai-input-field :deep(.el-textarea__inner) {
  border: none !important;
  border-radius: 6px !important;
  background: transparent !important;
  color: var(--color-text-primary) !important;
  font-size: 13px !important;
  line-height: 1.4 !important;
  resize: none !important;
  padding: 8px 12px !important;
  min-height: 20px !important;
  max-height: none !important;
  overflow-y: auto !important;
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    height 0.2s ease !important;
  box-shadow: none !important;
}

.ai-input-field :deep(.el-textarea__inner):hover:not(:focus) {
  box-shadow: none !important;
}

.ai-input-field :deep(.el-textarea__inner):focus {
  box-shadow: none !important;
  outline: none !important;
}

/* 字数统计样式已移除 */

/* 发送按钮 */
.ai-send-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;
}

.ai-send-button:hover:not(:disabled) {
  background-color: var(--color-bg-hover);
  transform: scale(1.05);
}

.ai-send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-icon {
  color: currentColor;
  transition: transform 0.2s ease;
}

.send-icon-disabled {
  color: var(--color-text-disabled) !important;
}

.loading-icon {
  color: currentColor;
}

/* AI交互面板区域 - 可展开/收起 */
.ai-interaction-section {
  order: 1; /* 交互面板在上方 */
  height: 0;
  opacity: 0;
}

.ai-interaction-section.ai-panel-expanded {
  opacity: 1;
  height: auto;
}

/* 面板头部和控制按钮样式已在全局ai-panel.css中定义 */

/* 面板内容和消息列表样式已在全局ai-panel.css中定义 */

/* 调整大小指示器和滚动条样式已在全局ai-panel.css中定义 */

/* 动画效果已在全局ai-panel.css中定义 */

/* 移动端适配 */
.ai-panel-mobile {
  border-radius: 0;
}

.ai-panel-mobile .ai-input-section {
  padding: 8px;
}

.ai-panel-mobile .ai-mode-buttons {
  width: 100%;
}

.ai-panel-mobile .ai-mode-button-group {
  width: 100%;
}

.ai-panel-mobile .ai-mode-btn {
  flex: 1;
}

.ai-panel-mobile .ai-panel-resize-indicator {
  display: none;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .ai-combined-panel {
    max-height: none;
  }

  .ai-input-section {
    padding: 6px;
    min-height: 70px;
    max-height: 150px;
  }

  .ai-input-footer {
    padding: 4px 6px;
  }

  .ai-mode-buttons {
    margin-top: 6px;
  }

  .ai-mode-button-group {
    width: 100%;
    gap: 2px;
  }

  .ai-mode-btn {
    flex: 1;
    font-size: 10px;
    padding: 3px 6px;
    height: 26px;
    min-width: auto;
  }

  .ai-input-field :deep(.el-textarea__inner) {
    font-size: 13px;
  }

  .ai-send-button {
    width: 30px;
    height: 30px;
  }

  .send-icon {
    width: 16px;
    height: 16px;
  }

  .ai-interaction-section {
    max-height: 40vh;
  }

  .ai-panel-header {
    padding: var(--spacing-sm);
  }

  .ai-messages-container {
    padding: var(--spacing-sm);
  }

  .ai-control-btn {
    width: 28px;
    height: 28px;
  }
}

@media (max-width: 480px) {
  .ai-input-section {
    padding: 4px;
    min-height: 60px;
    max-height: 120px;
  }

  .ai-input-footer {
    padding: 2px 4px;
  }

  .ai-mode-buttons {
    margin-top: 4px;
  }

  .ai-mode-btn {
    font-size: 9px;
    padding: 2px 4px;
    height: 24px;
  }

  .ai-input-field :deep(.el-textarea__inner) {
    font-size: 12px;
  }

  .ai-send-button {
    width: 28px;
    height: 28px;
  }

  .send-icon {
    width: 14px;
    height: 14px;
  }

  .ai-interaction-section {
    max-height: 35vh;
  }

  .ai-panel-header {
    padding: var(--spacing-xs) var(--spacing-sm);
    min-height: 28px;
  }

  .ai-control-btn {
    width: 24px;
    height: 24px;
  }

  .ai-panel-title span {
    display: none; /* 超小屏幕隐藏标题文字 */
  }
}

/* 横屏模式适配 */
@media (max-height: 600px) and (orientation: landscape) {
  .ai-interaction-section {
    max-height: 50vh;
  }
}

/* 大屏幕优化 */
@media (min-width: 1200px) {
  .ai-panel-header {
    padding: var(--spacing-md) var(--spacing-lg);
  }

  .ai-messages-container {
    padding: var(--spacing-lg);
  }
}

/* 高对比度模式支持 */
@media (prefers-contrast: high) {
  .ai-interaction-section {
    border-width: 2px;
  }

  .ai-panel-header {
    border-bottom-width: 2px;
  }

  .ai-control-btn:focus {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
}

/* 减少动画模式支持 */
@media (prefers-reduced-motion: reduce) {
  .ai-combined-panel,
  .ai-interaction-section,
  .ai-control-btn,
  .resize-handle {
    transition: none;
  }

  .ai-interaction-section.ai-panel-expanded {
    animation: none;
  }
}
</style>
