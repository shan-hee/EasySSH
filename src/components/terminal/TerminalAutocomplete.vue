<template>
  <div
    v-if="visible && suggestions.length > 0"
    class="terminal-autocomplete"
    :style="positionStyle"
    @mousedown.prevent
  >
    <div class="autocomplete-header">
      <span class="autocomplete-title">命令建议</span>
      <span class="autocomplete-count">{{ suggestions.length }}</span>
    </div>
    <div class="autocomplete-list" ref="listRef">
      <div
        v-for="(suggestion, index) in suggestions"
        v-memo="[suggestion.id, suggestion.text, suggestion.description, index === selectedIndex]"
        :key="suggestion.id"
        class="autocomplete-item"
        :class="{ 'autocomplete-item--active': index === selectedIndex }"
        @click="selectSuggestion(index)"
        :title="suggestionTooltips[index]"
      >
        <div class="autocomplete-item-content">
          <div class="autocomplete-item-main">
            <div class="autocomplete-item-left">
              <span class="autocomplete-command" :title="suggestion.text">{{ suggestion.text }}</span>
              <span class="autocomplete-description" :title="suggestion.description">{{ suggestion.description }}</span>
            </div>
            <div class="autocomplete-item-right">
              <span class="autocomplete-type" :class="typeClasses[index]">
                {{ typeLabels[index] }}
              </span>
            </div>
          </div>
          <div v-if="suggestion.fullCommand && suggestion.fullCommand !== suggestion.text" class="autocomplete-full-command" :title="suggestion.fullCommand">
            {{ suggestion.fullCommand }}
          </div>
        </div>
      </div>
    </div>
    <div class="autocomplete-footer">
      <span class="autocomplete-hint">↑↓ 选择 • Tab/Enter 确认 • Esc 取消</span>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'

