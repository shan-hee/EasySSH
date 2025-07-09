<template>
  <AppLayout>
    <RouterView />
  </AppLayout>
</template>

<script>
import { defineComponent } from 'vue'
import AppLayout from './layouts/AppLayout.vue'

export default defineComponent({
  name: 'App',
  components: {
    AppLayout
  }
})
</script>

<style>
/* 注意：基础样式现在在 base/base.css 中定义，这里只保留应用特定的样式 */

/* 应用级别特定样式 */
:root {
  /* 应用布局变量 - 保持现有布局不变 */
  --app-header-height: var(--layout-header-height);
  --app-sidebar-width: var(--layout-sidebar-width);

  /* 自定义组件样式变量 - 深色主题 */
  --switch-bg-color: var(--color-border-default);
  --switch-border-color: var(--color-border-default);
  --switch-active-bg-color: #AAAAAA;
  --switch-active-border-color: #AAAAAA;
  --switch-button-color: var(--color-bg-container);
  --switch-active-button-color: var(--color-bg-container);

  --slider-runway-color: var(--color-border-default);
  --slider-bar-color: #AAAAAA;
  --slider-button-color: var(--color-bg-container);
  --slider-button-border-color: #AAAAAA;
}

/* 浅色主题下的自定义组件样式调整 */
:root[data-theme="light"] {
  --switch-bg-color: var(--color-border-light);
  --switch-border-color: var(--color-border-light);
  --switch-active-bg-color: var(--color-primary);
  --switch-active-border-color: var(--color-primary);
  --switch-button-color: var(--color-bg-container);
  --switch-active-button-color: var(--color-bg-container);

  --slider-runway-color: var(--color-border-light);
  --slider-bar-color: var(--color-primary);
  --slider-button-color: var(--color-bg-container);
  --slider-button-border-color: var(--color-primary);
}

/* Element Plus 全局组件样式覆盖 */

/* Element Plus 下拉菜单和弹出层 - 深色主题 */
.el-select-dropdown,
.el-dropdown-menu,
.el-cascader__dropdown,
.el-date-picker,
.el-time-panel,
.el-popper.is-light {
  background-color: var(--color-bg-container) !important;
  border: 1px solid var(--color-border-default) !important;
  color: var(--color-text-primary) !important;
  box-shadow: var(--shadow-lg) !important;
}

/* 弹出层箭头 */
.el-popper.is-light .el-popper__arrow::before,
.el-select-dropdown.el-popper .el-popper__arrow::before,
.el-cascader__dropdown.el-popper .el-popper__arrow::before,
.el-dropdown-menu.el-popper .el-popper__arrow::before {
  background-color: var(--color-bg-container) !important;
  border-color: var(--color-border-default) !important;
}

/* 下拉菜单项 */
.el-select-dropdown__item,
.el-dropdown-menu__item,
.el-cascader-node {
  color: var(--color-text-primary) !important;
}

/* 下拉菜单项悬停状态 */
.el-select-dropdown__item.hover,
.el-select-dropdown__item:hover,
.el-select-dropdown__item.is-hover,
.el-dropdown-menu__item:hover,
.el-dropdown-menu__item:focus,
.el-cascader-node:hover,
.el-cascader-node:focus {
  background-color: var(--color-hover-bg) !important;
  color: var(--color-text-primary) !important;
}

/* 下拉菜单选中项 */
.el-select-dropdown__item.selected,
.el-select-dropdown__item.is-selected,
.el-dropdown-menu__item.is-selected,
.el-cascader-node.is-active,
.el-cascader-node.in-active-path {
  color: var(--color-primary) !important;
  font-weight: bold !important;
  background-color: transparent !important;
}

/* 选中项悬停状态 */
.el-select-dropdown__item.selected.hover,
.el-select-dropdown__item.selected:hover,
.el-select-dropdown__item.is-selected.is-hover,
.el-select-dropdown__item.is-selected:hover,
.el-dropdown-menu__item.is-selected:hover,
.el-cascader-node.is-active:hover {
  background-color: var(--color-hover-bg) !important;
}

/* 输入框和表单控件 */
.el-input__inner,
.el-textarea__inner {
  color: var(--color-text-primary) !important;
  caret-color: var(--color-primary) !important;
  background-color: transparent !important;
}

