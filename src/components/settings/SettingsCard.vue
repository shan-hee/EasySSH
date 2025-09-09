<template>
  <div class="custom-settings-card">
    <div class="card-header">
      <span>{{ title }}</span>
    </div>
    <div class="card-body">
      <slot />
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
};
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
  border-radius: 4px;
  margin-bottom: 1px;
  font-weight: bold;
}

.card-body {
  padding: 20px 20px 10px;
  border-radius: 0 0 4px 4px;
}
</style>
