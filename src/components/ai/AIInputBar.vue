<template>
  <div class="ai-input-bar" :class="{ 'ai-input-bar-mobile': isMobile }">
    <!-- AI输入栏主体 -->
    <div class="ai-input-body">
      <!-- 输入区域 - 带内置发送按钮 -->
      <div class="ai-input-area">
        <!-- 顶部控制栏：模式按钮和字数统计 -->
        <div class="ai-input-header">
          <div class="ai-mode-buttons">
            <el-button-group>
              <el-button
                :type="selectedMode === 'chat' ? 'primary' : 'default'"
                size="small"
                @click="selectMode('chat')"
                :disabled="isProcessing"
              >
                💬 Chat
              </el-button>
              <el-button
                :type="selectedMode === 'agent' ? 'primary' : 'default'"
                size="small"
                @click="selectMode('agent')"
                :disabled="isProcessing"
              >
                🤖 Agent
              </el-button>
              <el-button
                :type="selectedMode === 'exec' ? 'primary' : 'default'"
                size="small"
                @click="selectMode('exec')"
                :disabled="isProcessing"
              >
                ⚡ 执行
              </el-button>
            </el-button-group>
          </div>

          <div class="ai-word-count">
            {{ inputText.length }}/200
          </div>
        </div>

        <div class="ai-input-wrapper">
          <el-input
            v-model="inputText"
            type="textarea"
            :placeholder="getPlaceholder()"
            :rows="1"
            :maxlength="200"
            resize="none"
            class="ai-input-field"
            @keydown="handleKeydown"
            @focus="handleInputFocus"
            @blur="handleInputBlur"
            :disabled="isProcessing"
          />
          <!-- 内置发送按钮 - 纯图标 -->
          <div
            class="ai-send-button-inline"
            @click="canSend && !isProcessing ? handleSend() : null"
            :class="{ 'disabled': !canSend || isProcessing }"
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
          </div>
        </div>
      </div>
    </div>

    <!-- AI响应现在直接显示在终端中，不需要单独的响应区域 -->
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElInput, ElButton, ElButtonGroup, ElMessage } from 'element-plus'


