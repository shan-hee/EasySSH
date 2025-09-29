<template>
  <teleport to="body">
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
              :class="['btn', 'modal-btn', `btn-${button.type}`]"
              @click="button.onClick"
            >
              {{ button.text }}
            </button>
          </template>
          <template v-else>
            <button class="btn modal-btn btn-cancel" @click="handleClose">取消</button>
            <button class="btn modal-btn btn-confirm" @click="handleConfirm">确定</button>
          </template>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
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
/*
  Modal 样式变量参考（就地说明）

  容器（.modal-container）
  - --modal-width               默认 550px
  - --modal-bg                  默认 var(--color-bg-page)
  - --modal-radius              默认 8px
  - --modal-shadow              默认 0 4px 12px rgba(0,0,0,.5)
  - --modal-max-height          默认 90vh

  遮罩层（.modal-overlay）
  - --dialog-overlay-bg         默认 rgba(0,0,0,.5)
  - --z-overlay                 默认 9990

  标题（.modal-header / .modal-title / .close-btn）
  - --modal-header-padding      默认 var(--spacing-sm) var(--spacing-md)
  - --modal-title-size          默认 var(--font-size-lg)
  - --modal-title-weight        默认 600
  - --modal-title-color         默认 var(--color-text-primary)
  - --modal-close-size          默认 20px
  - --modal-close-color         默认 var(--color-text-regular)
  - --modal-close-hover-color   默认 var(--color-text-primary)

  内容（.modal-body）
  - --modal-body-gap            默认 var(--spacing-sm)
  - --modal-body-bg             默认 var(--color-bg-page)

  页脚（.modal-footer）
  - --modal-footer-gap          默认 var(--spacing-sm)
  - --modal-footer-padding      默认 var(--spacing-sm) var(--spacing-md)

  标签栏（.modal-tab / .tab-item）
  - --modal-tab-gap             默认 var(--spacing-sm)
  - --modal-tab-padding-x       默认 var(--spacing-md)
  - --modal-tab-item-padding-y  默认 10px
  - --modal-tab-item-padding-x  默认 15px
  - --modal-tab-font-size       默认 var(--font-size-sm)
  - --modal-tab-font-weight     默认 600
  - --modal-tab-color           默认 var(--color-text-primary)
  - --modal-tab-indicator-height 默认 2px
  - --modal-tab-indicator-color  默认 var(--color-primary)

  20px 包围弹窗（.user-settings-modal / .connection-modal / .mfa-* /.logout-devices-modal）
  - 上述类在 .modal-container 上有 padding: 20px；为避免与容器叠加：
    .modal-header/.modal-footer 已在此文件归零 padding；.modal-body 的 margin-top 也归零。
  - 如需恢复单独留白，可在具体弹窗覆盖对应 padding/margin 或变量。

  常用覆盖示例（写在具体弹窗容器类上，如 .user-settings-modal.modal-container）
  - 小标题 + 透明内容 + 紧凑页脚：
      --modal-title-size: 14px;
      --modal-title-weight: 500;
      --modal-title-color: var(--color-text-secondary);
      --modal-body-bg: transparent;
      --modal-footer-gap: var(--spacing-xs);
  - 连接弹窗更宽更高 + 紧凑标签：
      --modal-width: 640px; --modal-max-height: 92vh;
      --modal-tab-gap: var(--spacing-xs);
      --modal-tab-item-padding-y: 8px; --modal-tab-item-padding-x: 12px;
      --modal-tab-font-size: 13px; --modal-tab-indicator-height: 2px;
*/
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--dialog-overlay-bg, rgba(0, 0, 0, 0.5));
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10050; /* 高于全局消息，避免被遮挡 */
}

.modal-container {
  width: var(--modal-width, 550px);
  background-color: var(--modal-bg, var(--color-bg-page));
  border-radius: var(--modal-radius, 8px);
  overflow: hidden;
  box-shadow: var(--modal-shadow, 0 4px 12px rgba(0, 0, 0, 0.5));
  /* 使内容区域可在内部滚动 */
  display: flex;
  flex-direction: column;
  /* 默认限制高度，防止超出可视区 */
  max-height: var(--modal-max-height, 90vh);
}

/* 统一系统风格：20px 包围弹窗（与连接/脚本等保持一致） */
.modal-container.ai-modal {
  padding: 20px;
}
.modal-container.ai-modal .modal-header,
.modal-container.ai-modal .modal-footer {
  padding: 0;
}
.modal-container.ai-modal .modal-body {
  margin-top: 0;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--modal-header-padding, var(--spacing-sm) var(--spacing-md));
}

.modal-header span {
  color: var(--color-text-primary);
}

/* 标题在移动端过长时单行省略 */
.modal-header .modal-title {
  flex: 1 1 auto;
  min-width: 0; /* 允许收缩以触发省略号 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 统一标题视觉：可通过变量覆盖 */
  font-size: var(--modal-title-size, var(--font-size-lg));
  font-weight: var(--modal-title-weight, 600);
  color: var(--modal-title-color, var(--color-text-primary));
}

.close-btn {
  cursor: pointer;
  font-size: var(--modal-close-size, 20px);
  color: var(--modal-close-color, var(--color-text-regular));
}
.close-btn:hover {
  color: var(--modal-close-hover-color, var(--color-text-primary));
}

.modal-tab {
  display: flex;
  gap: var(--modal-tab-gap, var(--spacing-sm));
  padding: 0 ;
  overflow-x: auto;
}

.tab-item {
  padding: var(--modal-tab-item-padding-y, 10px) var(--modal-tab-item-padding-x, 15px);
  color: var(--modal-tab-color, var(--color-text-primary));
  font-weight: var(--modal-tab-font-weight, 600);
  font-size: var(--modal-tab-font-size, var(--font-size-sm));
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
  height: var(--modal-tab-indicator-height, 2px);
  background-color: var(--modal-tab-indicator-color, var(--color-primary));
}

