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
/* 注意：Element Plus 组件样式变量已迁移到主题文件中 */

/* Element Plus 全局组件样式已迁移到主题文件 */

/* Tooltip 样式覆盖 - 使用统一的主题变量 */
.el-tooltip__popper,
.el-popper.is-dark {
  background-color: var(--tooltip-bg) !important;
  color: var(--tooltip-color) !important;
  border: none !important;
  box-shadow: var(--tooltip-shadow) !important;
  font-family: var(--tooltip-font-family) !important;
  font-size: var(--tooltip-font-size) !important;
  font-weight: var(--tooltip-font-weight) !important;
  line-height: var(--tooltip-line-height) !important;
  border-radius: var(--tooltip-border-radius) !important;
  padding: var(--tooltip-padding-vertical) var(--tooltip-padding-horizontal) !important;
  max-width: var(--tooltip-max-width) !important;
}

.el-tooltip__popper .el-popper__arrow::before,
.el-popper.is-dark .el-popper__arrow::before {
  background-color: var(--tooltip-arrow-color) !important;
  border-color: var(--tooltip-arrow-color) !important;
}


</style> 