// Props
const props = defineProps({
  terminalId: {
    type: String,
    required: true
  },
  aiService: {
    type: Object,
    required: true
  },
  isMobile: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits(['ai-response', 'mode-change', 'input-focus', 'input-blur', 'execute-command'])

// 响应式数据
const inputText = ref('')
const selectedMode = ref('chat')
const isProcessing = ref(false)



// 计算属性
const canSend = computed(() => {
  return inputText.value.trim().length > 0 && !isProcessing.value && props.aiService?.isEnabled
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

const handleKeydown = (event) => {
  // Ctrl+Enter 或 Cmd+Enter 发送
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    handleSend()
  }
  
  // Escape 清空输入
  if (event.key === 'Escape') {
    inputText.value = ''
  }
}

const handleInputFocus = () => {
  emit('input-focus')
}

const handleInputBlur = () => {
  emit('input-blur')
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
        // 清空输入框
        inputText.value = ''

        // 发送响应事件到终端显示
        emit('ai-response', {
          mode: selectedMode.value,
          content: result.content,
          success: true
        })

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





// 监听AI服务状态变化
watch(() => props.aiService?.isEnabled, (newValue) => {
  if (!newValue) {
    isProcessing.value = false
  }
})
</script>

<style scoped>
.ai-input-bar {
  background: transparent;
  border-top: 1px solid var(--color-border-default);
  border-radius: 8px 8px 0 0;
  box-shadow: none;
  /* 使用与主题切换一致的过渡效果 */
  transition:
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    box-shadow 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  height: 100%;
  max-height: 200px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ai-input-bar:hover {
  box-shadow: none;
}

/* 头部样式 */
.ai-input-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  background: transparent;
  /* border-bottom: 1px solid var(--color-border-default); */
  min-height: 28px;
  flex-shrink: 0;
  /* 添加平滑的主题切换过渡效果 */
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}





/* 主体样式 */
.ai-input-body {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  /* 添加平滑的主题切换过渡效果 */
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.ai-input-area {
  flex: 1;
}

/* 输入头部控制栏 */
.ai-input-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 输入框包装器 - 支持内置按钮 */
.ai-input-wrapper {
  position: relative;
  width: 100%;
}

.ai-input-field {
  width: 100%;
}

.ai-input-field :deep(.el-textarea__inner) {
  padding-right: 40px !important; /* 为内置按钮留出空间 */
  border-radius: 6px !important;
  border: 1px solid var(--color-border-default) !important;
  background: transparent !important;
  color: var(--color-text-primary) !important;
  font-size: 13px !important;
  line-height: 1.4 !important;
  resize: none !important;
  /* 添加平滑的主题切换过渡效果 */
  transition:
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
  box-shadow: none !important;
}

.ai-input-field :deep(.el-textarea__inner):hover:not(:focus) {
  border-color: var(--color-border-default) !important;
  box-shadow: none !important;
  /* 继承过渡效果 */
}

.ai-input-field :deep(.el-textarea__inner):focus {
  border-color: var(--color-primary) !important;
  box-shadow: none !important;
  outline: none !important;
  /* 继承过渡效果 */
}

/* 字数统计样式 */
.ai-word-count {
  font-size: 11px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  /* 添加平滑的主题切换过渡效果 */
  transition: color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

/* 内置发送按钮 - 纯图标样式 */
.ai-send-button-inline {
  position: absolute;
  right: 0px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 4px;
  /* 结合主题切换和交互过渡效果 */
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 0.2s ease;
}

.ai-send-button-inline:hover:not(.disabled) {
  background-color: transparent;
  opacity: 0.8;
}

.ai-send-button-inline.disabled {
  cursor: not-allowed;
}

.send-icon {
  color: var(--color-primary);
  /* 结合主题切换和交互过渡效果 */
  transition:
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    transform 0.2s ease;
}

.send-icon:hover {
  color: var(--color-primary-hover);
  transform: scale(1.1);
}

.send-icon-disabled {
  color: var(--color-text-disabled) !important;
  cursor: not-allowed !important;
  /* 添加平滑的主题切换过渡效果 */
  transition: color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
}

.send-icon-disabled:hover {
  transform: none !important;
}

.loading-icon {
  color: var(--color-primary);
  /* 添加平滑的主题切换过渡效果 */
  transition: color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

/* 模式按钮样式 - 现在在顶部 */
.ai-mode-buttons {
  display: flex;
  justify-content: center;
  margin-bottom: 4px;
  /* 添加平滑的主题切换过渡效果 */
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.ai-mode-buttons :deep(.el-button-group) {
  display: flex;
}





.ai-mode-buttons :deep(.el-button) {
  font-size: 11px;
  padding: 2px 6px;
  height: 24px;
  /* 为Element Plus按钮添加平滑的主题切换过渡效果 */
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important,
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important,
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
}

.send-icon {
  margin-right: 4px;
}

/* AI响应现在直接显示在终端中，不需要单独的响应区域样式 */

/* 移动端适配 */
.ai-input-bar-mobile {
  border-radius: 0;
}

.ai-input-bar-mobile .ai-input-body {
  padding: 8px;
}



.ai-input-bar-mobile .ai-mode-buttons {
  width: 100%;
}

.ai-input-bar-mobile .ai-mode-buttons :deep(.el-button-group) {
  width: 100%;
}

.ai-input-bar-mobile .ai-mode-buttons :deep(.el-button) {
  flex: 1;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .ai-input-bar {
    max-height: 200px;
  }

  .ai-input-body {
    padding: 6px;
    gap: 6px;
  }

  .ai-mode-buttons {
    margin-bottom: 6px;
  }

  .ai-mode-buttons :deep(.el-button-group) {
    width: 100%;
    display: flex;
  }

  .ai-mode-buttons :deep(.el-button) {
    flex: 1;
    font-size: 10px;
    padding: 3px 8px;
    height: 24px;
  }

  .ai-input-field :deep(.el-textarea__inner) {
    font-size: 13px;
    padding-right: 35px !important;
  }

  .ai-send-button-inline {
    right: 8px;
    padding: 3px;
  }

  .ai-word-count {
    font-size: 10px;
  }

  .send-icon {
    width: 16px;
    height: 16px;
  }


}

@media (max-width: 480px) {
  .ai-input-bar {
    max-height: 150px;
  }

  .ai-input-body {
    padding: 4px;
    gap: 4px;
  }

  .ai-mode-buttons {
    margin-bottom: 4px;
  }

  .ai-mode-buttons :deep(.el-button) {
    font-size: 9px;
    padding: 2px 6px;
    height: 22px;
  }

  .ai-input-field :deep(.el-textarea__inner) {
    font-size: 12px;
    padding-right: 30px !important;
  }

  .ai-send-button-inline {
    right: 6px;
    padding: 2px;
  }

  .ai-word-count {
    font-size: 9px;
  }

  .send-icon {
    width: 14px;
    height: 14px;
  }


}
</style>
