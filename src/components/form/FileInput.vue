<template>
  <div class="form-item-file">
    <label v-if="label">{{ label }}</label>
    <div class="file-input-wrapper">
      <input
        ref="filePathInput"
        type="text"
        :value="modelValue"
        :placeholder="placeholder"
        readonly
        @click="selectFile"
      />
      <button class="select-file-btn" @click="selectFile">
        {{ buttonText }}
      </button>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref } from 'vue';

export default defineComponent({
  name: 'FileInput',
  props: {
    modelValue: {
      type: String,
      default: ''
    },
    label: {
      type: String,
      default: ''
    },
    placeholder: {
      type: String,
      default: '请选择文件'
    },
    buttonText: {
      type: String,
      default: '选择文件'
    },
    accept: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const filePathInput = ref(null);

    const selectFile = () => {
      // 创建一个隐藏的文件输入元素
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = props.accept;

      // 监听文件选择事件
      fileInput.onchange = event => {
        const file = event.target.files[0];
        if (file) {
          emit('update:modelValue', file.path || file.name);
        }
      };

      // 触发文件选择对话框
      fileInput.click();
    };

    return {
      filePathInput,
      selectFile
    };
  }
});
</script>

<style scoped>
.form-item-file {
  width: 100%;
}

label {
  display: block;
  margin-bottom: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: normal;
}

.file-input-wrapper {
  display: flex;
  align-items: center;
  position: relative;
  gap: 0;
}

.file-input-wrapper input {
  width: calc(100% - 75px);
  height: 36px;
  background-color: transparent;
  border: 1px solid #666;
  border-radius: 6px 0 0 6px;
  border-right: none;
  color: #fff;
  padding: 0 20px;
  box-sizing: border-box;
  outline: none;
  font-weight: normal;
  transition: border-color var(--theme-transition-duration) var(--theme-transition-timing);
  cursor: pointer;
  z-index: 1;
}

.file-input-wrapper input:focus {
  border-color: #0083d3;
  box-shadow: none;
}

.file-input-wrapper input::placeholder {
  color: #666;
}

.file-input-wrapper input:focus + .select-file-btn {
  border-color: #0083d3;
}

.select-file-btn {
  height: 36px;
  min-width: 75px;
  background-color: #1e1e1e;
  border: 1px solid #666;
  border-left: none;
  color: #fff;
  padding: 0;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
  white-space: nowrap;
  font-size: 13px;
  transition:
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    border-color var(--theme-transition-duration) var(--theme-transition-timing);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 0;
}

.select-file-btn:hover {
  background-color: #333;
}
</style>
