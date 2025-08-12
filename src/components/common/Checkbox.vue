<template>
  <label class="custom-checkbox" :for="checkboxId">
    <input
      type="checkbox"
      :id="checkboxId"
      :checked="modelValue"
      :disabled="disabled"
      @change="toggleChecked"
      style="display: none;"
    >
    <span class="check">
      <svg width="18px" height="18px" viewBox="0 0 18 18">
        <path d="M 1 1 L 17 1 L 17 17 L 1 17 Z"></path>
        <polyline points="4 9 8 13 14 5"></polyline>
      </svg>
    </span>
    <span v-if="label" class="checkbox-label">{{ label }}</span>
  </label>
</template>

<script>
import { defineComponent, computed } from 'vue'

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
    // 生成唯一的 checkbox ID
    const checkboxId = computed(() => `checkbox-${Math.random().toString(36).substring(2, 11)}`)

    const toggleChecked = (event) => {
      if (props.disabled) return

      const newValue = event.target.checked
      emit('update:modelValue', newValue)
      emit('change', newValue)
    }

    return {
      checkboxId,
      toggleChecked
    }
  }
})
</script>

<style scoped>
/* Variation of work by @mrhyddenn for Radios */
/* 防御性CSS设计 - 确保布局稳定性 */
.custom-checkbox {
  /* 核心布局样式 - 使用高优先级确保不被覆盖 */
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;

  /* 基础样式 */
  user-select: none;
  cursor: pointer;
  box-sizing: border-box;

  /* 防止被全局样式影响 */
  text-align: left;
  min-width: auto;
  margin-right: 0;
}

.check {
  position: relative;
  width: 18px;
  height: 18px;
  -webkit-tap-highlight-color: transparent;
  transform: translate3d(0, 0, 0);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.check svg {
  position: relative;
  z-index: 1;
  fill: none;
  border-radius: 3px;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke: var(--color-border-default, #c8ccd4);
  stroke-width: 2;
  transform: translate3d(0, 0, 0);
  transition: stroke 0.2s ease;
}

.check svg path {
  stroke-dasharray: 64;
  stroke-dashoffset: 0;
}

.check svg polyline {
  stroke-dasharray: 22;
  stroke-dashoffset: 66;
}

.check:hover:before {
  opacity: 1;
}

.custom-checkbox:hover .check svg {
  stroke: var(--color-primary, #a3e583);
}

.custom-checkbox input[type="checkbox"]:checked ~ .check svg {
  stroke: var(--color-primary, #a3e583);
}

.custom-checkbox input[type="checkbox"]:checked ~ .check svg path {
  stroke-dashoffset: 64;
  transition: all 0.3s linear;
}

.custom-checkbox input[type="checkbox"]:checked ~ .check svg polyline {
  stroke-dashoffset: 42;
  transition: all 0.2s linear;
  transition-delay: 0.15s;
}

.custom-checkbox:has(input:disabled) {
  cursor: not-allowed;
}

.custom-checkbox:has(input:disabled) .check {
  opacity: 0.5;
}

.custom-checkbox:has(input:disabled) .checkbox-label {
  opacity: 0.5;
}

.custom-checkbox:has(input:disabled):hover .check svg {
  stroke: var(--color-border-default, #c8ccd4);
}

.checkbox-label {
  font-size: 12px;
  color: var(--color-text-primary);
  font-weight: normal;
  cursor: pointer;
  line-height: 18px;
}
</style>