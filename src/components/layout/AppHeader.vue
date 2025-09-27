<template>
  <header class="app-header">
    <!-- 移动端Logo -->
    <div v-if="isMobile" class="mobile-logo-container">
      <logo :size="24" :clickable="true" :width="40" :height="45" @click="handleMobileLogoClick" />
    </div>

    <!-- 标签页容器 -->
    <div class="tab-container">
      <div
        v-for="(tab, index) in tabStore.tabs"
        :key="index"
        class="tab-item"
        :class="{ active: tabStore.activeTabIndex === index }"
        :data-tab-type="tab.type"
        @click="handleTabClick(index)"
        @mousedown="handleTabMouseDown($event, index)"
      >
        <svg
          v-if="tab.type === 'newConnection'"
          class="ruyi-icon ruyi-icon-ot-connect-link"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 16 16"
        >
          <g fill="currentColor">
            <path
              d="M1.799.749a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 00-1-1h-4Zm4 1h-4v4h4v-4Zm4.402 7.502a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 00-1-1h-4Zm4 1h-4v4h4v-4Z"
              fill-rule="evenodd"
              clip-rule="evenodd"
            />
            <path
              d="M3.799 8.749a.5.5 0 100-1 .5.5 0 000 1Zm.5 1.5a.5.5 0 11-1 0 .5.5 0 011 0Zm-.5 2.502a.5.5 0 100-1 .5.5 0 000 1Zm2.402-.5a.5.5 0 11-1 0 .5.5 0 011 0Zm1.5.5a.5.5 0 100-1 .5.5 0 000 1Z"
            />
          </g>
        </svg>
        <svg
          v-else-if="tab.type === 'sftp'"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
        >
          <path
            fill="currentColor"
            d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"
          />
        </svg>
        <svg
          v-else-if="tab.type === 'settings'"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
        >
          <path
            fill="currentColor"
            d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"
          />
        </svg>
        <span class="tab-title">{{ tab.title }}</span>
        <button class="tab-close" @click.stop="tabStore.closeTab(index)">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
            <path
              fill="currentColor"
              d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"
            />
          </svg>
        </button>
      </div>

      <!-- 添加标签按钮 -->
      <tab-adder />
    </div>

    <!-- 用户操作区 -->
    <div class="header-actions">
      <!-- 未登录时显示登录按钮 -->
      <button v-if="!userStore.isLoggedIn" class="btn-icon login-btn" @click="showLoginPanel">
        登录
      </button>

      <!-- 登录后显示用户图标和下拉菜单 -->
      <div
        v-else
        class="user-menu-container"
        @mouseenter="isUserMenuVisible = true"
        @mouseleave="isUserMenuVisible = false"
      >
        <button class="btn-icon user-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
            <path
              fill="currentColor"
              d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"
            />
          </svg>
        </button>

        <!-- 用户下拉菜单 -->
        <div class="user-dropdown" :class="{ show: isUserMenuVisible }">
          <div class="user-dropdown-item" @click="showUserSettings">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="currentColor"
                d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"
              />
            </svg>
            <span>设置</span>
          </div>

          <div class="user-dropdown-item" @click="handleLogout">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="currentColor"
                d="M16,17V14H9V10H16V7L21,12L16,17M14,2A2,2 0 0,1 16,4V6H14V4H5V20H14V18H16V20A2,2 0 0,1 14,22H5A2,2 0 0,1 3,20V4A2,2 0 0,1 5,2H14Z"
              />
            </svg>
            <span>登出</span>
          </div>
        </div>
      </div>
    </div>
  </header>

  <!-- 登录面板 -->
  <div v-if="isLoginPanelVisible" class="login-panel-container">
    <login-panel @login-success="closeLoginPanel" />
  </div>

  <!-- 用户设置弹窗 -->
  <user-settings-modal
    v-if="isUserSettingsVisible"
    :visible="isUserSettingsVisible"
    @update:visible="isUserSettingsVisible = $event"
    @close="closeUserSettings"
  />
</template>

<script>
import { defineComponent, ref, watch, onMounted, onUnmounted } from 'vue';
import { useUserStore } from '@/store/user';
import { useTabStore } from '@/store/tab';
import { useTerminalStore } from '@/store/terminal';
import LoginPanel from '@/components/auth/LoginPanel.vue';
import TabAdder from '@/components/layout/TabAdder.vue';
import Logo from '@/components/common/Logo.vue';
import UserSettingsModal from '@/components/user/UserSettingsModal.vue';
import { ElMessage } from 'element-plus';
import log from '@/services/log';

