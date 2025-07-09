<template>
  <div class="search-input-container">
    <input 
      type="text" 
      :placeholder="placeholder" 
      class="custom-search-input" 
      v-model="searchText"
      @input="onSearchInput"
      @keyup.enter="onEnter" 
    />
    <div class="search-icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
        <path fill="currentColor" d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z" />
      </svg>
    </div>
  </div>
</template>

<script>
import { ref, watch } from 'vue'

export default {
  name: 'SearchInput',
  props: {
    placeholder: {
      type: String,
      default: '请输入搜索内容'
    },
    modelValue: {
      type: String,
      default: ''
    },
    debounce: {
      type: Number,
      default: 300
    }
  },
  emits: ['update:modelValue', 'search', 'enter'],
  setup(props, { emit }) {
    const searchText = ref(props.modelValue)
    let debounceTimer = null

    // 监听外部 v-model 值变化
    watch(() => props.modelValue, (newVal) => {
      searchText.value = newVal
    })

    // 监听内部值变化，更新外部 v-model
    watch(searchText, (newVal) => {
      emit('update:modelValue', newVal)
    })

    // 搜索输入处理（带防抖）
    const onSearchInput = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      
      debounceTimer = setTimeout(() => {
        emit('search', searchText.value)
      }, props.debounce)
    }

    // 回车处理
    const onEnter = () => {
      emit('enter', searchText.value)
      emit('search', searchText.value)
    }

    return {
      searchText,
      onSearchInput,
      onEnter
    }
  }
}
</script>

<style>
.search-input-container {
  position: relative;
  width: 100%;
}

.custom-search-input {
  width: 100%;
  height: 36px;
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 13px;
  padding: 0 40px 0 12px;
  outline: none;
  font-weight: normal;
}

.custom-search-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.custom-search-input::placeholder {
  color: var(--color-text-placeholder);
}

.search-icon {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  color: var(--color-text-secondary);
}
</style> 