<template>
  <el-button type="primary" class="add-button" @click="$emit('click')">
    <el-icon><Plus /></el-icon>
    <span><slot>添加</slot></span>
  </el-button>
</template>

<script>
import { defineComponent } from 'vue'
import { Plus } from '@element-plus/icons-vue'

export default defineComponent({
  name: 'AddButton',
  components: {
    Plus
  },
  emits: ['click']
})
</script>

<style scoped>
/* 使用统一的主要按钮样式 */
.add-button {
  background-color: var(--btn-primary-bg) !important;
  border-color: var(--btn-primary-bg) !important;
}

.add-button:hover {
  background-color: var(--btn-primary-hover-bg) !important;
  border-color: var(--btn-primary-hover-bg) !important;
}

/* 确保Element Plus按钮内的文字加粗且颜色正确 */
:deep(span) {
  font-weight: bold;
  color: var(--btn-primary-text) !important;
}

/* 确保图标颜色也正确 */
:deep(.el-icon) {
  color: var(--btn-primary-text) !important;
}
</style>