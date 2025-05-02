<template>
  <header class="app-header">
    <!-- 标签页容器 -->
    <div class="tab-container">
      <div v-for="(tab, index) in tabStore.tabs" 
           :key="index" 
           class="tab-item" 
           :class="{ active: tabStore.activeTabIndex === index }"
           :data-tab-type="tab.type"
           @click="handleTabClick(index)"
           @mousedown="handleTabMouseDown($event, index)">
        <svg v-if="tab.type === 'newConnection'" class="ruyi-icon ruyi-icon-ot-connect-link" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
          <g fill="currentColor">
            <path d="M1.799.749a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 00-1-1h-4Zm4 1h-4v4h4v-4Zm4.402 7.502a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 00-1-1h-4Zm4 1h-4v4h4v-4Z" fill-rule="evenodd" clip-rule="evenodd"></path>
            <path d="M3.799 8.749a.5.5 0 100-1 .5.5 0 000 1Zm.5 1.5a.5.5 0 11-1 0 .5.5 0 011 0Zm-.5 2.502a.5.5 0 100-1 .5.5 0 000 1Zm2.402-.5a.5.5 0 11-1 0 .5.5 0 011 0Zm1.5.5a.5.5 0 100-1 .5.5 0 000 1Z"></path>
          </g>
        </svg>
        <svg v-else-if="tab.type === 'sftp'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
          <path fill="currentColor" d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z" />
        </svg>
        <svg v-else-if="tab.type === 'settings'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
          <path fill="currentColor" d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
        </svg>
        <span class="tab-title">{{ tab.title }}</span>
        <button class="tab-close" @click.stop="tabStore.closeTab(index)">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
            <path fill="#ffffff" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
          </svg>
        </button>
      </div>
      
      <!-- 添加标签按钮 -->
      <TabAdder />
    </div>
    
    <!-- 用户操作区 -->
    <div class="header-actions">
      <!-- 未登录时显示登录按钮 -->
      <button v-if="!userStore.isLoggedIn" class="btn-icon login-btn" @click="showLoginPanel">
        登录
      </button>
      
      <!-- 登录后显示用户图标和下拉菜单 -->
      <div v-else class="user-menu-container">
        <button class="btn-icon user-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
            <path fill="#a0a0a0" d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z" />
          </svg>
        </button>
        
        <!-- 用户下拉菜单 -->
        <div class="user-dropdown">
          <div class="user-dropdown-item" @click="navigateToProfile">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
              <path fill="#a0a0a0" d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z" />
            </svg>
            <span>个人资料</span>
          </div>
          <div class="user-dropdown-item" @click="handleLogout">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
              <path fill="#a0a0a0" d="M16,17V14H9V10H16V7L21,12L16,17M14,2A2,2 0 0,1 16,4V6H14V4H5V20H14V18H16V20A2,2 0 0,1 14,22H5A2,2 0 0,1 3,20V4A2,2 0 0,1 5,2H14Z" />
            </svg>
            <span>登出</span>
          </div>
        </div>
      </div>
    </div>
  </header>
  
  <!-- 登录面板 -->
  <div v-if="isLoginPanelVisible" class="login-panel-container">
    <LoginPanel @login-success="closeLoginPanel" />
  </div>
</template>

<script>
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { useTabStore } from '@/store/tab'
import LoginPanel from '@/components/auth/LoginPanel.vue'
import TabAdder from '@/components/layout/TabAdder.vue'
import { ElMessage } from 'element-plus'
import log from '@/services/log'

export default defineComponent({
  name: 'AppHeader',
  components: {
    LoginPanel,
    TabAdder
  },
  setup() {
    const router = useRouter()
    const userStore = useUserStore()
    const tabStore = useTabStore()
    const isLoginPanelVisible = ref(false)
    
    // 添加自定义事件监听
    onMounted(() => {
      const headerElement = document.querySelector('.app-header');
      if (headerElement) {
        // 监听关闭登录面板事件
        headerElement.addEventListener('close-login-panel', () => {
          isLoginPanelVisible.value = false;
        });
        
        // 监听显示登录面板事件
        headerElement.addEventListener('show-login-panel', () => {
          isLoginPanelVisible.value = true;
        });
      }
    });
    
    // 添加对标签状态的监听
    watch(
      () => tabStore.tabs,
      (newTabs) => {
        log.debug('标签数组已更新', { count: newTabs.length })
      },
      { deep: true, immediate: true }
    )
    
    // 登录面板控制
    const showLoginPanel = () => {
      // 只显示登录面板，不再切换其显示状态
      isLoginPanelVisible.value = true
    }
    
    const closeLoginPanel = () => {
      isLoginPanelVisible.value = false
    }
    
    // 用户导航
    const navigateToProfile = () => {
      router.push('/profile')
    }
    
    // 登出处理
    const handleLogout = () => {
      // 先关闭用户菜单
      const userMenu = document.querySelector('.user-dropdown');
      if (userMenu) {
        userMenu.style.opacity = '0';
        userMenu.style.visibility = 'hidden';
      }
      
      // 调用store的登出方法
      userStore.logout()
      
      // 显示登出成功消息
      ElMessage({
        message: '已安全退出登录',
        type: 'success',
        offset: 3,
        zIndex: 9999
      })
      
      // 显示登录面板
      showLoginPanel()
    }
    
    // 处理标签页点击
    const handleTabClick = (index) => {
      // 先关闭登录面板
      closeLoginPanel()
      // 然后切换到点击的标签页
      tabStore.switchTab(index)
    }
    
    // 处理标签页鼠标按下事件
    const handleTabMouseDown = (event, index) => {
      // 检测是否是鼠标中键点击（button值为1表示鼠标中键）
      if (event.button === 1) {
        // 阻止默认行为和事件冒泡
        event.preventDefault()
        event.stopPropagation()
        // 关闭对应的标签页
        tabStore.closeTab(index)
      }
    }
    
    return {
      userStore,
      tabStore,
      isLoginPanelVisible,
      showLoginPanel,
      closeLoginPanel,
      navigateToProfile,
      handleLogout,
      handleTabClick,
      handleTabMouseDown
    }
  }
})
</script>

