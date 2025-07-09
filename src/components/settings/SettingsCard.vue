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
  color: var(--color-text-primary);
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-light);
  border-radius: 4px;
  margin-bottom: 1px;
  font-weight: 500;
}

.card-body {
  padding: 20px 20px 10px;
  background-color: var(--color-bg-container);
  border: 1px solid var(--color-border-lighter);
  border-top: none;
  border-radius: 0 0 4px 4px;
}
</style> 