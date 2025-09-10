<template>
  <aside
    :class="[
      'sidebar',
      { 'sidebar--mobile': isMobile, 'sidebar--open': isMobile && isSidebarOpen }
    ]"
  >
    <!-- Logo -->
    <div class="logo rainbow-logo" @click="handleLogoClick">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <defs>
          <linearGradient id="rainbow-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ff0000">
              <animate
                attributeName="stop-color"
                values="#ff0000; #ff7f00; #ffff00; #00ff00; #0000ff; #4b0082; #8b00ff; #ff0000"
                dur="8s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="25%" stop-color="#ff7f00">
              <animate
                attributeName="stop-color"
                values="#ff7f00; #ffff00; #00ff00; #0000ff; #4b0082; #8b00ff; #ff0000; #ff7f00"
                dur="8s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="50%" stop-color="#00ff00">
              <animate
                attributeName="stop-color"
                values="#00ff00; #0000ff; #4b0082; #8b00ff; #ff0000; #ff7f00; #ffff00; #00ff00"
                dur="8s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="75%" stop-color="#0000ff">
              <animate
                attributeName="stop-color"
                values="#0000ff; #4b0082; #8b00ff; #ff0000; #ff7f00; #ffff00; #00ff00; #0000ff"
                dur="8s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="100%" stop-color="#8b00ff">
              <animate
                attributeName="stop-color"
                values="#8b00ff; #ff0000; #ff7f00; #ffff00; #00ff00; #0000ff; #4b0082; #8b00ff"
                dur="8s"
                repeatCount="indefinite"
              />
            </stop>
          </linearGradient>
        </defs>
        <path
          d="M20,19V7H4V19H20M20,3A2,2 0 0,1 22,5V19A2,2 0 0,1 20,21H4A2,2 0 0,1 2,19V5C2,3.89 2.9,3 4,3H20M13,17V15H18V17H13M9.58,13L5.57,9H8.4L11.7,12.3C12.09,12.69 12.09,13.33 11.7,13.72L8.42,17H5.59L9.58,13Z"
        />
      </svg>
    </div>

    <!-- 导航菜单 -->
    <nav class="nav-menu">
      <!-- 登录后才显示的图标 -->
      <div
        v-if="userStore.isLoggedIn"
        class="nav-item"
        :class="{ active: currentRoute === '/' }"
        data-tooltip="控制台"
        @click="handleNavigation('/')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
          <path
            fill="currentColor"
            d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M9 17H7V10H9V17M13 17H11V7H13V17M17 17H15V13H17V17Z"
          />
        </svg>
      </div>

      <!-- 脚本库图标 - 只在登录后显示 -->
      <div
        v-if="userStore.isLoggedIn"
        class="nav-item"
        :class="{ active: currentRoute === '/scripts' }"
        data-tooltip="脚本库"
        @click="handleNavigation('/scripts')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
          <path
            fill="currentColor"
            d="M13,9H18.5L13,3.5V9M6,2H14L20,8V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V4C4,2.89 4.89,2 6,2M6.12,15.5L9.86,19.24L11.28,17.83L8.95,15.5L11.28,13.17L9.86,11.76L6.12,15.5M17.28,15.5L13.54,11.76L12.12,13.17L14.45,15.5L12.12,17.83L13.54,19.24L17.28,15.5Z"
          />
        </svg>
      </div>
    </nav>

    <!-- 底部按钮组 -->
    <div class="bottom-buttons">
      <!-- GitHub 按钮 -->
      <div class="nav-item" data-tooltip="访问 GitHub 仓库" @click="openGitHub">
        <!-- GitHub 图标 -->
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
          <path
            fill="currentColor"
            d="M12,2A10,10 0 0,0 2,12C2,16.42 4.87,20.17 8.84,21.5C9.34,21.58 9.5,21.27 9.5,21C9.5,20.77 9.5,20.14 9.5,19.31C6.73,19.91 6.14,17.97 6.14,17.97C5.68,16.81 5.03,16.5 5.03,16.5C4.12,15.88 5.1,15.9 5.1,15.9C6.1,15.97 6.63,16.93 6.63,16.93C7.5,18.45 8.97,18 9.54,17.76C9.63,17.11 9.89,16.67 10.17,16.42C7.95,16.17 5.62,15.31 5.62,11.5C5.62,10.39 6,9.5 6.65,8.79C6.55,8.54 6.2,7.5 6.75,6.15C6.75,6.15 7.59,5.88 9.5,7.17C10.29,6.95 11.15,6.84 12,6.84C12.85,6.84 13.71,6.95 14.5,7.17C16.41,5.88 17.25,6.15 17.25,6.15C17.8,7.5 17.45,8.54 17.35,8.79C18,9.5 18.38,10.39 18.38,11.5C18.38,15.32 16.04,16.16 13.81,16.41C14.17,16.72 14.5,17.33 14.5,18.26C14.5,19.6 14.5,20.68 14.5,21C14.5,21.27 14.66,21.59 15.17,21.5C19.14,20.16 22,16.42 22,12A10,10 0 0,0 12,2Z"
          />
        </svg>
      </div>

      <!-- 主题切换按钮 -->
      <div
        class="nav-item"
        :data-tooltip="currentTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
        @click="toggleTheme"
      >
        <!-- 太阳图标 (浅色主题) -->
        <svg
          v-if="currentTheme === 'dark'"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="20"
          height="20"
        >
          <path
            fill="currentColor"
            d="M12,8A4,4 0 0,0 8,12A4,4 0 0,0 12,16A4,4 0 0,0 16,12A4,4 0 0,0 12,8M12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6A6,6 0 0,1 18,12A6,6 0 0,1 12,18M20,8.69V4H15.31L12,0.69L8.69,4H4V8.69L0.69,12L4,15.31V20H8.69L12,23.31L15.31,20H20V15.31L23.31,12L20,8.69Z"
          />
        </svg>
        <!-- 月亮图标 (深色主题) -->
        <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
          <path
            fill="currentColor"
            d="M17.75,4.09L15.22,6.03L16.13,9.09L13.5,7.28L10.87,9.09L11.78,6.03L9.25,4.09L12.44,4L13.5,1L14.56,4L17.75,4.09M21.25,11L19.61,12.25L20.2,14.23L18.5,13.06L16.8,14.23L17.39,12.25L15.75,11L17.81,10.95L18.5,9L19.19,10.95L21.25,11M18.97,15.95C19.8,15.87 20.69,17.05 20.16,17.8C19.84,18.25 19.5,18.67 19.08,19.07C15.17,23 8.84,23 4.94,19.07C1.03,15.17 1.03,8.83 4.94,4.93C5.34,4.53 5.76,4.17 6.21,3.85C6.96,3.32 8.14,4.21 8.06,5.04C7.79,7.9 8.75,10.87 10.95,13.06C13.14,15.26 16.1,16.22 18.97,15.95M17.33,17.97C14.5,17.81 11.7,16.64 9.53,14.5C7.36,12.31 6.2,9.5 6.04,6.68C3.23,9.82 3.34,14.4 6.35,17.41C9.37,20.43 14,20.54 17.33,17.97Z"
          />
        </svg>
      </div>
    </div>
  </aside>