/* 数字输入框无边框样式 */
.el-input-number {
  border: none !important;
  background-color: var(--color-bg-muted) !important;
  border-radius: var(--radius-sm) !important;
  height: 36px !important;
  width: 100px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
}

.el-input-number__decrease,
.el-input-number__increase {
  border: none !important;
  background-color: transparent !important;
  color: var(--color-text-primary) !important;
  box-shadow: none !important;
  width: 36px !important;
  height: 36px !important;
  margin: 0 !important;
  padding: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.el-input-number__wrapper {
  box-shadow: none !important;
  border: none !important;
  background-color: transparent !important;
  border-radius: 0 !important;
  padding: 0 !important;
  flex: 1 !important;
}

.el-input-number .el-input__wrapper {
  box-shadow: none !important;
  background-color: transparent !important;
  padding: 0 !important;
}

.el-input-number .el-input {
  width: 100% !important;
  text-align: center !important;
}

.el-input-number .el-input__inner {
  text-align: center !important;
  padding: 0 !important;
  height: 36px !important;
}

/* 开关组件样式 */
.el-switch__core {
  background-color: var(--switch-bg-color) !important;
  border-color: var(--switch-border-color) !important;
}

.el-switch.is-checked .el-switch__core {
  background-color: var(--switch-active-bg-color) !important;
  border-color: var(--switch-active-border-color) !important;
}

.el-switch__core .el-switch__action {
  background-color: var(--switch-button-color) !important;
}

.el-switch.is-checked .el-switch__core .el-switch__action {
  background-color: var(--switch-active-button-color) !important;
}

/* 滑块组件样式 */
.el-slider__runway {
  background-color: var(--slider-runway-color) !important;
}

.el-slider__bar {
  background-color: var(--slider-bar-color) !important;
}

.el-slider__button {
  border-color: var(--slider-button-border-color) !important;
  background-color: var(--slider-button-color) !important;
}

/* 禁用状态 */
.el-select-dropdown__item.is-disabled,
.el-dropdown-menu__item.is-disabled,
.el-cascader-node.is-disabled {
  color: var(--color-text-disabled) !important;
}

/* 特定项目修复 */
.el-select-dropdown__item:nth-child(1):hover,
.el-select-dropdown__item:nth-child(2):hover {
  background-color: var(--color-hover-bg) !important;
  color: var(--color-text-primary) !important;
}

/* Tooltip 样式覆盖 */
.el-tooltip__popper,
.el-popper.is-dark {
  background-color: var(--color-text-primary) !important;
  color: var(--color-bg-container) !important;
  border: none !important;
  box-shadow: var(--shadow-lg) !important;
}

.el-tooltip__popper .el-popper__arrow::before,
.el-popper.is-dark .el-popper__arrow::before {
  background-color: var(--color-text-primary) !important;
  border-color: var(--color-text-primary) !important;
}

/* 浅色主题特定组件样式适配 */
:root[data-theme="light"] .el-message {
  background-color: var(--color-bg-container) !important;
  border-color: var(--color-border-light) !important;
  color: var(--color-text-regular) !important;
  box-shadow: var(--shadow-base) !important;
}

:root[data-theme="light"] .el-message .el-message__icon,
:root[data-theme="light"] .el-message--success .el-message__icon,
:root[data-theme="light"] .el-message__content {
  color: #606266 !important;
}

:root[data-theme="light"] .el-select-dropdown__item.hover,
:root[data-theme="light"] .el-select-dropdown__item:hover,
:root[data-theme="light"] .el-select-dropdown__item.is-hover {
  background-color: #f5f7fa !important;
}

:root[data-theme="light"] .el-select-dropdown__item.selected,
:root[data-theme="light"] .el-select-dropdown__item.is-selected {
  color: #aaaaaa !important;
  font-weight: bold !important;
  background-color: transparent !important;
}

:root[data-theme="light"] .el-input__inner,
:root[data-theme="light"] .el-textarea__inner {
  color: #606266 !important;
  caret-color: #aaaaaa !important;
  background-color: #fff !important;
}

:root[data-theme="light"] .el-input-number {
  background-color: #f5f7fa !important;
}

:root[data-theme="light"] .el-input-number__decrease,
:root[data-theme="light"] .el-input-number__increase {
  color: #606266 !important;
}

:root[data-theme="light"] .el-input-number .el-input__inner {
  background-color: transparent !important;
}
</style> 