<template>
  <div class="custom-checkbox" @click="toggleChecked">
    <div 
      class="checkbox-wrapper" 
      :class="{ 'checked': modelValue }"
    >
      <div class="checkbox-inner"></div>
      <div class="checkbox-check"></div>
    </div>
    <span v-if="label" class="checkbox-label">{{ label }}</span>
  </div>
</template>

<script>
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'Checkbox',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    label: {
      type: String,
      default: ''
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    const toggleChecked = () => {
      if (props.disabled) return
      
      const newValue = !props.modelValue
      emit('update:modelValue', newValue)
      emit('change', newValue)
    }
    
    return {
      toggleChecked
    }
  }
})
</script>

<style scoped>
/* 使用scoped样式避免与全局样式冲突 */
.custom-checkbox {
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

/* 复选框容器 - 与统一样式保持一致 */
.checkbox-wrapper {
  position: relative;
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border-default);
  border-radius: 3px;
  background-color: var(--color-bg-container);
  cursor: pointer;
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.custom-checkbox:hover .checkbox-wrapper {
  border-color: var(--color-primary-light);
}

/* 选中状态 - 背景变为主题色 */
.checkbox-wrapper.checked {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

/* 内部装饰元素（暂时不使用） */
.checkbox-inner {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 10px;
  background-color: var(--color-bg-container);
  border-radius: 1px;
  transform: translate(-50%, -50%) scale(0);
  transition: transform var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 勾选标记 - 未选中时隐藏 */
.checkbox-check {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 8px;
  border: solid var(--color-bg-container);
  border-width: 0 2px 2px 0;
  transform: translate(-50%, -60%) rotate(45deg) scale(0);
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
  opacity: 0;
}

/* 选中时显示勾选标记 */
.checkbox-wrapper.checked .checkbox-check {
  width: 5px;
  height: 9px;
  border-color: var(--color-bg-container);
  transform: translate(-50%, -60%) rotate(45deg) scale(1);
  opacity: 1;
}

.checkbox-label {
  margin-left: 8px;
  font-size: 12px;
  color: var(--color-text-primary);
  font-weight: normal;
}
</style>