export default defineComponent({
  name: 'AppHeader',
  components: {
    LoginPanel,
    TabAdder,
    Logo,
    UserSettingsModal
  },
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
    const userStore = useUserStore();
    const tabStore = useTabStore();
    const isLoginPanelVisible = ref(false);
    const isUserSettingsVisible = ref(false);
    const isUserMenuVisible = ref(false);

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

      // 监听登录成功清空页签事件
      window.addEventListener('auth:login-success-clear-tabs', handleLoginSuccessClearTabs);

      // 监听退出登录清空页签事件
      window.addEventListener('auth:logout-clear-tabs', handleLogoutClearTabs);

      // 监听打开用户设置事件
      window.addEventListener('auth:open-user-settings', handleOpenUserSettings);
      window.addEventListener('open-user-settings', handleOpenUserSettings);
    });

    // 添加对标签状态的监听（仅开发环境打印，且不在初始化时触发）
    const VERBOSE_TAB_DEBUG = false;

    watch(
      () => tabStore.tabs,
      newTabs => {
        if (VERBOSE_TAB_DEBUG) {
          log.debug('标签数组已更新', { count: newTabs.length });
        }
      },
      { deep: true, immediate: false }
    );

    // 登录面板控制
    const showLoginPanel = () => {
      // 只显示登录面板，不再切换其显示状态
      isLoginPanelVisible.value = true;
    };

    const closeLoginPanel = () => {
      isLoginPanelVisible.value = false;
    };

    // 处理登录成功清空页签事件
    const handleLoginSuccessClearTabs = () => {
      log.info('登录成功，开始清空所有页签');

      // 调用tabStore的resetState方法清空所有页签
      tabStore.resetState();

      // 关闭登录面板
      closeLoginPanel();

      log.info('登录成功后页签清空完成');
    };

    // 处理退出登录清空页签事件
    const handleLogoutClearTabs = () => {
      log.info('退出登录，开始清空所有页签');

      // 调用tabStore的resetState方法清空所有页签
      tabStore.resetState();

      log.info('退出登录后页签清空完成');
    };

    // 显示用户设置弹窗
    const showUserSettings = () => {
      // 隐藏用户菜单
      isUserMenuVisible.value = false;
      // 显示用户设置弹窗
      isUserSettingsVisible.value = true;
    };

    // 处理打开用户设置事件
    const handleOpenUserSettings = event => {
      // 显示用户设置弹窗
      isUserSettingsVisible.value = true;
      // 通过全局事件通知UserSettingsModal设置默认激活的标签页
      if (event?.detail?.activeTab) {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('user-settings-set-active-tab', {
              detail: { activeTab: event.detail.activeTab }
            })
          );
        }, 100);
      }
    };

    // 关闭用户设置弹窗
    const closeUserSettings = () => {
      isUserSettingsVisible.value = false;
    };

    // 登出处理
    const handleLogout = () => {
      // 隐藏用户菜单
      isUserMenuVisible.value = false;

      // 调用store的登出方法
      userStore.logout();

      // 显示登出成功消息
      ElMessage({
        message: '已安全退出登录',
        type: 'success',
        offset: 3,
        zIndex: 9999
      });

      // 显示登录面板
      showLoginPanel();
    };

    // 处理标签页点击
    const handleTabClick = index => {
      // 先关闭登录面板
      closeLoginPanel();
      // 然后切换到点击的标签页
      tabStore.switchTab(index);
    };

    // 处理标签页鼠标按下事件
    const handleTabMouseDown = (event, index) => {
      // 检测是否是鼠标中键点击（button值为1表示鼠标中键）
      if (event.button === 1) {
        // 阻止默认行为和事件冒泡
        event.preventDefault();
        event.stopPropagation();

        // 优先 blur 终端，避免 WebGL 插件在销毁后收到 focus 重绘
        try {
          const closingTab = tabStore.tabs[index];
          if (closingTab && closingTab.type === 'terminal') {
            const terminalStore = useTerminalStore();
            const activeId = closingTab?.data?.connectionId;
            const term = activeId ? terminalStore.getTerminal(activeId) : null;
            if (term) {
              try {
                term.blur && term.blur();
              } catch (_) {
                void 0;
              }
              try {
                term.terminal && term.terminal.blur && term.terminal.blur();
              } catch (_) {
                void 0;
              }
              try {
                const el =
                  term.terminal?.element ||
                  document.querySelector(`.xterm[data-terminal-id="${activeId}"]`);
                el && typeof el.blur === 'function' && el.blur();
              } catch (_) {
                void 0;
              }
            }
            // 也尝试 blur 当前激活元素
            try {
              document.activeElement &&
                document.activeElement.blur &&
                document.activeElement.blur();
            } catch (_) {
              void 0;
            }
          }
        } catch (_) {
          void 0;
        }

        // 下一个宏任务再关闭，给 blur / 插件销毁留时序
        setTimeout(() => tabStore.closeTab(index), 0);
      }
    };

    // 移动端Logo点击处理函数
    const handleMobileLogoClick = () => {
      emit('toggle-sidebar');
    };

    // 组件卸载时清理事件监听器
    onUnmounted(() => {
      window.removeEventListener('auth:login-success-clear-tabs', handleLoginSuccessClearTabs);
      window.removeEventListener('auth:logout-clear-tabs', handleLogoutClearTabs);
      window.removeEventListener('auth:open-user-settings', handleOpenUserSettings);
      window.removeEventListener('open-user-settings', handleOpenUserSettings);
    });

    return {
      userStore,
      tabStore,
      isLoginPanelVisible,
      isUserSettingsVisible,
      isUserMenuVisible,
      showLoginPanel,
      closeLoginPanel,
      showUserSettings,
      closeUserSettings,
      handleLogout,
      handleTabClick,
      handleTabMouseDown,
      handleLoginSuccessClearTabs,
      handleLogoutClearTabs,
      handleOpenUserSettings,
      handleMobileLogoClick
    };
  }
});
</script>

