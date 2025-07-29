<template>
  <div 
    :class="['logo', 'rainbow-logo', { 'logo--clickable': clickable }]"
    :style="logoStyle"
    @click="handleClick"
  >
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" :width="size" :height="size">
      <defs>
        <linearGradient :id="gradientId" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ff0000">
            <animate attributeName="stop-color" 
              values="#ff0000; #ff7f00; #ffff00; #00ff00; #0000ff; #4b0082; #8b00ff; #ff0000"
              dur="8s" repeatCount="indefinite" />
          </stop>
          <stop offset="25%" stop-color="#ff7f00">
            <animate attributeName="stop-color" 
              values="#ff7f00; #ffff00; #00ff00; #0000ff; #4b0082; #8b00ff; #ff0000; #ff7f00"
              dur="8s" repeatCount="indefinite" />
          </stop>
          <stop offset="50%" stop-color="#00ff00">
            <animate attributeName="stop-color" 
              values="#00ff00; #0000ff; #4b0082; #8b00ff; #ff0000; #ff7f00; #ffff00; #00ff00"
              dur="8s" repeatCount="indefinite" />
          </stop>
          <stop offset="75%" stop-color="#0000ff">
            <animate attributeName="stop-color" 
              values="#0000ff; #4b0082; #8b00ff; #ff0000; #ff7f00; #ffff00; #00ff00; #0000ff"
              dur="8s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stop-color="#8b00ff">
            <animate attributeName="stop-color" 
              values="#8b00ff; #ff0000; #ff7f00; #ffff00; #00ff00; #0000ff; #4b0082; #8b00ff"
              dur="8s" repeatCount="indefinite" />
          </stop>
        </linearGradient>
      </defs>
      <path d="M20,19V7H4V19H20M20,3A2,2 0 0,1 22,5V19A2,2 0 0,1 20,21H4A2,2 0 0,1 2,19V5C2,3.89 2.9,3 4,3H20M13,17V15H18V17H13M9.58,13L5.57,9H8.4L11.7,12.3C12.09,12.69 12.09,13.33 11.7,13.72L8.42,17H5.59L9.58,13Z" :fill="`url(#${gradientId})`" />
    </svg>
  </div>
</template>

<script>
import { defineComponent, computed } from 'vue'

export default defineComponent({
  name: 'Logo',
  props: {
    // logo尺寸
    size: {
      type: [String, Number],
      default: 24
    },
    // 是否可点击
    clickable: {
      type: Boolean,
      default: false
    },
    // 自定义宽度
    width: {
      type: [String, Number],
      default: null
    },
    // 自定义高度
    height: {
      type: [String, Number],
      default: null
    },
    // 背景色
    backgroundColor: {
      type: String,
      default: null
    }
  },
  emits: ['click'],
  setup(props, { emit }) {
    // 生成唯一的渐变ID，避免多个Logo组件之间的冲突
    const gradientId = computed(() => `rainbow-gradient-${Math.random().toString(36).substr(2, 9)}`)
    
    // 计算logo容器样式
    const logoStyle = computed(() => {
      const style = {}
      
      if (props.width !== null) {
        style.width = typeof props.width === 'number' ? `${props.width}px` : props.width
      }
      
      if (props.height !== null) {
        style.height = typeof props.height === 'number' ? `${props.height}px` : props.height
      }
      
      if (props.backgroundColor) {
        style.backgroundColor = props.backgroundColor
      }
      
      return style
    })
    
    // 处理点击事件
    const handleClick = (event) => {
      if (props.clickable) {
        emit('click', event)
      }
    }
    
    return {
      gradientId,
      logoStyle,
      handleClick
    }
  }
})
</script>

<style scoped>
.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
  width: 40px;
  height: 54px;
  margin: 0;
  background-color: var(--sidebar-logo-bg);
  box-sizing: border-box;
  z-index: 1;
  border-right: 1px solid var(--sidebar-border);
  border: none; /* 移除默认边框，由父容器控制 */
}

.logo svg {
  margin: 0;
}

.rainbow-logo {
  position: relative;
  z-index: 10;
  background-color: var(--sidebar-logo-bg);
}

.rainbow-logo svg {
  position: relative;
  z-index: 5;
  filter: drop-shadow(0 2px 5px rgba(0,0,0,0.7));
}

.rainbow-logo path {
  fill: url(#rainbow-gradient) !important;
}

.logo--clickable {
  cursor: pointer;
  transition: transform var(--theme-transition-duration, 0.3s) var(--theme-transition-timing, ease);
}

.logo--clickable:hover {
  transform: scale(1.05);
}

.logo--clickable:active {
  transform: scale(0.95);
}

@keyframes rainbowFlow {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}
</style>