.modal-body {
  margin-top: var(--modal-body-gap, var(--spacing-sm));
  background-color: var(--modal-body-bg, var(--color-bg-page));
  /* 关键：内容区域滚动 */
  overflow: auto;
  flex: 1 1 auto;
  min-height: 0; /* 防止子元素撑破容器，允许滚动 */
  -webkit-overflow-scrolling: touch; /* iOS 平滑滚动 */
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--modal-footer-gap, var(--spacing-sm));
  padding: var(--modal-footer-padding, var(--spacing-sm) var(--spacing-md));
  flex: 0 0 auto;
}

.modal-btn {
  min-width: 80px; /* 保留最小宽度，其余视觉由全局 .btn 控制 */
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

/* 添加通用输入框样式（精确匹配文本类输入，避免影响复选、单选、滑块等） */
:deep(input[type='text']:not(.code-input):not(.form-input)),
:deep(input[type='password']:not(.code-input):not(.form-input)),
:deep(input[type='email']:not(.code-input):not(.form-input)),
:deep(input[type='number']:not(.code-input):not(.form-input)),
:deep(input[type='search']:not(.code-input):not(.form-input)),
:deep(input[type='tel']:not(.code-input):not(.form-input)),
:deep(input[type='url']:not(.code-input):not(.form-input)) {
  width: 100%;
  height: var(--form-control-height, 36px);
  line-height: var(--form-control-height, 36px);
  background-color: transparent;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  color: var(--color-text-primary);
  padding: 0 var(--form-control-padding-x, 20px);
  box-sizing: border-box;
  outline: none;
  font-weight: normal;
  transition: border-color 0.3s;
}

/* 下拉选择框与文本类输入保持一致高度与内边距 */
:deep(select:not(.form-select)) {
  width: 100%;
  height: var(--form-control-height, 36px);
  line-height: var(--form-control-height, 36px);
  background-color: var(--color-bg-container);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  color: var(--color-text-primary);
  padding: 0 var(--form-control-padding-x, 20px);
  box-sizing: border-box;
  outline: none;
  font-weight: normal;
  transition: border-color 0.3s;
  -webkit-appearance: none;
  -moz-appearance: none;
}

/* number 类型输入：隐藏浏览器默认微调箭头，保证高度与布局一致 */
:deep(input[type='number']) {
  -moz-appearance: textfield;
}
:deep(input[type='number']::-webkit-outer-spin-button),
:deep(input[type='number']::-webkit-inner-spin-button) {
  -webkit-appearance: none;
  margin: 0;
}

/* 文本域不强制固定高度，使用最小高度并单独的内边距 */
:deep(textarea) {
  width: 100%;
  min-height: var(--textarea-min-height, 100px);
  background-color: var(--color-bg-container);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  color: var(--color-text-primary);
  padding: 12px var(--form-control-padding-x, 20px);
  box-sizing: border-box;
  outline: none;
  font-weight: normal;
  transition: border-color 0.3s;
}

:deep(input:not(.form-input):not(.code-input):focus),
:deep(textarea:not(.form-input):focus),
:deep(select:not(.form-select):focus) {
  border-color: var(--color-primary);
  box-shadow: none;
}

/* 禁用态统一样式 */
:deep(input:disabled),
:deep(textarea:disabled),
:deep(select:disabled) {
  opacity: 0.6;
  cursor: not-allowed;
  background-color: var(--color-disabled-bg, var(--color-bg-muted));
}

:deep(input::placeholder),
:deep(textarea::placeholder) {
  color: var(--color-text-placeholder);
}

:deep(textarea) {
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

/* MFA 系列弹窗：统一圆角与标题分隔线 */
.mfa-modal.modal-container,
.mfa-verify-modal.modal-container,
.mfa-disable-modal.modal-container {
  --settings-panel-padding: 20px;
  padding: var(--settings-panel-padding);
}

/* 连接弹窗：统一容器包围内边距 */
.connection-modal.modal-container {
  --settings-panel-padding: 20px;
  padding: var(--settings-panel-padding);
}

/* 注销所有设备弹窗：统一容器包围内边距 */
.logout-devices-modal.modal-container {
  --settings-panel-padding: 20px;
  padding: var(--settings-panel-padding);
}

.mfa-modal,
.mfa-verify-modal,
.mfa-disable-modal {
  border-radius: 12px !important;
  overflow: hidden !important;
}

.mfa-modal .modal-header,
.mfa-verify-modal .modal-header,
.mfa-disable-modal .modal-header {
  padding: 0 !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
}

/* 这类统一包围的弹窗，页脚不再额外内边距，避免双重留白 */
.user-settings-modal .modal-footer,
.connection-modal .modal-footer,
.mfa-modal .modal-footer,
.mfa-verify-modal .modal-footer,
.mfa-disable-modal .modal-footer,
.logout-devices-modal .modal-footer {
  padding: 0;
}

/* 统一包围的弹窗：内容区域与标题直接衔接，不额外间距 */
.user-settings-modal .modal-body,
.connection-modal .modal-body,
.mfa-modal .modal-body,
.mfa-verify-modal .modal-body,
.mfa-disable-modal .modal-body,
.logout-devices-modal .modal-body {
  margin-top: 0;
}

/* 统一包围弹窗的标题内边距归零，避免与容器 20px 叠加 */
.logout-devices-modal .modal-header {
  padding: 0 !important;
}

/* 连接弹窗：标题与设置弹窗一致，去掉额外内边距 */
.connection-modal .modal-header {
  padding: 0 !important;
}
</style>
