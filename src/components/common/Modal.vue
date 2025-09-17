<template>
  <transition name="modal-fade">
    <div v-if="visible" class="modal-overlay" @click="handleOverlayClick">
      <div class="modal-container" :class="customClass" :style="modalStyle" @click.stop>
        <div class="modal-header">
          <span class="modal-title">{{ title }}</span>
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
          <slot />
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
import { ref, defineComponent } from 'vue';

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
    },
    // 可选：通过内联样式精确控制尺寸，避免被外部样式覆盖
    width: {
      type: [Number, String],
      default: null
    },
    maxWidth: {
      type: [Number, String],
      default: null
    },
    height: {
      type: [Number, String],
      default: null
    },
    maxHeight: {
      type: [Number, String],
      default: null
    }
  },
  emits: ['update:visible', 'close', 'confirm'],
  setup(props, { emit }) {
    const activeTab = ref(0);

    const toSize = v => {
      if (v === null || v === undefined || v === '') return undefined;
      return typeof v === 'number' ? `${v}px` : String(v);
    };

    const modalStyle = {
      get width() {
        return toSize(props.width);
      },
      get maxWidth() {
        return toSize(props.maxWidth);
      },
      get height() {
        return toSize(props.height);
      },
      get maxHeight() {
        return toSize(props.maxHeight);
      }
    };

    const handleClose = () => {
      emit('update:visible', false);
      emit('close');
    };

    const handleConfirm = () => {
      emit('confirm');
      handleClose();
    };

    const handleOverlayClick = () => {
      // Implementation of handleOverlayClick
    };

    return {
      activeTab,
      handleClose,
      handleConfirm,
      handleOverlayClick,
      modalStyle
    };
  }
});
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
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  /* 使内容区域可在内部滚动 */
  display: flex;
  flex-direction: column;
  /* 默认限制高度，防止超出可视区 */
  max-height: 90vh;
}

.modal-header {
  padding: 12px 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header span {
  color: var(--color-text-primary);
  font-weight: bold;
}

/* 标题在移动端过长时单行省略 */
.modal-header .modal-title {
  flex: 1 1 auto;
  min-width: 0; /* 允许收缩以触发省略号 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close-btn {
  cursor: pointer;
  font-size: 20px;
  color: var(--color-text-regular);
}

.modal-tab {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}

.tab-item {
  padding: 10px 15px;
  color: var(--color-text-primary);
  font-weight: bold;
  cursor: pointer;
  position: relative;
  text-align: center;
  flex: 0 0 auto;
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
  margin-top: 10px;
  background-color: var(--color-bg-page);
  /* 关键：内容区域滚动 */
  overflow: auto;
  flex: 1 1 auto;
  min-height: 0; /* 防止子元素撑破容器，允许滚动 */
  -webkit-overflow-scrolling: touch; /* iOS 平滑滚动 */
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 15px;
  flex: 0 0 auto;
}

.modal-btn {
  display: flex;
  align-items: center;
  justify-content: center;
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
  background-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.btn-primary:hover {
  background-color: var(--btn-primary-hover-bg);
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
  /* margin-bottom: 8px; */
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

/* 移动端优化 */
@media (max-width: 768px) {
  .modal-overlay {
    padding: 12px; /* 给容器留出边距，避免贴边 */
  }

  .modal-container {
    width: 95vw;
    max-height: 92vh; /* 多留一点高度以适配设备栏 */
  }

  .modal-header {
    padding: 12px 12px;
  }

  .modal-body {
    /* 防止滚动时穿透页面 */
    overscroll-behavior: contain;
  }
}

/* 组件内通用覆盖（通过自定义类名精确作用） */
/* 用户设置弹窗：统一容器内边距与局部覆盖，避免在子组件中重复注入样式 */
.user-settings-modal.modal-container {
  --settings-panel-padding: 20px;
  padding: var(--settings-panel-padding);
}

.user-settings-modal .modal-header {
  padding: 0 !important;
}

.user-settings-modal .modal-body {
  overflow: hidden;
}
</style>
