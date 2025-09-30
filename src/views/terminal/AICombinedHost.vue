<template>
  <AICombinedPanel
    :ref="setPanelRef"
    :terminal-id="terminalId"
    :messages="messages"
    :max-height="maxHeight"
    :is-mobile="isMobile"
    :is-streaming="isStreaming"
    :ai-service="aiService"
    @ai-response="$emit('ai-response', $event)"
    @ai-streaming="$emit('ai-streaming', $event)"
    @mode-change="$emit('mode-change', $event)"
    @input-focus="$emit('input-focus')"
    @input-blur="$emit('input-blur')"
    @execute-command="$emit('execute-command', $event)"
    @clear-history="$emit('clear-history')"
    @edit-command="$emit('edit-command', $event)"
    @add-to-scripts="$emit('add-to-scripts', $event)"
    @height-change="$emit('height-change', $event)"
    @height-change-start="$emit('height-change-start', $event)"
    @height-change-end="$emit('height-change-end', $event)"
  />
</template>

<script>
import AICombinedPanel from '../../components/ai/AICombinedPanel.vue';

export default {
  name: 'AICombinedHost',
  components: { AICombinedPanel },
  props: {
    terminalId: { type: String, required: true },
    messages: { type: Array, default: () => [] },
    maxHeight: { type: Number, default: 300 },
    isMobile: { type: Boolean, default: false },
    isStreaming: { type: Boolean, default: false },
    aiService: { type: Object, default: null },
    setPanelRef: { type: Function, default: null }
  },
  emits: [
    'ai-response',
    'ai-streaming',
    'mode-change',
    'input-focus',
    'input-blur',
    'execute-command',
    'clear-history',
    'edit-command',
    'add-to-scripts',
    'height-change',
    'height-change-start',
    'height-change-end'
  ]
};
</script>

<style scoped>
/* 纯转发表现层，不承载样式 */
</style>

