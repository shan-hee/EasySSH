<template>
  <div class="form-item-input">
    <label v-if="label">{{ label }}</label>
    <div class="input-wrapper">
      <input
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :readonly="readonly"
        :disabled="disabled"
        :autocomplete="getAutocompleteValue"
        :class="{ 'with-suffix': $slots.suffix }"
        @input="onInput"
        @focus="$emit('focus', $event)"
        @blur="$emit('blur', $event)"
        @click="$emit('click', $event)"
      />
      <div v-if="$slots.suffix" class="input-suffix">
        <slot name="suffix" />
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, computed } from 'vue';

export default defineComponent({
  name: 'BaseInput',
  props: {
    modelValue: {
      type: [String, Number],
      default: ''
    },
    label: {
      type: String,
      default: ''
    },
    placeholder: {
      type: String,
      default: ''
    },
    type: {
      type: String,
      default: 'text'
    },
    readonly: {
      type: Boolean,
      default: false
    },
    disabled: {
      type: Boolean,
      default: false
    },
    autocomplete: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue', 'focus', 'blur', 'click'],
  setup(props, { emit }) {
    const onInput = event => {
      emit('update:modelValue', event.target.value);
    };

    // 自动计算autocomplete属性值
    const getAutocompleteValue = computed(() => {
      // 如果提供了显式的autocomplete属性，使用它
      if (props.autocomplete) {
        return props.autocomplete;
      }

      // 根据输入类型自动设置适当的值
      if (props.type === 'password') {
        return 'current-password';
      }

      // 默认值
      return 'off';
    });

    return {
      onInput,
      getAutocompleteValue
    };
  }
});
</script>

<style scoped>
.form-item-input {
  width: 100%;
}

label {
  display: block;
  margin-bottom: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: normal;
}

.input-wrapper {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
}

input {
  width: 100%;
  height: 36px;
  background-color: transparent;
  border: 1px solid #666;
  border-radius: 6px;
  color: #fff;
  padding: 0 20px;
  box-sizing: border-box;
  outline: none;
  font-weight: normal;
  transition: border-color var(--theme-transition-duration) var(--theme-transition-timing);
}

input.with-suffix {
  padding-right: 40px;
}

input:focus {
  border-color: #0083d3;
  box-shadow: 0 0 0 1px rgba(0, 131, 211, 0.2);
}

input::placeholder {
  color: #666;
}

input[readonly] {
  cursor: pointer;
}

.input-suffix {
  position: absolute;
  right: 0;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
