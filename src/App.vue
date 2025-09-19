<template>
  <app-layout>
    <RouterView />
  </app-layout>
</template>

<script>
import { defineComponent } from 'vue';
import AppLayout from './layouts/AppLayout.vue';

export default defineComponent({
  name: 'App',
  components: {
    AppLayout
  }
});
</script>

<style>
/* 注意：基础样式现在在 base/base.css 中定义，这里只保留应用特定的样式 */

/* 应用级别特定样式 */
/* 注意：Element Plus 组件样式变量已迁移到主题文件中 */

/* Element Plus 全局组件样式已迁移到主题文件 */

/* Tooltip 样式覆盖 - 使用统一的主题变量 */
/* 使用更高特异性的选择器替代!important */
.el-tooltip__popper.el-popper,
.el-popper.is-dark.el-tooltip__popper,
.el-tooltip__popper[data-popper-placement],
.el-popper.is-dark[data-popper-placement] {
  background-color: var(--tooltip-bg);
  color: var(--tooltip-color);
  border: var(--tooltip-border, none);
  box-shadow: var(--tooltip-shadow);
  font-family: var(--tooltip-font-family);
  font-size: var(--tooltip-font-size);
  font-weight: var(--tooltip-font-weight);
  line-height: var(--tooltip-line-height);
  border-radius: var(--tooltip-border-radius);
  padding: var(--tooltip-padding-vertical) var(--tooltip-padding-horizontal);
  max-width: var(--tooltip-max-width);
  z-index: var(--z-tooltip);
}

/* Tooltip箭头样式 */
.el-tooltip__popper.el-popper .el-popper__arrow::before,
.el-popper.is-dark.el-tooltip__popper .el-popper__arrow::before,
.el-tooltip__popper[data-popper-placement] .el-popper__arrow::before,
.el-popper.is-dark[data-popper-placement] .el-popper__arrow::before {
  background-color: var(--tooltip-arrow-color);
  border-color: var(--tooltip-arrow-color);
}

/* SFTP 下载/删除等确认弹窗样式覆盖（优先于库样式） */
/* 不使用 @layer，确保优先级高于 Element Plus 默认样式 */
.sftp-popconfirm.el-popper,
.el-popper.sftp-popconfirm,
.el-popconfirm.sftp-popconfirm.el-popper,
.el-popconfirm.el-popper.sftp-popconfirm {
  background-color: var(--color-bg-container);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  white-space: nowrap;
  max-width: 360px;
}

.sftp-popconfirm .el-popconfirm__main,
.sftp-popconfirm .el-popconfirm__main * {
  white-space: nowrap;
}
.sftp-popconfirm .el-popconfirm__main {
  color: var(--color-text-primary);
}
.sftp-popconfirm .el-popconfirm__icon {
  color: var(--color-warning);
}
.sftp-popconfirm .el-popconfirm__action {
  margin-top: 6px;
}
.sftp-popconfirm .el-button + .el-button {
  margin-left: 8px;
}
.sftp-popconfirm .el-button {
  --el-button-bg-color: var(--color-bg-muted);
  --el-button-border-color: var(--color-border-default);
  --el-button-text-color: var(--color-text-primary);
  --el-button-hover-bg-color: var(--color-hover-bg);
  --el-button-hover-border-color: var(--color-border-dark);
  --el-button-hover-text-color: var(--color-text-primary);
  /* 保持原尺寸，避免覆盖 Element Plus 的默认按钮大小 */
}
.sftp-popconfirm .el-button--primary {
  --el-button-bg-color: var(--btn-primary-bg);
  --el-button-border-color: var(--btn-primary-bg);
  --el-button-text-color: var(--btn-primary-text);
  --el-button-hover-bg-color: var(--btn-primary-hover-bg);
  --el-button-hover-border-color: var(--btn-primary-hover-bg);
  --el-button-hover-text-color: var(--btn-primary-text);
}
.sftp-popconfirm .el-button--danger {
  --el-button-bg-color: var(--color-error);
  --el-button-border-color: var(--color-error);
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: var(--color-error-light);
  --el-button-hover-border-color: var(--color-error);
  --el-button-hover-text-color: #fff;
}

