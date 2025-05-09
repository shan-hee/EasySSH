<template>
  <div class="sftp-path-nav">
    <button class="sftp-nav-button" @click="navigateToParent" title="返回上级目录">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
        <path fill="currentColor" d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z" />
      </svg>
    </button>
    <div class="sftp-path-input" @click="enableInputMode" tabindex="0" @focus="enableInputMode">
      <button class="sftp-path-home-button" @click.stop="navigateToHome" title="返回根目录">
        <svg class="sftp-path-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
          <path fill="currentColor" d="M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z" />
        </svg>
      </button>
      <div v-if="pathParts.length > 0 && !showInputMode" class="sftp-path-segments">
        <span v-for="(part, index) in pathParts" :key="index" class="sftp-path-segment">
          <span class="sftp-path-separator" v-if="index > 0">/</span>
          <button class="sftp-path-part-button" @click.stop="navigateToPathPart(index)" :title="`导航到 /${pathParts.slice(0, index+1).join('/')}`">
            {{ part }}
          </button>
        </span>
      </div>
      <input v-if="pathParts.length === 0 || showInputMode" type="text" v-model="path" class="sftp-path-field" @keyup.enter="navigateTo" @blur="onInputBlur" ref="pathInput" />
    </div>
    <button class="sftp-nav-button" @click="toggleHiddenFiles" title="显示/隐藏隐藏文件">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12,9A3,3 0 0,1 15,12A3,3 0 0,1 12,15A3,3 0 0,1 9,12A3,3 0 0,1 12,9M12,4.5C17,4.5 21.27,7.61 23,12C21.27,16.39 17,19.5 12,19.5C7,19.5 2.73,16.39 1,12C2.73,7.61 7,4.5 12,4.5M3.18,12C4.83,15.36 8.24,17.5 12,17.5C15.76,17.5 19.17,15.36 20.82,12C19.17,8.64 15.76,6.5 12,6.5C8.24,6.5 4.83,8.64 3.18,12Z" v-if="showHiddenFiles" />
        <path fill="currentColor" d="M2,5.27L3.28,4L20,20.72L18.73,22L15.65,18.92C14.5,19.3 13.28,19.5 12,19.5C7,19.5 2.73,16.39 1,12C1.69,10.24 2.79,8.69 4.19,7.46L2,5.27M12,9A3,3 0 0,1 15,12C15,12.35 14.94,12.69 14.83,13L11,9.17C11.31,9.06 11.65,9 12,9M12,4.5C17,4.5 21.27,7.61 23,12C22.18,14.08 20.79,15.88 19,17.19L17.58,15.76C18.94,14.82 20.06,13.54 20.82,12C19.17,8.64 15.76,6.5 12,6.5C10.91,6.5 9.84,6.68 8.84,7L7.3,5.47C8.74,4.85 10.33,4.5 12,4.5M3.18,12C4.83,15.36 8.24,17.5 12,17.5C12.69,17.5 13.37,17.43 14,17.29L11.72,15C10.29,14.85 9.15,13.71 9,12.28L5.6,8.87C4.61,9.72 3.78,10.78 3.18,12Z" v-else />
      </svg>
    </button>
    <button class="sftp-nav-button" @click="$emit('refresh')" title="刷新">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
        <path fill="currentColor" d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" />
      </svg>
    </button>
  </div>
</template>

<script>
import { defineComponent, ref, watch, computed } from 'vue'

