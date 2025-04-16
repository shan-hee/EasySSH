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
  background-color: #444 !important;
  border-color: #444 !important;
  transition: background-color 0.3s ease, border-color 0.3s ease;
  font-weight: bold;
  display: flex;
  align-items: center;
}

.add-button:hover {
  background-color: #555 !important;
  border-color: #555 !important;
}

/* 确保Element Plus按钮内的文字加粗 */
:deep(span) {
  font-weight: bold;
}
</style> 