export default {
  name: 'TerminalAutocomplete',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    suggestions: {
      type: Array,
      default: () => []
    },
    position: {
      type: Object,
      default: () => ({ x: 0, y: 0 })
    }
  },
  emits: ['select', 'close'],
  setup(props, { emit }) {
    const selectedIndex = ref(-1)  // 初始化为-1，表示默认不选中
    const listRef = ref(null)
    // 键盘导航为主模式：只通过键盘控制选中状态

    // 缓存视口尺寸
    const viewportSize = ref({ width: window.innerWidth, height: window.innerHeight })

    // 监听窗口大小变化（使用节流）
    let resizeTimer = null
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        viewportSize.value = { width: window.innerWidth, height: window.innerHeight }
      }, 100)
    }

    // 计算位置样式，包含智能位置调整（优化版）
    const positionStyle = computed(() => {
      const { x, y } = props.position
      const { width: viewportWidth, height: viewportHeight } = viewportSize.value

      // 预估自动补全框的尺寸
      const estimatedWidth = Math.min(700, Math.max(350, viewportWidth * 0.4))
      const estimatedHeight = Math.min(350, Math.max(200, props.suggestions.length * 50 + 100))

      // 调整水平位置
      let adjustedX = x
      if (x + estimatedWidth > viewportWidth - 20) {
        adjustedX = Math.max(20, viewportWidth - estimatedWidth - 20)
      }

      // 调整垂直位置
      let adjustedY = y
      if (y + estimatedHeight > viewportHeight - 20) {
        // 如果下方空间不够，尝试显示在上方
        const spaceAbove = y - 20
        const spaceBelow = viewportHeight - y - 20

        if (spaceAbove > spaceBelow && spaceAbove > 200) {
          adjustedY = Math.max(20, y - estimatedHeight)
        } else {
          adjustedY = Math.max(20, viewportHeight - estimatedHeight - 20)
        }
      }

      return {
        left: `${adjustedX}px`,
        top: `${adjustedY}px`,
        maxWidth: `${Math.min(700, viewportWidth - adjustedX - 40)}px`,
        maxHeight: `${Math.min(350, viewportHeight - adjustedY - 40)}px`
      }
    })

    // 缓存类型标签映射
    const typeLabelMap = {
      script: '脚本',
      word: '单词',
      commands: '命令',
      options: '选项',
      development: '开发',
      network: '网络',
      system: '系统',
      files: '文件',
      extensions: '扩展名'
    }

    // 计算属性：预计算类型标签
    const typeLabels = computed(() => {
      return props.suggestions.map(suggestion => {
        const key = suggestion.category || suggestion.type || 'script'
        return typeLabelMap[key] || '其他'
      })
    })

    // 计算属性：预计算类型CSS类
    const typeClasses = computed(() => {
      return props.suggestions.map(suggestion => {
        const type = suggestion.type || 'script'
        return `autocomplete-type autocomplete-type--${type}`
      })
    })

    // 计算属性：预计算工具提示
    const suggestionTooltips = computed(() => {
      return props.suggestions.map(suggestion => {
        const parts = []
        if (suggestion.text) {
          const typeLabel = typeLabelMap[suggestion.category || suggestion.type || 'script'] || '其他'
          parts.push(`${typeLabel}: ${suggestion.text}`)
        }
        if (suggestion.description) {
          parts.push(`描述: ${suggestion.description}`)
        }
        if (suggestion.fullCommand && suggestion.fullCommand !== suggestion.text) {
          parts.push(`完整命令: ${suggestion.fullCommand}`)
        }
        if (suggestion.category) {
          parts.push(`类别: ${suggestion.category}`)
        }
        return parts.join('\n')
      })
    })

    // 监听建议变化，重置选中索引
    watch(() => props.suggestions, () => {
      selectedIndex.value = -1  // 默认不选中任何项
    })

    // 监听选中索引变化，滚动到可见区域
    watch(selectedIndex, async () => {
      await nextTick()
      scrollToSelected()
    })

    // 滚动到选中项（优化版）
    const scrollToSelected = () => {
      if (!listRef.value || selectedIndex.value < 0) return

      const selectedElement = listRef.value.children[selectedIndex.value]
      if (selectedElement) {
        // 使用更高效的滚动方式
        selectedElement.scrollIntoView({
          block: 'nearest',
          behavior: 'auto' // 改为auto以提升性能
        })
      }
    }

    // 注释：移除鼠标悬浮选中功能，改为键盘导航为主

    // 选择建议
    const selectSuggestion = (index) => {
      if (index >= 0 && index < props.suggestions.length) {
        selectedIndex.value = index
        emit('select', props.suggestions[index])
      }
    }

    // 添加窗口大小变化监听
    window.addEventListener('resize', handleResize)

    // 组件卸载时清理
    const cleanup = () => {
      window.removeEventListener('resize', handleResize)
      if (resizeTimer) clearTimeout(resizeTimer)
    }

    onUnmounted(cleanup)

    // 键盘导航
    const handleKeydown = (event) => {
      if (!props.visible || props.suggestions.length === 0) return false

      let handled = false

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          event.stopPropagation()
          if (selectedIndex.value === -1) {
            // 如果当前没有选中项，选中最后一项
            selectedIndex.value = props.suggestions.length - 1
          } else if (selectedIndex.value > 0) {
            selectedIndex.value = selectedIndex.value - 1
          } else {
            // 循环到最后一项
            selectedIndex.value = props.suggestions.length - 1
          }
          handled = true
          break

        case 'ArrowDown':
          event.preventDefault()
          event.stopPropagation()
          if (selectedIndex.value === -1) {
            // 如果当前没有选中项，选中第一项
            selectedIndex.value = 0
          } else if (selectedIndex.value < props.suggestions.length - 1) {
            selectedIndex.value = selectedIndex.value + 1
          } else {
            // 循环到第一项
            selectedIndex.value = 0
          }
          handled = true
          break

        case 'Tab':
          event.preventDefault()
          event.stopPropagation()
          selectSuggestion(selectedIndex.value)
          handled = true
          break

        case 'Enter':
          if (selectedIndex.value >= 0 && selectedIndex.value < props.suggestions.length) {
            // 有选中项时，阻止默认行为并应用补全
            event.preventDefault()
            event.stopPropagation()
            selectSuggestion(selectedIndex.value)
            handled = true
          } else {
            // 无选中项时，关闭补全框但不阻止默认行为，让终端正常处理回车
            emit('close')
            handled = false  // 不阻止默认行为
          }
          break

        case 'Escape':
          event.preventDefault()
          event.stopPropagation()
          emit('close')
          handled = true
          break
      }

      return handled
    }

    return {
      selectedIndex,
      listRef,
      positionStyle,
      selectSuggestion,
      handleKeydown,
      typeLabels,
      typeClasses,
      suggestionTooltips,
      cleanup
    }
  }
}
</script>

<style scoped>
.terminal-autocomplete {
  position: fixed;
  z-index: 9999;
  background: var(--color-bg-container);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  box-shadow: var(--shadow-lg);
  min-width: 350px;
  max-width: 700px;
  max-height: 350px;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 12px;
  overflow: hidden;
  /* 确保在屏幕边缘时自动调整位置 */
  transform-origin: top left;
}

