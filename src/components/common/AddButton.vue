<template>
  <el-button type="primary" class="add-button" @click="$emit('click')">
    <el-icon><plus /></el-icon>
    <span><slot>添加</slot></span>
  </el-button>
</template>

<script>
import { defineComponent } from 'vue';
import { Plus } from '@element-plus/icons-vue';

export default defineComponent({
  name: 'AddButton',
  components: {
    Plus
  },
  emits: ['click']
});
</script>

<style scoped>
/* 统一通过 Element Plus 按钮 CSS 变量与主题令牌对齐，避免与库样式竞争 */
.add-button {
  /* 基础与边框 */
  --el-button-bg-color: var(--btn-primary-bg);
  --el-button-border-color: var(--btn-primary-bg);
  --el-button-text-color: var(--btn-primary-text);

  /* 悬停与激活态 */
  --el-button-hover-bg-color: var(--btn-primary-hover-bg);
  --el-button-hover-border-color: var(--btn-primary-hover-bg);
  --el-button-hover-text-color: var(--btn-primary-text);
  --el-button-active-bg-color: var(--color-primary-active);
  --el-button-active-border-color: var(--color-primary-active);
  --el-button-active-text-color: var(--btn-primary-text);
}

/* 仅增强文案的视觉权重，颜色由变量控制 */
:deep(.el-button__text),
:deep(span) {
  font-weight: 600;
}
</style>
