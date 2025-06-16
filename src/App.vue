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
/* 只保留全局基础样式，组件特定样式将移至各组件中 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: "Microsoft YaHei", sans-serif;
  background-color: #121212;
  color: #f0f0f0;
  line-height: 1.6;
}

a {
  color: #1976d2;
  text-decoration: none;
}

button {
  cursor: pointer;
}

/* 全局CSS变量 */
:root {
  /* 基础变量 */
  --primary-color: #1976d2;
  --header-height: 50px;
  --sidebar-width: 60px;
  
  /* Element Plus 主题变量覆盖 */
  --el-color-primary: #0083d3 !important;
  --el-color-primary-light-3: #3399dd !important;
  --el-color-primary-light-5: #66b1e8 !important;
  --el-color-primary-light-7: #99ccf2 !important;
  --el-color-primary-light-9: #2c2c2c !important;
  
  /* 背景色 */
  --el-bg-color: #1e1e1e !important;
  --el-bg-color-overlay: #1e1e1e !important;
  --el-fill-color-blank: #1e1e1e !important;
  --el-fill-color-light: #2c2c2c !important;
  
  /* 文字颜色 */
  --el-text-color-primary: #ffffff !important;
  --el-text-color-regular: #ffffff !important;
  --el-text-color-secondary: #a0a0a0 !important;
  --el-text-color-placeholder: #6c6c6c !important;
  --el-color-white: #ffffff !important;
  
  /* 边框颜色 */
  --el-border-color: #333 !important;
  --el-border-color-light: #444 !important;
  
  /* 下拉菜单特定变量 */
  --el-dropdown-menuItem-hover-fill: #2c2c2c !important;
  --el-dropdown-menuItem-hover-color: #fff !important;
  --el-select-dropdown-bg-color: #1e1e1e !important;
  --el-select-option-hover-background: #2c2c2c !important;

  /* 开关组件样式 - 全局默认样式 */
  --switch-bg-color: #333;
  --switch-border-color: #444;
  --switch-active-bg-color: #aaaaaa;
  --switch-active-border-color: #aaaaaa;
  --switch-button-color: #cccccc;
  --switch-active-button-color: #121212;

  /* 滑块组件样式 - 全局默认样式 */
  --slider-runway-color: #333;
  --slider-bar-color: #aaaaaa;
  --slider-button-color: #cccccc;
  --slider-button-border-color: #cccccc;
}

/* 浅色主题Element Plus变量覆盖 */
:root[data-theme="light"] {
  /* Element Plus 主题变量覆盖 */
  --el-color-primary: #0083d3 !important;
  --el-color-primary-light-3: #3399dd !important;
  --el-color-primary-light-5: #66b1e8 !important;
  --el-color-primary-light-7: #99ccf2 !important;
  --el-color-primary-light-9: #f0f7ff !important;
  
  /* 背景色 */
  --el-bg-color: #ffffff !important;
  --el-bg-color-overlay: #ffffff !important;
  --el-fill-color-blank: #ffffff !important;
  --el-fill-color-light: #f5f7fa !important;
  
  /* 文字颜色 */
  --el-text-color-primary: #303133 !important;
  --el-text-color-regular: #606266 !important;
  --el-text-color-secondary: #909399 !important;
  --el-text-color-placeholder: #c0c4cc !important;
  --el-color-white: #ffffff !important;
  
  /* 边框颜色 */
  --el-border-color: #dcdfe6 !important;
  --el-border-color-light: #e4e7ed !important;
  
  /* 下拉菜单特定变量 */
  --el-dropdown-menuItem-hover-fill: #f5f7fa !important;
  --el-dropdown-menuItem-hover-color: #0083d3 !important;
  --el-select-dropdown-bg-color: #ffffff !important;
  --el-select-option-hover-background: #f5f7fa !important;

  /* 开关组件样式 - 浅色主题 */
  --switch-bg-color: #dcdfe6;
  --switch-border-color: #dcdfe6;
  --switch-active-bg-color: #0083d3;
  --switch-active-border-color: #0083d3;
  --switch-button-color: #ffffff;
  --switch-active-button-color: #ffffff;

  /* 滑块组件样式 - 浅色主题 */
  --slider-runway-color: #e4e7ed;
  --slider-bar-color: #0083d3;
  --slider-button-color: #ffffff;
  --slider-button-border-color: #0083d3;
}

/* Element Plus 全局组件样式覆盖 */

/* 下拉菜单和弹出层 */
.el-select-dropdown,
.el-dropdown-menu,
.el-cascader__dropdown,
.el-date-picker,
.el-time-panel,
.el-popper.is-light {
  background-color: #1e1e1e !important;
  border: 1px solid #333 !important;
  color: #fff !important;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4) !important;
}

/* 弹出层箭头 */
.el-popper.is-light .el-popper__arrow::before,
.el-select-dropdown.el-popper .el-popper__arrow::before,
.el-cascader__dropdown.el-popper .el-popper__arrow::before,
.el-dropdown-menu.el-popper .el-popper__arrow::before {
  background-color: #1e1e1e !important;
  border-color: #333 !important;
}

/* 下拉菜单项 */
.el-select-dropdown__item,
.el-dropdown-menu__item,
.el-cascader-node {
  color: #fff !important;
}

/* 下拉菜单项悬停状态 */
.el-select-dropdown__item.hover,
.el-select-dropdown__item:hover,
.el-select-dropdown__item.is-hover,
.el-dropdown-menu__item:hover,
.el-dropdown-menu__item:focus,
.el-cascader-node:hover,
.el-cascader-node:focus {
  background-color: #2c2c2c !important;
  color: #fff !important;
}

/* 下拉菜单选中项 */
.el-select-dropdown__item.selected,
.el-select-dropdown__item.is-selected,
.el-dropdown-menu__item.is-selected,
.el-cascader-node.is-active,
.el-cascader-node.in-active-path {
  color: #0083d3 !important;
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
  background-color: #2c2c2c !important;
}

/* 输入框和表单控件 */
.el-input__inner,
.el-textarea__inner {
  color: #fff !important;
  caret-color: #fff !important;
  background-color: transparent !important;
}

/* 数字输入框无边框样式 */
.el-input-number {
  border: none !important;
  background-color: #1a1a1a !important;
  border-radius: 6px !important;
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
  color: #fff !important;
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
  color: #666 !important;
}

/* 特定项目修复 */
.el-select-dropdown__item:nth-child(1):hover,
.el-select-dropdown__item:nth-child(2):hover {
  background-color: #2c2c2c !important;
  color: #fff !important;
}

/* Tooltip 样式覆盖 */
.el-tooltip__popper,
.el-popper.is-dark {
  background-color: #333 !important;
  color: #e0e0e0 !important;
  border: none !important;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4) !important;
}

.el-tooltip__popper .el-popper__arrow::before,
.el-popper.is-dark .el-popper__arrow::before {
  background-color: #333 !important;
  border-color: #333 !important;
}

/* 浅色主题特定组件样式适配 */
:root[data-theme="light"] .el-message {
  background-color: #fff !important;
  border-color: #e4e7ed !important;
  color: #606266 !important;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1) !important;
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
  color: #0083d3 !important;
  font-weight: bold !important;
  background-color: transparent !important;
}

:root[data-theme="light"] .el-input__inner,
:root[data-theme="light"] .el-textarea__inner {
  color: #606266 !important;
  caret-color: #0083d3 !important;
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