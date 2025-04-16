/**
 * 全局自定义指令集合
 */

// v-focus：自动聚焦指令
const focus = {
  mounted: (el) => {
    el.focus()
  }
}

// v-click-outside：点击元素外部
const clickOutside = {
  beforeMount: (el, binding) => {
    el._clickOutsideHandler = (event) => {
      if (!(el === event.target || el.contains(event.target))) {
        binding.value(event)
      }
    }
    document.addEventListener('click', el._clickOutsideHandler)
  },
  unmounted: (el) => {
    document.removeEventListener('click', el._clickOutsideHandler)
    delete el._clickOutsideHandler
  }
}

// v-copy：点击复制内容
const copy = {
  beforeMount: (el, binding) => {
    el._copyHandler = async () => {
      try {
        const value = typeof binding.value === 'function' 
          ? binding.value() 
          : binding.value
        
        await navigator.clipboard.writeText(value)
        
        // 触发自定义事件
        el.dispatchEvent(new CustomEvent('copy-success'))
      } catch (err) {
        // 触发自定义事件
        el.dispatchEvent(new CustomEvent('copy-error', { detail: err }))
        console.error('复制失败:', err)
      }
    }
    el.addEventListener('click', el._copyHandler)
  },
  unmounted: (el) => {
    el.removeEventListener('click', el._copyHandler)
    delete el._copyHandler
  }
}

// v-loading：局部加载状态
const loading = {
  beforeMount: (el, binding) => {
    // 创建加载指示器
    const loadingEl = document.createElement('div')
    loadingEl.className = 'v-loading-container'
    loadingEl.innerHTML = `
      <div class="v-loading-spinner">
        <svg viewBox="0 0 50 50" class="circular">
          <circle cx="25" cy="25" r="20" fill="none" class="path"></circle>
        </svg>
      </div>
    `
    
    // 设置样式
    el.style.position = 'relative'
    loadingEl.style.position = 'absolute'
    loadingEl.style.top = '0'
    loadingEl.style.left = '0'
    loadingEl.style.right = '0'
    loadingEl.style.bottom = '0'
    loadingEl.style.backgroundColor = 'rgba(255, 255, 255, 0.7)'
    loadingEl.style.display = 'flex'
    loadingEl.style.justifyContent = 'center'
    loadingEl.style.alignItems = 'center'
    loadingEl.style.zIndex = '1000'
    loadingEl.style.borderRadius = 'inherit'
    
    // 保存引用
    el._loadingElement = loadingEl
    
    // 立即更新状态
    if (binding.value) {
      el.appendChild(loadingEl)
    }
  },
  updated: (el, binding) => {
    if (binding.value) {
      if (!el.contains(el._loadingElement)) {
        el.appendChild(el._loadingElement)
      }
    } else {
      if (el.contains(el._loadingElement)) {
        el.removeChild(el._loadingElement)
      }
    }
  },
  unmounted: (el) => {
    if (el._loadingElement && el.contains(el._loadingElement)) {
      el.removeChild(el._loadingElement)
    }
    delete el._loadingElement
  }
}

// 导出所有指令
export default {
  focus,
  clickOutside,
  copy,
  loading
} 