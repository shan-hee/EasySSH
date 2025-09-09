<template>
  <div class="form-container">
    <div
      v-for="(row, rowIndex) in rows"
      :key="rowIndex"
      class="form-row"
      :class="{ 'form-row-two-columns': row.type === 'two-columns' }"
    >
      <slot :name="`row-${rowIndex}`" />
    </div>
  </div>
</template>

<script>
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'FormLayout',
  props: {
    rows: {
      type: Array,
      default: () => []
      // 格式：[{ type: 'single' }, { type: 'two-columns' }]
    }
  }
});
</script>

<style scoped>
.form-container {
  width: 100%;
}

.form-row {
  margin-bottom: 16px;
  width: 100%;
}

.form-row-two-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}
</style>
