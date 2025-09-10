<template>
  <div class="form-item" :style="{ padding: padding }">
    <slot />
  </div>
</template>

<script>
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'FormItem',
  props: {
    padding: {
      type: String,
      default: '0 10px'
    }
  }
});
</script>

<style scoped>
.form-item {
  width: 100%;
  box-sizing: border-box;
}
</style>