.autocomplete-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--color-bg-muted);
  border-bottom: 1px solid var(--color-border-default);
}

.autocomplete-title {
  color: var(--color-text-primary);
  font-weight: 500;
}

.autocomplete-count {
  color: var(--color-text-secondary);
  font-size: 11px;
}

.autocomplete-list {
  max-height: 250px;
  overflow-y: auto;
}

.autocomplete-item {
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border-light);
  transition: background-color 0.15s ease;
  position: relative;
}

.autocomplete-item:last-child {
  border-bottom: none;
}

/* 键盘导航为主：只有选中状态有背景色，鼠标悬浮无效果 */
.autocomplete-item--active {
  background: var(--color-primary-lightest);
}

/* 鼠标悬浮时只显示轻微的视觉反馈，但不改变选中状态 */
.autocomplete-item:hover {
  background: var(--color-bg-muted);
}

.autocomplete-item-content {
  width: 100%;
  overflow: hidden;
}

.autocomplete-item-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-height: 20px;
}

.autocomplete-item-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
  min-width: 0; /* 允许内容收缩 */
}

.autocomplete-item-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.autocomplete-command {
  color: var(--color-primary);
  font-weight: 500;
  flex-shrink: 0;
  min-width: 120px;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.autocomplete-description {
  color: var(--color-text-regular);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
  min-width: 0; /* 允许flex项目收缩到内容宽度以下 */
}

.autocomplete-type {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: var(--color-bg-muted);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-default);
}

/* 不同类型的颜色 */
.autocomplete-type--script {
  background: #0e4f1c;
  color: #4ec9b0;
  border-color: #4ec9b0;
}

.autocomplete-type--word {
  background: #1e3a8a;
  color: #60a5fa;
  border-color: #60a5fa;
}

.autocomplete-type--commands {
  background: #7c2d12;
  color: #fb923c;
  border-color: #fb923c;
}

.autocomplete-type--options {
  background: #581c87;
  color: #c084fc;
  border-color: #c084fc;
}

.autocomplete-type--development {
  background: #164e63;
  color: #22d3ee;
  border-color: #22d3ee;
}

.autocomplete-type--network {
  background: #065f46;
  color: #34d399;
  border-color: #34d399;
}

.autocomplete-type--system {
  background: #7c2d12;
  color: #fbbf24;
  border-color: #fbbf24;
}

.autocomplete-type--files {
  background: #4c1d95;
  color: #a78bfa;
  border-color: #a78bfa;
}

.autocomplete-type--extensions {
  background: #831843;
  color: #f472b6;
  border-color: #f472b6;
}

.autocomplete-full-command {
  margin-top: 6px;
  color: #888888;
  font-size: 11px;
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}

.autocomplete-footer {
  padding: 6px 12px;
  background: var(--color-bg-container);
  border-top: 1px solid var(--color-border-default);
}

.autocomplete-hint {
  color: var(--color-text-secondary);
  font-size: 10px;
}

/* 滚动条样式 - 默认浅色主题 */
.autocomplete-list::-webkit-scrollbar {
  width: 6px;
}

.autocomplete-list::-webkit-scrollbar-track {
  background: var(--color-bg-container);
}

.autocomplete-list::-webkit-scrollbar-thumb {
  background: var(--color-border-default);
  border-radius: 3px;
}

.autocomplete-list::-webkit-scrollbar-thumb:hover {
  background: var(--color-border-dark);
}

/* 响应式设计 - 小屏幕适配 */
@media (max-width: 768px) {
  .terminal-autocomplete {
    min-width: 280px;
    max-width: 90vw;
    max-height: 40vh;
  }

  .autocomplete-command {
    min-width: 80px;
    max-width: 200px;
  }

  .autocomplete-item {
    padding: 8px 10px;
  }

  .autocomplete-item-main {
    gap: 8px;
  }
}

/* 超大屏幕优化 */
@media (min-width: 1200px) {
  .terminal-autocomplete {
    max-width: 800px;
  }

  .autocomplete-command {
    max-width: 400px;
  }
}

/* 高对比度模式支持 */
@media (prefers-contrast: high) {
  .terminal-autocomplete {
    border-color: #ffffff;
    box-shadow: 0 4px 12px rgba(255, 255, 255, 0.2);
  }

  .autocomplete-item--active {
    background: #0078d4;
  }

  .autocomplete-command {
    color: #ffffff;
  }
}

