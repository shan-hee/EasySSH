<template>
  <div class="tab-adder">
    <div
      class="tab-adder-dropdown-trigger"
      @click="addConnectionTab"
    >
      <div class="tab-adder-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="20"
          height="20"
        >
          <path
            fill="currentColor"
            d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"
          />
        </svg>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref } from 'vue';
import { useTabStore } from '@/store/tab';

export default defineComponent({
  name: 'TabAdder',
  setup() {
    const tabStore = useTabStore();
    const showPopover = ref(false);

    // 关闭登录面板事件
    const closeLoginPanel = () => {
      const appHeader = document.querySelector('.app-header');
      if (appHeader) {
        const event = new CustomEvent('close-login-panel');
        appHeader.dispatchEvent(event);
      }
    };

    // 添加连接标签
    const addConnectionTab = () => {
      closeLoginPanel();
      tabStore.addNewConnection();
      showPopover.value = false;
    };

    // 添加终端标签
    const addTerminalTab = () => {
      closeLoginPanel();
      const tabIndex = tabStore.addTerminal();
      console.log('添加了新的终端标签页，索引:', tabIndex);
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

    return {
      addConnectionTab,
      addTerminalTab,
      addSftpTab,
      addSettingsTab
    };
  }
});
</script>

<style scoped>
.tab-adder {
  position: relative;
  margin-left: 8px;
  z-index: 50;
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
