<template>
  <transition name="modal-fade">
    <div v-if="visible" class="modal-overlay" @click="handleOverlayClick">
      <div class="modal-container" :class="customClass" @click.stop>
        <div class="modal-header">
          <span>{{ title }}</span>
          <span class="close-btn" @click="handleClose">&times;</span>
        </div>
        
        <div v-if="tabs && tabs.length" class="modal-tab">
          <div 
            v-for="tab in tabs" 
            :key="tab"
            class="tab-item"
            :class="{ active: activeTab === tab }"
            @click="activeTab = tab"
          >
            {{ tab }}
          </div>
        </div>
        
        <div class="modal-body">
          <slot></slot>
        </div>
        
        <div v-if="!hideFooter" class="modal-footer">
          <template v-if="buttons">
            <button 
              v-for="button in buttons" 
              :key="button.text"
              :class="['modal-btn', `btn-${button.type}`]"
              @click="button.onClick"
            >
              {{ button.text }}
            </button>
          </template>
          <template v-else>
            <button class="modal-btn btn-cancel" @click="handleClose">取消</button>
            <button class="modal-btn btn-confirm" @click="handleConfirm">确定</button>
          </template>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
import { ref, defineComponent } from 'vue'

export default defineComponent({
  name: 'Modal',
  props: {
    title: {
      type: String,
      default: '模态框'
    },
    visible: {
      type: Boolean,
      default: false
    },
    tabs: {
      type: Array,
      default: () => []
    },
    customClass: {
      type: String,
      default: ''
    },
    buttons: {
      type: Array,
      default: null
    },
    hideFooter: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:visible', 'close', 'confirm'],
  setup(props, { emit }) {
    const activeTab = ref(0)

    const handleClose = () => {
      emit('update:visible', false)
      emit('close')
    }

    const handleConfirm = () => {
      emit('confirm')
      handleClose()
    }

    const handleOverlayClick = () => {
      // Implementation of handleOverlayClick
    }

    return {
      activeTab,
      handleClose,
      handleConfirm,
      handleOverlayClick
    }
  }
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.modal-container {
  width: 550px;
  background-color: var(--color-bg-page);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.modal-header {
  padding: 12px 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--color-bg-muted);
}

.modal-header span {
  color: var(--color-text-primary);
  font-weight: bold;
}

.close-btn {
  cursor: pointer;
  font-size: 20px;
  color: var(--color-text-regular);
}

.modal-tab {
  display: flex;
}

.tab-item {
  padding: 10px 15px;
  color: var(--color-text-primary);
  font-weight: bold;
  cursor: pointer;
  position: relative;
  text-align: center;
}

.tab-item.active {
  color: var(--color-primary);
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 100%;
  height: 2px;
  background-color: var(--color-primary);
}

.modal-body {
  margin-top: 20px;
  background-color: var(--color-bg-page);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 15px;
  background-color: var(--color-bg-muted);
}

.modal-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  color: var(--color-text-white);
  cursor: pointer;
  font-weight: bold;
  min-width: 80px;
  height: 36px;
  font-size: 14px;
}

.btn-cancel {
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
}

.btn-confirm {
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
}

.btn-primary {
  background-color: var(--color-primary);
  color: var(--color-bg-container);
}

/* 动画相关样式 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.4s ease;
}

.modal-fade-enter-active .modal-container {
  animation: slideDown 0.4s ease;
}

.modal-fade-leave-active .modal-container {
  animation: slideUp 0.4s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

@keyframes slideDown {
  from {
    transform: translateY(-50px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes slideUp {
  from {
    transform: translateY(0);
    opacity: 1;
  }
  to {
    transform: translateY(-50px);
    opacity: 0;
  }
}

/* 添加通用输入框样式 */
:deep(input),
:deep(textarea),
:deep(select) {
  width: 100%;
  height: 36px;
  background-color: var(--color-bg-container);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  color: var(--color-text-primary);
  padding: 0 20px;
  box-sizing: border-box;
  outline: none;
  font-weight: normal;
  transition: border-color 0.3s;
}

:deep(input:focus),
:deep(textarea:focus),
:deep(select:focus) {
  border-color: var(--color-primary);
  box-shadow: none;
}

:deep(input::placeholder),
:deep(textarea::placeholder) {
  color: var(--color-text-placeholder);
}

:deep(textarea) {
  min-height: 100px;
  padding: 12px 20px;
  resize: vertical;
}

:deep(label) {
  display: block;
  margin-bottom: 8px;
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: normal;
}

:deep(.form-row) {
  margin-bottom: 16px;
  width: 100%;
}

:deep(.form-row-two-columns) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}
</style> 