<template>
  <div class="form-item-checkbox" @click="toggleChecked">
    <div 
      class="checkbox-wrapper" 
      :class="{ 'checked': modelValue }" 
    >
      <div class="checkbox-inner"></div>
      <div class="checkbox-check"></div>
    </div>
    <span v-if="label">{{ label }}</span>
  </div>
</template>

<script>
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'BaseCheckbox',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    label: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const toggleChecked = () => {
      emit('update:modelValue', !props.modelValue)
    }

    return {
      toggleChecked
    }
  }
})
</script>

<style scoped>
.form-item-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.form-item-checkbox span {
  font-size: 12px;
  color: #fff;
  font-weight: normal;
}

.checkbox-wrapper {
  position: relative;
  width: 16px;
  height: 16px;
  border: 1px solid #666;
  border-radius: 2px;
  background-color: transparent;
  transition: all 0.3s;
  overflow: hidden;
  cursor: pointer;
}

.checkbox-wrapper.checked {
  background-color: transparent;
  border-color: transparent;
}

.checkbox-inner {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: transparent;
  transition: all 0.3s;
}

.checkbox-wrapper.checked .checkbox-inner {
  background-color: transparent;
}

.checkbox-check {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border: 2px solid transparent;
  border-top: 0;
  border-right: 0;
  transform: translate(-50%, -50%) rotate(-45deg) scale(0);
  transition: all 0.3s;
  transform-origin: center;
  opacity: 0;
}

.checkbox-wrapper.checked .checkbox-check {
  width: 9px;
  height: 5px;
  border-color: #fff;
  transform: translate(-50%, -70%) rotate(-45deg) scale(1);
  opacity: 1;
}
</style> 