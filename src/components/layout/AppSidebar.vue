<template>
  <aside class="sidebar">
    <!-- Logo -->
    <div class="logo rainbow-logo">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <defs>
          <linearGradient id="rainbow-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
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
        <path d="M20,19V7H4V19H20M20,3A2,2 0 0,1 22,5V19A2,2 0 0,1 20,21H4A2,2 0 0,1 2,19V5C2,3.89 2.9,3 4,3H20M13,17V15H18V17H13M9.58,13L5.57,9H8.4L11.7,12.3C12.09,12.69 12.09,13.33 11.7,13.72L8.42,17H5.59L9.58,13Z" />
      </svg>
    </div>
    
    <!-- 导航菜单 -->
    <nav class="nav-menu">
      <!-- 登录后才显示的图标 -->
      <div v-if="userStore.isLoggedIn" 
           class="nav-item" 
           @click="handleNavigation('/')" 
           :class="{ active: currentRoute === '/' }" 
           data-tooltip="控制台">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
          <path fill="#a0a0a0" d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M9 17H7V10H9V17M13 17H11V7H13V17M17 17H15V13H17V17Z" />
        </svg>
      </div>
      
      <!-- 默认显示的设置图标 -->
      <div class="nav-item" 
           @click="handleNavigation('/settings')" 
           :class="{ active: currentRoute === '/settings' }" 
           data-tooltip="设置">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
          <path fill="#a0a0a0" d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
        </svg>
      </div>
    </nav>
  </aside>
</template>

<script>
import { defineComponent, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useTabStore } from '@/store/tab'
import { useUserStore } from '@/store/user'

export default defineComponent({
  name: 'AppSidebar',
  setup() {
    const router = useRouter()
    const route = useRoute()
    const tabStore = useTabStore()
    const userStore = useUserStore()
    
    // 当前路由路径
    const currentRoute = computed(() => route.path)
    
    // 关闭登录面板事件
    const closeLoginPanel = () => {
      const appHeader = document.querySelector('.app-header');
      if (appHeader) {
        const event = new CustomEvent('close-login-panel');
        appHeader.dispatchEvent(event);
      }
    }
    
    // 导航处理函数
    const handleNavigation = (route) => {
      closeLoginPanel(); // 在导航前先关闭登录面板
      
      router.push(route)
    }
    
    return {
      currentRoute,
      handleNavigation,
      userStore
    }
  }
})
</script>

<style scoped>
.sidebar {
  width: 40px;
  height: 100vh;
  background-color: #1e1e1e;
  transition: width 0.3s;
  overflow: visible;
  border-right: 1px solid #333;
  box-sizing: border-box;
  z-index: 10000;
}

.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
  width: 40px;
  height: 54px;
  margin: 0;
  background-color: #1e1e1e;
  box-sizing: border-box;
  z-index: 1;
  border-right: 1px solid #333;
}

.logo svg {
  margin: 0;
}

.rainbow-logo {
  position: relative;
  z-index: 10;
  background-color: #1e1e1e;
}

.rainbow-logo svg {
  position: relative;
  z-index: 5;
  filter: drop-shadow(0 2px 5px rgba(0,0,0,0.7));
}

.rainbow-logo path {
  fill: url(#rainbow-gradient) !important;
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

.nav-menu {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.nav-item {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  color: #a0a0a0;
  border-radius: 4px;
  width: 40px;
  height: 40px;
  position: relative;
  transition: all 0.2s ease;
  margin: 1px auto;
  background: none;
  border: none;
  z-index: 10;
}

.nav-item svg {
  width: 20px;
  height: 20px;
}

.nav-item svg path {
  transition: fill 0.2s ease;
}

.nav-item:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.nav-item:hover svg path {
  fill: #ffffff;
}

.nav-item.active {
  color: #a0a0a0;
  background-color: transparent;
  border-left: none;
}

.nav-item.active svg path {
  fill: #d0d0d0;
}

.nav-item.active:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.nav-item.active:hover svg path {
  fill: #ffffff;
}

.nav-item .icon {
  font-size: 16px;
  color: #a0a0a0;
}

.nav-item:hover::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  background-color: #333;
  color: #e0e0e0;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  white-space: nowrap;
  margin-left: 10px;
  z-index: 2000;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
  display: block;
  pointer-events: none;
}

.nav-item:hover::before {
  content: "";
  position: absolute;
  right: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-right: 5px solid #333;
  z-index: 2100;
  pointer-events: none;
}
</style> 