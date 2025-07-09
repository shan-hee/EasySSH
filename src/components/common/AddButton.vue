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
.add-button {
  background-color: var(--color-primary) !important;
  border: 1px solid var(--color-primary) !important;
  color: var(--color-bg-container) !important;
  transition: background-color 0.2s ease;
  font-weight: bold;
  display: flex;
  align-items: center;
  border-radius: 4px !important;
  box-shadow: none !important;
}

.add-button:hover {
  background-color: var(--color-primary-hover) !important;
  border-color: var(--color-primary-hover) !important;
  color: var(--color-bg-container) !important;
  transform: none !important;
  box-shadow: none !important;
}

/* 确保Element Plus按钮内的文字加粗且颜色正确 */
:deep(span) {
  font-weight: bold;
  color: var(--color-bg-container) !important;
}

/* 确保图标颜色也正确 */
:deep(.el-icon) {
  color: var(--color-bg-container) !important;
}
</style>