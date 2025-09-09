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
</style>