</template>

<script>
import { defineComponent, computed, ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useUserStore } from '@/store/user';
import settingsService from '@/services/settings';

export default defineComponent({
  name: 'AppSidebar',
  props: {
    // 是否为移动端
    isMobile: {
      type: Boolean,
      default: false
    },
    // 侧边栏是否打开（移动端使用）
    isSidebarOpen: {
      type: Boolean,
      default: false
    }
  },
  emits: ['toggle-sidebar'],
  setup(props, { emit }) {
    const router = useRouter();
    const route = useRoute();
    const userStore = useUserStore();

    // 当前路由路径
    const currentRoute = computed(() => route.path);

    // 当前主题
    const currentTheme = ref('dark');

    // 初始化主题
    onMounted(() => {
      // 不重复初始化设置服务，直接读取当前主题
      const updateCurrentTheme = () => {
        if (!settingsService.isInitialized) {
          // 如果设置服务还未初始化，等待初始化完成
          setTimeout(updateCurrentTheme, 100);
          return;
        }

        const theme = settingsService.settings.ui.theme;
        if (theme === 'system') {
          currentTheme.value = window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
        } else {
          currentTheme.value = theme;
        }
      };

      updateCurrentTheme();

      // 监听主题变化事件
      window.addEventListener('theme-changed', event => {
        currentTheme.value = event.detail.actualTheme;
      });
    });

    // 关闭登录面板事件
    const closeLoginPanel = () => {
      const appHeader = document.querySelector('.app-header');
      if (appHeader) {
        const event = new CustomEvent('close-login-panel');
        appHeader.dispatchEvent(event);
      }
    };

    // 导航处理函数
    const handleNavigation = route => {
      closeLoginPanel(); // 在导航前先关闭登录面板

      router.push(route);
    };

    // 主题切换函数
    const toggleTheme = () => {
      // 获取当前设置的主题（不是显示的主题）
      const currentSettingTheme = settingsService.settings.ui.theme;
      let newTheme;

      // 根据当前设置的主题决定下一个主题
      if (currentSettingTheme === 'system') {
        // 如果当前是系统主题，切换到与当前显示相反的固定主题
        newTheme = currentTheme.value === 'dark' ? 'light' : 'dark';
      } else {
        // 如果当前是固定主题，切换到相反的固定主题
        newTheme = currentSettingTheme === 'dark' ? 'light' : 'dark';
      }

      // 更新主题设置
      settingsService.updateUISettings({ theme: newTheme });
    };

    // GitHub 链接跳转函数
    const openGitHub = () => {
      window.open('https://github.com/shan-hee/EasySSH', '_blank');
    };

    // Logo点击处理函数
    const handleLogoClick = () => {
      if (props.isMobile) {
        emit('toggle-sidebar');
      }
    };

    return {
      currentRoute,
      currentTheme,
      handleNavigation,
      toggleTheme,
      openGitHub,
      handleLogoClick,
      userStore
    };
  }
});
</script>

