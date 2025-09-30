<template>
  <div class="terminal-main-area" :class="{ 'grid-experiment': useGrid, 'with-monitoring': withMonitoring }">
    <transition name="monitoring-toggle" :css="animateMonitoring">
      <div
        v-show="showMonitoring"
        class="terminal-monitoring-panel theme-transition"
        :style="tabSwitching ? { transition: 'none' } : null"
        :ref="el => setMonitoringRef && setMonitoringRef(el)"
      >
        <slot name="monitoring" />
      </div>
    </transition>

    <div
      class="terminal-right-area"
      :class="{ 'with-monitoring-panel': withMonitoring }"
      :style="tabSwitching ? { transition: 'none' } : null"
      :ref="el => setRightAreaRef && setRightAreaRef(el)"
    >
      <div class="terminal-content-padding theme-transition">
        <slot name="terminal" />
      </div>

      <transition name="ai-combined-toggle" :css="!tabSwitching">
        <div v-if="showAI && isActive" class="terminal-ai-combined-area theme-transition">
          <slot name="ai" />
        </div>
      </transition>
    </div>
  </div>
</template>

<script>
export default {
  name: 'TerminalFrame',
  props: {
    tabSwitching: { type: Boolean, default: false },
    showMonitoring: { type: Boolean, default: false },
    animateMonitoring: { type: Boolean, default: false },
    withMonitoring: { type: Boolean, default: false },
    showAI: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },
    useGrid: { type: Boolean, default: false },
    setRightAreaRef: { type: Function, default: null },
    setMonitoringRef: { type: Function, default: null }
  }
};
</script>

<style scoped>
/* 样式承载仍在父组件，通过 :deep 选择器应用，此处不重复样式 */
</style>
