<template>
  <div class="custom-settings-card">
    <div class="card-header">
      <span>{{ title }}</span>
    </div>
    <div class="card-body">
      <slot></slot>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SettingsCard',
  props: {
    title: {
      type: String,
      required: true
    }
  }
}
</script>

<style scoped>
.custom-settings-card {
  width: 100%;
  margin-bottom: 30px;
  overflow: hidden;
}

.card-header {
  padding: 15px 20px;
  font-size: 16px;
  color: #fff;
  background-color: #333;
  border-radius: 4px;
  margin-bottom: 1px;
}

.card-body {
  padding: 20px 20px 10px;
  background-color: transparent;
  border-radius: 4px;
}
</style> 