/* 取消按钮使用通用 outline 风格 */
.sftp-popconfirm .el-button:not(.el-button--primary):not(.el-button--danger) {
  background-color: transparent !important;
  color: var(--btn-outline-color, var(--color-text-primary)) !important;
  /* 去掉默认边框，同时保留占位避免尺寸抖动 */
  border: 1px solid transparent !important;
  box-shadow: none !important;
}
.sftp-popconfirm .el-button:not(.el-button--primary):not(.el-button--danger):hover,
.sftp-popconfirm .el-button:not(.el-button--primary):not(.el-button--danger):focus,
.sftp-popconfirm .el-button:not(.el-button--primary):not(.el-button--danger):active {
  background-color: var(
    --btn-outline-hover-bg,
    var(--color-hover-bg)
  ) !important;
  border-color: transparent !important; /* 悬浮时保持无边框 */
  box-shadow: none !important;
  color: var(--btn-outline-hover-color, var(--color-primary)) !important;
}
.sftp-popconfirm {
  /* 强制覆盖 Popper 内置变量，保证箭头与面板一致 */
  --el-bg-color-overlay: var(--color-bg-container) !important;
}

/* 强化选择器并使用 !important，避免被库样式覆盖 */
.sftp-popconfirm .el-popper__arrow::before,
.el-popconfirm.sftp-popconfirm .el-popper__arrow::before,
.sftp-popconfirm[data-popper-placement^='right'] .el-popper__arrow::before,
.el-popconfirm.sftp-popconfirm[data-popper-placement^='right'] .el-popper__arrow::before,
.sftp-popconfirm[data-popper-placement^='left'] .el-popper__arrow::before,
.el-popconfirm.sftp-popconfirm[data-popper-placement^='left'] .el-popper__arrow::before,
.sftp-popconfirm[data-popper-placement^='top'] .el-popper__arrow::before,
.el-popconfirm.sftp-popconfirm[data-popper-placement^='top'] .el-popper__arrow::before,
.sftp-popconfirm[data-popper-placement^='bottom'] .el-popper__arrow::before {
  background-color: var(--color-bg-container) !important;
  border: 1px solid var(--color-border-default) !important;
}

/* 兜底：某些版本将颜色应用在箭头容器上 */
.sftp-popconfirm .el-popper__arrow,
.el-popconfirm.sftp-popconfirm .el-popper__arrow,
.sftp-popconfirm[data-popper-placement^='right'] .el-popper__arrow,
.el-popconfirm.sftp-popconfirm[data-popper-placement^='right'] .el-popper__arrow,
.sftp-popconfirm[data-popper-placement^='left'] .el-popper__arrow,
.el-popconfirm.sftp-popconfirm[data-popper-placement^='left'] .el-popper__arrow,
.sftp-popconfirm[data-popper-placement^='top'] .el-popper__arrow,
.el-popconfirm.sftp-popconfirm[data-popper-placement^='top'] .el-popper__arrow,
.sftp-popconfirm[data-popper-placement^='bottom'] .el-popper__arrow {
  background-color: var(--color-bg-container) !important;
  border-color: var(--color-border-default) !important;
}

/* 仅显示右侧描边（用于 placement='left' 时箭头在右侧） */
.sftp-popconfirm[data-popper-placement^='left'] .el-popper__arrow::before {
  /* 去掉四边边框，改用右侧投影模拟1px描边 */
  border: 0 !important;
  background-color: var(--color-bg-container) !important;
  /* 右侧1px描边（不影响其它三边） */
  filter: drop-shadow(1px 0 0 var(--color-border-default));
}

/* 移除左右方向下箭头容器自身的边框，避免对角线/角点残留线条 */
.sftp-popconfirm[data-popper-placement^='left'] .el-popper__arrow,
.sftp-popconfirm[data-popper-placement^='right'] .el-popper__arrow {
  border: 0 !important;
  box-shadow: none !important;
}

/* 仅显示左侧描边（用于 placement='right' 时箭头在左侧） */
.sftp-popconfirm[data-popper-placement^='right'] .el-popper__arrow::before {
  border: 0 !important;
  background-color: var(--color-bg-container) !important;
  /* 左侧1px描边 */
  filter: drop-shadow(-1px 0 0 var(--color-border-default));
}
</style>
