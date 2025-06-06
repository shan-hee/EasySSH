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
        :key="suggestion.id"
        class="autocomplete-item"
        :class="{ 'autocomplete-item--active': index === selectedIndex }"
        @click="selectSuggestion(index)"
        @mouseenter="selectedIndex = index"
      >
        <div class="autocomplete-item-main">
          <span class="autocomplete-command">{{ suggestion.text }}</span>
          <span class="autocomplete-description">{{ suggestion.description }}</span>
        </div>
        <div v-if="suggestion.fullCommand !== suggestion.text" class="autocomplete-full-command">
          {{ suggestion.fullCommand }}
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
    const selectedIndex = ref(0)
    const listRef = ref(null)

    // 计算位置样式
    const positionStyle = computed(() => ({
      left: `${props.position.x}px`,
      top: `${props.position.y}px`
    }))

    // 监听建议变化，重置选中索引
    watch(() => props.suggestions, () => {
      selectedIndex.value = 0
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

    // 选择建议
    const selectSuggestion = (index) => {
      if (index >= 0 && index < props.suggestions.length) {
        selectedIndex.value = index
        emit('select', props.suggestions[index])
      }
    }

    // 键盘导航
    const handleKeydown = (event) => {
      if (!props.visible || props.suggestions.length === 0) return false

      let handled = false

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          event.stopPropagation()
          selectedIndex.value = selectedIndex.value > 0
            ? selectedIndex.value - 1
            : props.suggestions.length - 1
          handled = true
          break

        case 'ArrowDown':
          event.preventDefault()
          event.stopPropagation()
          selectedIndex.value = selectedIndex.value < props.suggestions.length - 1
            ? selectedIndex.value + 1
            : 0
          handled = true
          break

        case 'Tab':
        case 'Enter':
          event.preventDefault()
          event.stopPropagation()
          selectSuggestion(selectedIndex.value)
          handled = true
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
      handleKeydown
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
  min-width: 300px;
  max-width: 500px;
  max-height: 300px;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 12px;
  overflow: hidden;
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
  max-height: 200px;
  overflow-y: auto;
}

.autocomplete-item {
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid #333333;
  transition: background-color 0.15s ease;
}

.autocomplete-item:last-child {
  border-bottom: none;
}

.autocomplete-item:hover,
.autocomplete-item--active {
  background: #264f78;
}

.autocomplete-item-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.autocomplete-command {
  color: #4fc1ff;
  font-weight: 500;
  min-width: 80px;
}

.autocomplete-description {
  color: #cccccc;
  flex: 1;
}

.autocomplete-full-command {
  margin-top: 4px;
  color: #888888;
  font-size: 11px;
  font-style: italic;
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
</style>