<style scoped>
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  height: var(--layout-header-height); /* 使用应用头部高度令牌 */
  padding: 0;
  background-color: var(--header-bg);
  color: var(--header-color);
  position: relative;
}

/* 顶部栏不再绘制分割线，统一由主内容容器负责 */

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
  background-color: var(--header-scrollbar-thumb);
}

.tab-item {
  display: flex;
  align-items: center;
  padding: 0 15px;
  height: 100%;
  min-width: 80px;
  max-width: 240px;
  background-color: var(--header-tab-bg);
  color: var(--header-tab-color);
  cursor: pointer;
  position: relative;
}

/* 终端标签页特别样式 */
.tab-item[data-tab-type='terminal'] {
  padding: 0 15px;
  max-width: 220px;
}

.tab-item:hover {
  background-color: var(--header-tab-hover-bg);
}

.tab-item.active {
  background-color: var(--header-tab-active-bg);
  color: var(--header-tab-active-color);
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
.tab-item[data-tab-type='terminal'] .tab-title {
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
  transition:
    opacity var(--theme-transition-duration) var(--theme-transition-timing),
    visibility var(--theme-transition-duration) var(--theme-transition-timing),
    background-color var(--theme-transition-duration) var(--theme-transition-timing);
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  color: var(--color-text-secondary);
}

.tab-item:hover .tab-close {
  opacity: 0.9;
  visibility: visible;
  background-color: var(--header-tab-active-bg);
  box-shadow: 0 0 0 3px var(--header-tab-active-bg);
}

.tab-close:hover {
  background-color: var(--header-tab-active-bg);
  opacity: 1;
  box-shadow: 0 0 0 4px var(--header-tab-active-bg);
}

/* 头部操作区域 */
.header-actions {
  display: flex;
  gap: 10px;
  margin-right: 8px;
  background-color: var(--header-bg);
  align-items: center;
  height: 100%;
}

.btn-icon {
  background: none;
  border: none;
  color: var(--header-color);
  font-size: 18px;
  cursor: pointer;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition:
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    color var(--theme-transition-duration) var(--theme-transition-timing);
}

.btn-icon svg {
  width: 24px;
  height: 24px;
}

.btn-icon svg path {
  transition: fill var(--theme-transition-fast) var(--theme-transition-timing);
}

.btn-icon:hover {
  background-color: var(--header-btn-hover-bg);
}

.btn-icon:hover svg path {
  fill: var(--header-btn-hover-color);
}

/* 登录按钮 */
.login-btn {
  background-color: var(--header-btn-hover-bg);
  color: var(--header-color);
  padding: 0 12px;
  border-radius: 4px;
  font-size: 14px;
  width: auto;
  transition:
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    color var(--theme-transition-duration) var(--theme-transition-timing);
}

.login-btn:hover {
  background-color: var(--header-btn-hover-bg);
  color: var(--header-btn-hover-color);
}

/* 用户菜单 */
.user-menu-container {
  position: relative;
}

.user-btn {
  border-radius: 50%;
  overflow: hidden;
  color: var(--color-text-secondary);
}

.user-dropdown {
  position: absolute;
  top: var(--layout-header-height);
  right: 0;
  background-color: var(--color-bg-container);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  width: 150px;
  z-index: var(--z-dropdown);
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity var(--theme-transition-duration) var(--theme-transition-timing),
    visibility var(--theme-transition-duration) var(--theme-transition-timing),
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    border-color var(--theme-transition-duration) var(--theme-transition-timing),
    box-shadow var(--theme-transition-duration) var(--theme-transition-timing);
}

.user-menu-container:hover .user-dropdown,
.user-dropdown.show {
  opacity: 1;
  visibility: visible;
}

.user-dropdown-item {
  display: flex;
  align-items: center;
  padding: 10px 15px;
  cursor: pointer;
  transition:
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    color var(--theme-transition-duration) var(--theme-transition-timing);
  color: var(--color-text-primary);
}

.user-dropdown-item:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.user-dropdown-item:hover svg path {
  fill: currentColor;
}

.user-dropdown-item svg {
  margin-right: 10px;
}

.user-dropdown-item span {
  font-size: 14px;
}

/* 登录面板容器 */
.login-panel-container {
  position: absolute;
  top: var(--layout-header-height);
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: var(--z-overlay);
  background: radial-gradient(
    circle at center,
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

/* 登录面板容器背景 - 使用主题变量 */
.login-panel-container {
  background: var(--login-panel-container-bg);
}

/* 移动端优化：确保登录面板左右居中（去掉左侧偏移） */
@media screen and (max-width: 768px) {
  .login-panel-container {
    left: 0;
    right: 0;
  }
}

/* 移动端Logo样式 */
.mobile-logo-container {
  display: none;
}

@media screen and (max-width: 768px) {
  .mobile-logo-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--layout-sidebar-width); /* 使用侧边栏宽度设计令牌 */
    height: var(--layout-header-height); /* 使用应用头部高度令牌 */
    background-color: var(--header-bg); /* 使用与AppHeader相同的背景色 */
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent; /* 移除移动端点击高亮 */
    -webkit-touch-callout: none; /* 移除长按菜单 */
    -webkit-user-select: none; /* 移除文本选择 */
    user-select: none;
    cursor: pointer;
  }

  .mobile-logo-container:hover {
    background-color: var(--header-bg); /* 保持与正常状态相同的背景色 */
  }

  .mobile-logo-container:active {
    background-color: var(--header-bg); /* 保持与正常状态相同的背景色 */
    transform: none; /* 移除任何变换效果 */
  }

  .tab-item {
    min-width: 68px;
    padding: 0 10px;
  }

  .tab-title {
    font-size: var(--font-size-sm);
  }

  .tab-item.active .tab-close {
    opacity: 1;
    visibility: visible;
    position: static;
    margin-left: 6px;
    background: none;
    box-shadow: none;
    width: 24px;
    height: 24px;
    transform: none;
  }

  .tab-item.active .tab-close:hover {
    background: none;
    box-shadow: none;
  }

  .header-actions {
    gap: 6px;
    margin-right: var(--spacing-sm);
  }

  .tab-container {
    margin-left: 0;
  }
}

@media screen and (max-width: 480px) {
  .tab-container {
    padding-right: var(--spacing-sm);
  }

  .tab-item {
    min-width: 60px;
    padding: 0 8px;
  }

  .tab-title {
    font-size: var(--font-size-xs);
    margin-left: 4px;
  }

  .btn-icon {
    width: 36px;
    height: 36px;
  }
}
</style>
