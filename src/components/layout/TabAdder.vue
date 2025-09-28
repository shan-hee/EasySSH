<template>
  <div class="tab-adder">
    <div
      class="tab-adder-dropdown-trigger"
      @click="addConnectionTab"
      @mouseenter="handleTabAdderHover"
    >
      <div class="tab-adder-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
          <path fill="currentColor" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
        </svg>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, onMounted } from 'vue';
import log from '@/services/log';
import { useTabStore } from '@/store/tab';
import { useUserStore } from '@/store/user';

let newConnectionChunkPromise = null;

const preloadNewConnectionView = () => {
  if (!newConnectionChunkPromise) {
    newConnectionChunkPromise = import('@/views/connections/NewConnection.vue').catch(error => {
      log.debug('预加载连接配置页面失败', error);
      newConnectionChunkPromise = null;
      throw error;
    });
  }

  return newConnectionChunkPromise;
};

let connectionDataPrefetchPromise = null;

export default defineComponent({
  name: 'TabAdder',
  setup() {
    const tabStore = useTabStore();
    const userStore = useUserStore();
    const showPopover = ref(false);

    const ensureConnectionResources = () => {
      preloadNewConnectionView().catch(() => {});

      if (!userStore.isLoggedIn) {
        return;
      }

      if (!connectionDataPrefetchPromise) {
        connectionDataPrefetchPromise = userStore.ensureConnectionsData().catch(error => {
          log.debug('预加载连接相关数据失败', error);
          connectionDataPrefetchPromise = null;
        });
      }
    };

    const schedulePrefetch = () => {
      const run = () => ensureConnectionResources();

      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 1000 });
      } else {
        setTimeout(run, 300);
      }
    };

    const handleTabAdderHover = () => {
      ensureConnectionResources();
    };

    // 关闭登录面板事件
    const closeLoginPanel = () => {
      const appHeader = document.querySelector('.app-header');
      if (appHeader) {
        const event = new CustomEvent('close-login-panel');
        appHeader.dispatchEvent(event);
      }
    };

    // 添加连接标签
    const addConnectionTab = async () => {
      ensureConnectionResources();
      closeLoginPanel();

      tabStore.addNewConnection();
      showPopover.value = false;
    };

    // 添加终端标签
    const addTerminalTab = () => {
      closeLoginPanel();
      const tabIndex = tabStore.addTerminal();
      if (process.env.NODE_ENV === 'development') {
        log.debug('添加了新的终端标签页', { index: tabIndex });
      }
      showPopover.value = false;
    };

    // 添加SFTP标签
    const addSftpTab = () => {
      closeLoginPanel();
      tabStore.addSftpBrowser();
      showPopover.value = false;
    };

    // 添加设置标签
    const addSettingsTab = () => {
      closeLoginPanel();
      tabStore.addSettings();
      showPopover.value = false;
    };

    onMounted(() => {
      schedulePrefetch();
    });

    return {
      addConnectionTab,
      addTerminalTab,
      addSftpTab,
      addSettingsTab,
      handleTabAdderHover
    };
  }
});
</script>

<style scoped>
.tab-adder {
  position: relative;
  margin-left: 8px;
  z-index: var(--z-dropdown);
}

.tab-adder-dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  cursor: pointer;
  border-radius: 4px;
  transition:
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    color var(--theme-transition-duration) var(--theme-transition-timing);
}

.tab-adder-dropdown-trigger:hover {
  background-color: var(--color-hover-bg);
}

.tab-adder-icon svg {
  color: var(--color-text-secondary);
}

.tab-adder-dropdown-trigger:hover .tab-adder-icon svg {
  color: var(--color-primary);
}
</style>