<style scoped>
.sidebar {
  width: var(--layout-sidebar-width); /* 使用侧边栏宽度设计令牌 */
  height: 100vh;
  background-color: var(--sidebar-bg);
  transition:
    width var(--theme-transition-duration) var(--theme-transition-timing),
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    border-color var(--theme-transition-duration) var(--theme-transition-timing);
  overflow: visible;
  border-right: 1px solid var(--sidebar-border);
  box-sizing: border-box;
  z-index: 10000;
}

.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
  width: var(--layout-sidebar-width); /* 使用侧边栏宽度设计令牌 */
  height: 54px;
  margin: 0;
  background-color: var(--sidebar-logo-bg);
  box-sizing: border-box;
  z-index: 1;
  border-right: 1px solid var(--sidebar-border);
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
  filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.7));
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
  color: var(--sidebar-nav-color);
  border-radius: 4px;
  width: var(--layout-sidebar-width); /* 使用侧边栏宽度设计令牌 */
  height: var(--layout-sidebar-width); /* 保持正方形 */
  position: relative;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast),
    border-color var(--transition-fast);
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
  transition: fill var(--transition-fast);
}

.nav-item:hover {
  background-color: var(--sidebar-nav-hover-bg);
  color: var(--sidebar-nav-hover-color);
}

.nav-item:hover svg path {
  fill: var(--sidebar-nav-hover-color);
}

.nav-item.active {
  color: var(--sidebar-nav-active-color);
  background-color: transparent;
  border-left: none;
}

.nav-item.active svg path {
  fill: var(--sidebar-nav-active-color);
}

.nav-item.active:hover {
  background-color: var(--sidebar-nav-hover-bg);
}

.nav-item.active:hover svg path {
  fill: var(--sidebar-nav-hover-color);
}

.nav-item .icon {
  font-size: 16px;
  color: var(--sidebar-nav-color);
}

.nav-item:hover::after {
  content: attr(data-tooltip);
  position: absolute;
  left: calc(100% + var(--tooltip-offset));
  top: 50%;
  transform: translateY(-50%);
  background-color: var(--tooltip-bg);
  color: var(--tooltip-color);
  padding: var(--tooltip-padding-vertical) var(--tooltip-padding-horizontal);
  border-radius: var(--tooltip-border-radius);
  font-family: var(--tooltip-font-family);
  font-size: var(--tooltip-font-size);
  font-weight: var(--tooltip-font-weight);
  line-height: var(--tooltip-line-height);
  white-space: nowrap;
  max-width: var(--tooltip-max-width);
  z-index: var(--z-tooltip);
  box-shadow: var(--tooltip-shadow);
  display: block;
  pointer-events: none;
  transition: var(--tooltip-transition);
}

