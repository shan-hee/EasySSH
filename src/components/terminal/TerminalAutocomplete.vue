<template>
  <div
    v-if="visible && suggestions.length > 0"
    class="terminal-autocomplete"
    :class="{ 'keyboard-navigation': isKeyboardNavigation }"
    :style="positionStyle"
    @mousedown.prevent
    @mousemove="handleMouseMove"
  >
    <div class="autocomplete-header">
      <span class="autocomplete-title">命令建议</span>
      <span class="autocomplete-count">{{ suggestions.length }}</span>
    </div>
    <div class="autocomplete-list" ref="listRef">
      <div
        v-for="(suggestion, index) in suggestions"
        :key="suggestion.id"
        class="autocomplete-item"
        :class="{ 'autocomplete-item--active': index === selectedIndex }"
        @click="selectSuggestion(index)"
        @mouseenter="handleMouseEnter(index)"
        :title="getItemTooltip(suggestion)"
      >
        <div class="autocomplete-item-content">
          <div class="autocomplete-item-main">
            <div class="autocomplete-item-left">
              <span class="autocomplete-command" :title="suggestion.text">{{ suggestion.text }}</span>
              <span class="autocomplete-description" :title="suggestion.description">{{ suggestion.description }}</span>
            </div>
            <div class="autocomplete-item-right">
              <span class="autocomplete-type" :class="`autocomplete-type--${suggestion.type || 'script'}`">
                {{ getTypeLabel(suggestion) }}
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
import { ref, computed, watch, nextTick } from 'vue'

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
    const isKeyboardNavigation = ref(false)

    // 计算位置样式，包含智能位置调整
    const positionStyle = computed(() => {
      const { x, y } = props.position
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

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

    // 监听建议变化，重置选中索引和导航状态
    watch(() => props.suggestions, () => {
      selectedIndex.value = -1  // 默认不选中任何项
      isKeyboardNavigation.value = false
    })

    // 监听选中索引变化，滚动到可见区域
    watch(selectedIndex, async () => {
      await nextTick()
      scrollToSelected()
    })

    // 滚动到选中项
    const scrollToSelected = () => {
      if (!listRef.value) return
      
      const selectedElement = listRef.value.children[selectedIndex.value]
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth'
        })
      }
    }

    // 处理鼠标进入事件
    const handleMouseEnter = (index) => {
      // 只有在非键盘导航模式下才响应鼠标悬浮
      if (!isKeyboardNavigation.value) {
        selectedIndex.value = index
      }
    }

    // 处理鼠标移动事件
    const handleMouseMove = () => {
      // 鼠标移动时重新启用鼠标导航
      isKeyboardNavigation.value = false
    }

    // 选择建议
    const selectSuggestion = (index) => {
      if (index >= 0 && index < props.suggestions.length) {
        selectedIndex.value = index
        emit('select', props.suggestions[index])
      }
    }

    // 获取类型标签
    const getTypeLabel = (suggestion) => {
      const typeLabels = {
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

      // 优先使用 category，然后是 type
      const key = suggestion.category || suggestion.type || 'script'
      return typeLabels[key] || '其他'
    }

    // 获取项目工具提示
    const getItemTooltip = (suggestion) => {
      const parts = []
      if (suggestion.text) {
        parts.push(`${getTypeLabel(suggestion)}: ${suggestion.text}`)
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
    }

    // 键盘导航
    const handleKeydown = (event) => {
      if (!props.visible || props.suggestions.length === 0) return false

      let handled = false

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          event.stopPropagation()
          isKeyboardNavigation.value = true
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
          isKeyboardNavigation.value = true
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
      isKeyboardNavigation,
      selectSuggestion,
      handleKeydown,
      handleMouseEnter,
      handleMouseMove,
      getTypeLabel,
      getItemTooltip
    }
  }
}
</script>

<style scoped>
.terminal-autocomplete {
  position: fixed;
  z-index: 9999;
  background: #1e1e1e;
  border: 1px solid #404040;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
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
  background: #2d2d2d;
  border-bottom: 1px solid #404040;
}

.autocomplete-title {
  color: #cccccc;
  font-weight: 500;
}

.autocomplete-count {
  color: #888888;
  font-size: 11px;
}

.autocomplete-list {
  max-height: 250px;
  overflow-y: auto;
}

.autocomplete-item {
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid #333333;
  transition: background-color 0.15s ease;
  position: relative;
}

.autocomplete-item:last-child {
  border-bottom: none;
}

/* 只有在非键盘导航模式下才应用hover效果 */
.autocomplete-item:hover {
  background: #264f78;
}

/* 键盘导航模式下禁用hover效果 */
.keyboard-navigation .autocomplete-item:hover {
  background: transparent;
}

.autocomplete-item--active {
  background: #264f78;
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
  color: #4fc1ff;
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
  color: #cccccc;
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
  background: #404040;
  color: #cccccc;
  border: 1px solid #555555;
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
  background: #2d2d2d;
  border-top: 1px solid #404040;
}

.autocomplete-hint {
  color: #888888;
  font-size: 10px;
}

/* 滚动条样式 */
.autocomplete-list::-webkit-scrollbar {
  width: 6px;
}

.autocomplete-list::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.autocomplete-list::-webkit-scrollbar-thumb {
  background: #404040;
  border-radius: 3px;
}

.autocomplete-list::-webkit-scrollbar-thumb:hover {
  background: #505050;
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
</style>
