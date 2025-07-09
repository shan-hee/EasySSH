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
  background-color: #2c2c2c !important;
  border: 1px solid #333 !important;
  color: var(--color-text-primary) !important;
  transition: background-color 0.2s ease;
  font-weight: bold;
  display: flex;
  align-items: center;
  border-radius: 4px !important;
  box-shadow: none !important;
}

.add-button:hover {
  background-color: #3a3a3a !important;
  border-color: #333 !important;
  color: var(--color-text-primary) !important;
  transform: none !important;
  box-shadow: none !important;
}

/* 确保Element Plus按钮内的文字加粗且颜色正确 */
:deep(span) {
  font-weight: bold;
  color: var(--color-text-primary) !important;
}

/* 确保图标颜色也正确 */
:deep(.el-icon) {
  color: var(--color-text-primary) !important;
}
</style>