<style scoped>
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  height: 45px;
  padding: 0;
  background-color: #242424;
  color: #a0a0a0;
  position: relative;
}

/* 标签容器样式 */
.tab-container {
  display: flex;
  flex: 1;
  height: 100%;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: thin;
  align-items: center;
}

.tab-container::-webkit-scrollbar {
  height: 3px;
}

.tab-container::-webkit-scrollbar-thumb {
  background-color: #333333;
}

.tab-item {
  display: flex;
  align-items: center;
  padding: 0 15px;
  height: 100%;
  min-width: 80px;
  max-width: 240px;
  background-color: #1a1a1a;
  color: #a0a0a0;
  cursor: pointer;
  position: relative;
}

/* 终端标签页特别样式 */
.tab-item[data-tab-type="terminal"] {
  padding: 0 15px;
  max-width: 220px;
}

.tab-item:hover {
  background-color: #1e1e1e;
}

.tab-item.active {
  background-color: #121212;
  color: #e0e0e0;
}

.tab-title {
  flex: 1;
  margin-left: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

/* 修改终端标签页样式，避免在没有图标的情况下标题贴着边缘 */
.tab-item[data-tab-type="terminal"] .tab-title {
  font-size: 12px;
  margin-left: 0; /* 移除左侧空间，因为已经没有图标 */
}

.tab-close {
  background: none;
  border: none;
  width: 28px;
  height: 28px;
  padding: 0;
  margin-left: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  opacity: 0;
  visibility: hidden;
  cursor: pointer;
  transition: opacity 0.2s ease, visibility 0.2s ease, background-color 0.2s ease;
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
}

.tab-item:hover .tab-close {
  opacity: 0.9;
  visibility: visible;
  background-color: #121212;
  box-shadow: 0 0 0 3px #121212;
}

.tab-close:hover {
  background-color: #121212;
  opacity: 1;
  box-shadow: 0 0 0 4px #121212;
}

/* 头部操作区域 */
.header-actions {
  display: flex;
  gap: 10px;
  margin-right: 8px;
  background-color: #242424;
  align-items: center;
  height: 100%;
}

.btn-icon {
  background: none;
  border: none;
  color: #a0a0a0;
  font-size: 18px;
  cursor: pointer;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.btn-icon svg {
  width: 24px;
  height: 24px;
}

.btn-icon svg path {
  transition: fill 0.2s ease;
}

.btn-icon:hover {
  background-color: #333;
}

.btn-icon:hover svg path {
  fill: #ffffff;
}

/* 登录按钮 */
.login-btn {
  background-color: #333;
  color: #a0a0a0;
  padding: 0 12px;
  border-radius: 4px;
  font-size: 14px;
  width: auto;
  transition: all 0.2s ease;
}

.login-btn:hover {
  background-color: #444;
  color: #ffffff;
}

/* 用户菜单 */
.user-menu-container {
  position: relative;
}

.user-btn {
  border-radius: 50%;
  overflow: hidden;
}

.user-dropdown {
  position: absolute;
  top: 45px;
  right: 0;
  background-color: #242424;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  width: 150px;
  z-index: 1000;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease;
}

.user-menu-container:hover .user-dropdown {
  opacity: 1;
  visibility: visible;
}

.user-dropdown-item {
  display: flex;
  align-items: center;
  padding: 10px 15px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  color: #a0a0a0;
}

.user-dropdown-item:hover {
  background-color: #333;
  color: #ffffff;
}

.user-dropdown-item:hover svg path {
  fill: #ffffff;
}

.user-dropdown-item svg {
  margin-right: 10px;
}

.user-dropdown-item span {
  font-size: 14px;
}

/* 登录面板 */
.login-panel-container {
  position: absolute;
  top: 45px;
  left: 40px;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  background: radial-gradient(circle at center, 
    #161616 0%, 
    #161616 3%, 
    #151515 7%, 
    #151515 10%, 
    #141414 14%, 
    #141414 18%, 
    #131313 22%, 
    #131313 26%, 
    #121212 30%, 
    #121212 34%, 
    #111111 38%, 
    #111111 42%, 
    #101010 46%, 
    #101010 50%, 
    #0f0f0f 54%, 
    #0f0f0f 58%, 
    #0e0e0e 62%, 
    #0e0e0e 66%, 
    #0d0d0d 70%, 
    #0d0d0d 74%, 
    #0c0c0c 78%, 
    #0c0c0c 82%, 
    #0b0b0b 86%, 
    #0b0b0b 90%, 
    #0a0a0a 94%,
    #0a0a0a 100%
  );
}
</style> 