/* 减少动画的用户偏好 */
@media (prefers-reduced-motion: reduce) {
  .autocomplete-item {
    transition: none;
  }
}

/* 深色主题特定样式 */
:root[data-theme="dark"] .terminal-autocomplete,
.dark-theme .terminal-autocomplete {
  background: #1e1e1e;
  border-color: #404040;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

:root[data-theme="dark"] .autocomplete-header,
.dark-theme .autocomplete-header {
  background: #2d2d2d;
  border-bottom-color: #404040;
}

:root[data-theme="dark"] .autocomplete-title,
.dark-theme .autocomplete-title {
  color: #cccccc;
}

:root[data-theme="dark"] .autocomplete-count,
.dark-theme .autocomplete-count {
  color: #888888;
}

:root[data-theme="dark"] .autocomplete-item,
.dark-theme .autocomplete-item {
  border-bottom-color: #333333;
}

:root[data-theme="dark"] .autocomplete-item--active,
.dark-theme .autocomplete-item--active {
  background: #264f78;
}

:root[data-theme="dark"] .autocomplete-item:hover,
.dark-theme .autocomplete-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

:root[data-theme="dark"] .autocomplete-command,
.dark-theme .autocomplete-command {
  color: #4fc1ff;
}

:root[data-theme="dark"] .autocomplete-description,
.dark-theme .autocomplete-description {
  color: #cccccc;
}

:root[data-theme="dark"] .autocomplete-type,
.dark-theme .autocomplete-type {
  background: #404040;
  color: #cccccc;
  border-color: #555555;
}

/* 深色主题footer样式 */
:root[data-theme="dark"] .autocomplete-footer,
.dark-theme .autocomplete-footer,
html[data-theme="dark"] .autocomplete-footer {
  background: #2d2d2d !important;
  border-top-color: #404040 !important;
}

:root[data-theme="dark"] .autocomplete-hint,
.dark-theme .autocomplete-hint,
html[data-theme="dark"] .autocomplete-hint {
  color: #888888 !important;
}

/* 深色主题滚动条样式 */
:root[data-theme="dark"] .autocomplete-list::-webkit-scrollbar-track,
.dark-theme .autocomplete-list::-webkit-scrollbar-track,
html[data-theme="dark"] .autocomplete-list::-webkit-scrollbar-track {
  background: #1e1e1e !important;
}

:root[data-theme="dark"] .autocomplete-list::-webkit-scrollbar-thumb,
.dark-theme .autocomplete-list::-webkit-scrollbar-thumb,
html[data-theme="dark"] .autocomplete-list::-webkit-scrollbar-thumb {
  background: #404040 !important;
}

:root[data-theme="dark"] .autocomplete-list::-webkit-scrollbar-thumb:hover,
.dark-theme .autocomplete-list::-webkit-scrollbar-thumb:hover,
html[data-theme="dark"] .autocomplete-list::-webkit-scrollbar-thumb:hover {
  background: #505050 !important;
}

/* 浅色主题footer样式 */
:root[data-theme="light"] .autocomplete-footer,
.light-theme .autocomplete-footer,
html[data-theme="light"] .autocomplete-footer {
  background: #ffffff !important;
  border-top-color: #dcdfe6 !important;
}

:root[data-theme="light"] .autocomplete-hint,
.light-theme .autocomplete-hint,
html[data-theme="light"] .autocomplete-hint {
  color: #909399 !important;
}

/* 浅色主题滚动条样式 */
:root[data-theme="light"] .autocomplete-list::-webkit-scrollbar-track,
.light-theme .autocomplete-list::-webkit-scrollbar-track,
html[data-theme="light"] .autocomplete-list::-webkit-scrollbar-track {
  background: #ffffff !important;
}

:root[data-theme="light"] .autocomplete-list::-webkit-scrollbar-thumb,
.light-theme .autocomplete-list::-webkit-scrollbar-thumb,
html[data-theme="light"] .autocomplete-list::-webkit-scrollbar-thumb {
  background: #dcdfe6 !important;
}

:root[data-theme="light"] .autocomplete-list::-webkit-scrollbar-thumb:hover,
.light-theme .autocomplete-list::-webkit-scrollbar-thumb:hover,
html[data-theme="light"] .autocomplete-list::-webkit-scrollbar-thumb:hover {
  background: #d4d7de !important;
}
</style>
