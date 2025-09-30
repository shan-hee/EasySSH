<template>
  <ResponsiveMonitoringPanel
    :visible="visible"
    :monitoring-data="monitoringData"
    :terminal-id="terminalId"
    :state-manager="stateManager"
    :disable-animation="disableAnimation"
  />
</template>

<script>
import ResponsiveMonitoringPanel from '../../components/monitoring/ResponsiveMonitoringPanel.vue';

export default {
  name: 'MonitoringPaneHost',
  components: { ResponsiveMonitoringPanel },
  props: {
    visible: { type: Boolean, default: false },
    monitoringData: { type: Object, default: () => ({}) },
    terminalId: { type: String, required: true },
    stateManager: { type: Object, required: false, default: null },
    disableAnimation: { type: Boolean, default: false }
  }
};
</script>

<style scoped>
/* 纯转发表现层，不承载样式 */
</style>

