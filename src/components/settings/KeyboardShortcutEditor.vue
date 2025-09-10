<template>
  <div
    class="keyboard-shortcut-editor"
    :class="{ editing: isEditing }"
    @click="startEditing"
    @keydown.stop
  >
    <div v-if="!isEditing" class="shortcut-content">
      <span class="shortcut-key">{{ modelValue }}</span>
    </div>
    <div v-else class="editing-indicator">
      <span class="editing-text">{{ recordedKeys || '请按下快捷键组合...' }}</span>
    </div>
  </div>
</template>

<script>
export default {
  name: 'KeyboardShortcutEditor',
  props: {
    modelValue: {
      type: String,
      required: true
    }
  },
  emits: ['update:modelValue'],
  data() {
    return {
      isEditing: false,
      recordedKeys: '',
      keysPressed: new Set(),
      modifierKeys: ['Control', 'Alt', 'Shift', 'Meta']
    };
  },
  methods: {
    startEditing() {
      if (this.isEditing) return;

      this.isEditing = true;
      this.recordedKeys = '';
      this.keysPressed.clear();

      // 添加全局事件监听器
      document.addEventListener('keydown', this.handleKeyDown);
      document.addEventListener('keyup', this.handleKeyUp);

      // 点击其他地方关闭编辑
      setTimeout(() => {
        document.addEventListener('click', this.handleOutsideClick);
      }, 10);
    },

    stopEditing() {
      if (!this.isEditing) return;

      this.isEditing = false;

      // 移除全局事件监听器
      document.removeEventListener('keydown', this.handleKeyDown);
      document.removeEventListener('keyup', this.handleKeyUp);
      document.removeEventListener('click', this.handleOutsideClick);

      // 如果有有效的按键记录，则更新值
      if (this.recordedKeys) {
        this.$emit('update:modelValue', this.recordedKeys);
      }
    },

    handleKeyDown(event) {
      // 如果不是编辑状态，不处理
      if (!this.isEditing) return;

      // 阻止默认行为，如Ctrl+S保存页面等
      event.preventDefault();
      event.stopPropagation();

      // 记录按下的键
      this.keysPressed.add(event.key);

      // 更新显示的按键组合
      this.updateRecordedKeys();
    },

    handleKeyUp(event) {
      // 如果不是编辑状态，不处理
      if (!this.isEditing) return;

      // 阻止事件冒泡
      event.stopPropagation();

      // 当所有键都释放后，停止编辑模式
      if (
        event.key === 'Control' ||
        event.key === 'Alt' ||
        event.key === 'Shift' ||
        event.key === 'Meta'
      ) {
        // 移除释放的修饰键
        this.keysPressed.delete(event.key);

        // 如果没有其他键被按下，且此时没有修饰键被按下，则结束编辑
        if (this.keysPressed.size === 0) {
          this.stopEditing();
        } else {
          // 否则更新显示
          this.updateRecordedKeys();
        }
      } else {
        // 非修饰键被释放，直接停止编辑
        this.keysPressed.delete(event.key);
        this.stopEditing();
      }
    },

    handleOutsideClick(event) {
      // 如果点击的不是编辑器本身，则停止编辑
      if (!this.$el.contains(event.target)) {
        this.stopEditing();
      }
    },

    updateRecordedKeys() {
      const keys = Array.from(this.keysPressed);

      // 将修饰键排在前面
      const modifiers = keys.filter(key => this.modifierKeys.includes(key));
      const otherKeys = keys.filter(key => !this.modifierKeys.includes(key));

      // 格式化修饰键
      const formattedModifiers = modifiers.map(key => {
        if (key === 'Control') return 'Ctrl';
        if (key === 'Meta') return 'Win'; // Windows键
        return key;
      });

      // 合并所有键名
      const allKeys = [...formattedModifiers, ...otherKeys];

      // 特殊键名映射
      const specialKeyMap = {
        ' ': 'Space',
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
        Escape: 'Esc',
        Enter: '⏎',
        Backspace: '⌫',
        Delete: 'Del',
        Tab: 'Tab',
        Home: 'Home',
        End: 'End',
        PageUp: 'PgUp',
        PageDown: 'PgDn'
      };

      // 格式化并设置记录的键
      this.recordedKeys = allKeys
        .map(key => {
          return specialKeyMap[key] || key;
        })
        .join('+');
    }
  }
};
</script>

<style scoped>
.keyboard-shortcut-editor {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 80px;
  height: 28px;
  background-color: #333;
  border-radius: 4px;
  padding: 0 8px;
  cursor: pointer;
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
  user-select: none;
  position: relative;
  border: 1px solid transparent;
}

.shortcut-key,
.editing-text {
  font-family: monospace;
  font-size: 13px;
  color: #e0e0e0;
}

.keyboard-shortcut-editor.editing {
  background-color: #333;
  box-shadow: none;
  animation: none;
  border: 1px solid #0083d3;
  outline: none;
}

.editing-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.editing-text {
  opacity: 0.8;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(100, 150, 220, 0.7);
  }
  70% {
    box-shadow: 0 0 0 4px rgba(100, 150, 220, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(100, 150, 220, 0);
  }
}

/* 浅色主题适配 */
:root[data-theme='light'] .keyboard-shortcut-editor {
  background-color: rgba(200, 200, 200, 0.8);
}

:root[data-theme='light'] .shortcut-key,
:root[data-theme='light'] .editing-text {
  color: #333;
}

:root[data-theme='light'] .keyboard-shortcut-editor.editing {
  background-color: rgba(180, 200, 230, 0.7);
  box-shadow: 0 0 0 2px rgba(120, 160, 220, 0.5);
}
</style>
