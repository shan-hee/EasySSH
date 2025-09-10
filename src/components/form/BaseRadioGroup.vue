<template>
  <div class="form-item-radio-group">
    <label v-if="label">{{ label }}</label>
    <div class="radio-button-wrapper" :style="{ width: width }">
      <button
        v-for="(option, index) in options"
        :key="index"
        class="radio-button"
        :class="{ active: modelValue === option.value }"
        @click="onSelect(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<script>
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'BaseRadioGroup',
  props: {
    modelValue: {
      type: [String, Number, Boolean],
      default: ''
    },
    options: {
      type: Array,
      default: () => []
    },
    label: {
      type: String,
      default: ''
    },
    width: {
      type: String,
      default: '48%'
    }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const onSelect = value => {
      emit('update:modelValue', value);
    };

    return {
      onSelect
    };
  }
});
</script>

<style scoped>
.form-item-radio-group {
  width: 100%;
}

label {
  display: block;
  margin-bottom: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: normal;
}

.radio-button-wrapper {
  display: flex;
  border-radius: 6px;
  overflow: hidden;
  background-color: #242424;
  border: none;
}

.radio-button {
  flex: 1;
  background-color: transparent;
  border: none;
  padding: 8px 10px;
  color: #fff;
  cursor: pointer;
  outline: none;
  font-weight: normal;
  transition: background-color 0.3s;
}

.radio-button.active {
  background-color: #383838;
  color: #fff;
}
</style>