.nav-item:hover::before {
  content: '';
  position: absolute;
  right: calc(-1 * var(--tooltip-offset));
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-top: var(--tooltip-arrow-size) solid transparent;
  border-bottom: var(--tooltip-arrow-size) solid transparent;
  border-right: var(--tooltip-arrow-size) solid var(--tooltip-arrow-color);
  z-index: calc(var(--z-tooltip) + 1);
  pointer-events: none;
}

/* 底部按钮组样式 */
.bottom-buttons {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 移动端适配样式 */
@media screen and (max-width: 768px) {
  .sidebar--mobile {
    position: fixed;
    left: 0;
    top: 0;
    width: 250px;
    height: 100vh;
    z-index: 20000;
    transform: translateX(-100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    overflow-y: auto;
    overflow-x: hidden;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
    border-right: none; /* 移除右边框 */
    -webkit-tap-highlight-color: transparent; /* 移除移动端点击高亮 */
  }

  .sidebar--mobile.sidebar--open {
    transform: translateX(0);
  }

  .sidebar--mobile .logo {
    position: absolute;
    top: 0;
    left: 0;
    width: var(--layout-sidebar-width); /* 使用侧边栏宽度设计令牌 */
    height: var(--layout-header-height); /* 使用应用头部高度设计令牌 */
    cursor: pointer;
    border-right: none; /* 移除右边框 */
    border-bottom: none;
    transition: background-color 0.2s ease;
    z-index: 1;
    -webkit-tap-highlight-color: transparent; /* 移除移动端点击高亮 */
    -webkit-touch-callout: none; /* 移除长按菜单 */
    -webkit-user-select: none; /* 移除文本选择 */
    user-select: none;
  }

  .sidebar--mobile .logo:hover {
    background-color: transparent; /* 移除hover背景色 */
  }

  .sidebar--mobile .logo:active {
    background-color: transparent; /* 移除active背景色 */
    transform: none; /* 移除缩放效果 */
  }

  .sidebar--mobile .nav-menu {
    width: 100%;
    padding: 0;
    margin-top: 45px; /* 为顶部logo留出空间 */
  }

  .sidebar--mobile .nav-item {
    width: 100%;
    height: 48px;
    margin: 2px 0;
    justify-content: flex-start;
    padding: 0 15px 0 50px; /* 左侧留出空间给图标 */
    border-radius: 0;
    position: relative;
    -webkit-tap-highlight-color: transparent; /* 移除移动端点击高亮 */
    -webkit-touch-callout: none; /* 移除长按菜单 */
    -webkit-user-select: none; /* 移除文本选择 */
    user-select: none;
  }

  .sidebar--mobile .nav-item svg {
    position: absolute;
    left: 10px; /* 20px图标宽度的一半，使图标中心在20px位置，与logo中心对齐 */
    top: 50%;
    transform: translateY(-50%);
  }

  .sidebar--mobile .nav-item::after {
    content: attr(data-tooltip);
    position: absolute;
    left: 50px; /* 与padding-left保持一致 */
    top: 50%;
    transform: translateY(-50%);
    background: none;
    color: var(--sidebar-nav-color);
    padding: 0;
    border-radius: 0;
    font-family: inherit;
    font-size: 14px;
    font-weight: normal;
    line-height: normal;
    white-space: nowrap;
    max-width: none;
    z-index: auto;
    box-shadow: none;
    display: block;
    pointer-events: auto;
    transition: none;
  }

  .sidebar--mobile .nav-item::before {
    display: none;
  }

  .sidebar--mobile .nav-item:hover {
    background-color: transparent; /* 移除hover背景色 */
  }

  .sidebar--mobile .nav-item:active {
    background-color: transparent; /* 移除active背景色 */
    transform: none; /* 移除缩放效果 */
  }

  .sidebar--mobile .nav-item:hover::after {
    color: var(--sidebar-nav-hover-color);
  }

  .sidebar--mobile .nav-item.active::after {
    color: var(--sidebar-nav-active-color);
  }

  .sidebar--mobile .bottom-buttons {
    position: relative;
    margin-top: auto;
    padding: 20px 0;
  }
}
</style>