export default defineComponent({
  name: 'SftpPathNavigator',
  props: {
    currentPath: {
      type: String,
      required: true
    }
  },
  emits: ['navigate', 'refresh', 'toggle-hidden-files'],
  setup(props, { emit }) {
    const path = ref(props.currentPath)
    const showHiddenFiles = ref(false)
    const showInputMode = ref(false)
    const pathInput = ref(null)
    
    // 计算路径各部分
    const pathParts = computed(() => {
      return props.currentPath.split('/').filter(part => part)
    })
    
    // 同步props和内部状态
    watch(() => props.currentPath, (newPath) => {
      path.value = newPath
      // 当路径变更时，退出输入模式
      showInputMode.value = false
    })
    
    // 启用输入模式
    const enableInputMode = (event) => {
      // 防止事件冒泡，避免导航按钮点击后也触发输入模式
      if (event) {
        // 阻止当点击路径段按钮时开启输入模式
        const target = event.target || event.srcElement
        if (target && (target.className === 'sftp-path-part-button' || 
                       target.className === 'sftp-path-home-button' || 
                       target.closest('.sftp-path-home-button'))) {
          return
        }
      }
      
      if (!showInputMode.value) {
        showInputMode.value = true
        path.value = props.currentPath
        
        // 使用nextTick确保DOM已更新后再聚焦
        setTimeout(() => {
          if (pathInput.value) {
            pathInput.value.focus()
          }
        }, 50)
      }
    }
    
    // 输入框失去焦点时处理
    const onInputBlur = () => {
      // 如果路径没有变更，则返回到路径导航模式
      if (path.value === props.currentPath) {
        showInputMode.value = false
      }
    }
    
    // 导航到输入的路径
    const navigateTo = () => {
      // 确保路径以斜杠开头
      const formattedPath = path.value.startsWith('/') 
        ? path.value 
        : '/' + path.value
      
      emit('navigate', formattedPath)
      // 导航后退出输入模式
      showInputMode.value = false
    }
    
    // 导航到父目录
    const navigateToParent = () => {
      const parts = pathParts.value
      
      // 如果已经在根目录，不做任何操作
      if (parts.length === 0) return
      
      // 移除最后一个目录部分
      parts.pop()
      // 构建新路径
      const newPath = parts.length === 0 ? '/' : '/' + parts.join('/')
      
      emit('navigate', newPath)
    }
    
    // 导航到根目录
    const navigateToHome = () => {
      emit('navigate', '/')
    }
    
    // 导航到指定层级的路径
    const navigateToPathPart = (index) => {
      const targetPath = '/' + pathParts.value.slice(0, index + 1).join('/')
      emit('navigate', targetPath)
    }
    
    // 切换显示/隐藏隐藏文件
    const toggleHiddenFiles = () => {
      showHiddenFiles.value = !showHiddenFiles.value
      emit('toggle-hidden-files', showHiddenFiles.value)
    }
    
    return {
      path,
      pathParts,
      showHiddenFiles,
      showInputMode,
      pathInput,
      navigateTo,
      navigateToParent,
      navigateToHome,
      navigateToPathPart,
      toggleHiddenFiles,
      enableInputMode,
      onInputBlur
    }
  }
})
</script>

<style scoped>
.sftp-path-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 16px;
}

.sftp-path-input {
  flex: 1;
  display: flex;
  align-items: center;
  background-color: #2c2c2c;
  border-radius: 4px;
  padding: 0 8px;
  min-width: 0; /* 允许容器缩小到比内容小 */
  overflow: hidden;
  height: 32px; /* 固定高度确保一致性 */
  position: relative;
  cursor: text; /* 显示文本输入光标 */
  outline: none; /* 移除焦点轮廓 */
}

.sftp-path-input:hover {
  background-color: #333;
}

.sftp-path-input:focus {
  background-color: #333;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
}

.sftp-path-home-button {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  color: #aaa;
  transition: color 0.2s;
  flex-shrink: 0;
  z-index: 1; /* 确保按钮可点击 */
}

.sftp-path-home-button:hover {
  color: #fff;
}

.sftp-path-icon {
  margin-right: 8px;
}

.sftp-path-segments {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  overflow-x: auto;
  flex: 1;
  min-width: 0;
  height: 100%;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
  z-index: 1; /* 确保路径段可点击 */
}

.sftp-path-segments::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Opera */
}

.sftp-path-segment {
  white-space: nowrap;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.sftp-path-separator {
  color: #666;
  margin: 0 2px;
}

.sftp-path-part-button {
  background: transparent;
  border: none;
  color: #e0e0e0;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  transition: background-color 0.2s;
  z-index: 1; /* 确保按钮可点击 */
}

.sftp-path-part-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.sftp-path-field {
  flex: 1;
  background: transparent;
  border: none;
  color: #fff;
  font-size: 12px;
  height: 100%;
  outline: none;
  min-width: 0; /* 允许输入框缩小 */
  width: 100%;
}

.sftp-nav-button {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #2c2c2c;
  border: none;
  border-radius: 4px;
  width: 32px;
  height: 32px;
  color: #e0e0e0;
  cursor: pointer;
  transition: background-color 0.2s;
  flex-shrink: 0;
}

.sftp-nav-button:hover {
  background-color: #3c3c3c;
}

@media (max-width: 450px) {
  .sftp-path-input {
    padding: 0 4px;
  }
}
</style> 