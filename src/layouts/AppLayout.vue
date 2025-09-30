<template>
  <div class="app-container">
    <!-- 移动端遮罩层 -->
    <div v-if="isMobile && isSidebarOpen" class="mobile-overlay" @click="toggleSidebar" />

    <app-sidebar
      :is-mobile="isMobile"
      :is-sidebar-open="isSidebarOpen"
      @toggle-sidebar="toggleSidebar"
    />
    <div class="main-content">
      <app-header
        :is-mobile="isMobile"
        :is-sidebar-open="isSidebarOpen"
        @toggle-sidebar="toggleSidebar"
      />

      <!-- 背景图改为在 .content 内部通过伪元素绘制，避免层级干扰与双重叠加 -->

      <main
        class="content"
        :class="{
          'terminal-bg-active': isTerminalRoute && terminalHasBackground,
          'terminal-surface-transparent': isTerminalRoute
        }"
      >
        <!-- 终端组件直接嵌入为常驻组件，使用v-show控制显示/隐藏 -->
        <keep-alive>
          <terminal
            v-show="isTerminalRoute"
            :id="getCurrentTerminalId()"
            key="global-terminal-component"
            ref="terminalComponent"
          />
        </keep-alive>

        <!-- 非终端路由仍然使用router-view渲染 -->
        <router-view v-if="!isTerminalRoute" />
      </main>
    </div>

    <!-- SFTP文件管理器侧边栏 -->
    <sftp-panel
      v-if="showSftpPanel"
      v-model:width="sftpPanelWidth"
      :session-id="activeSessionId"
      :width="sftpPanelWidth"
      :is-closing="isSftpPanelClosing"
      @close="closeSftpPanel"
      @resize="handleSftpPanelResize"
    />
  </div>
</template>

<script>
import { defineComponent, computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import AppSidebar from '@/components/layout/AppSidebar.vue';
import AppHeader from '@/components/layout/AppHeader.vue';
import { ElMessageBox, ElMessage } from 'element-plus';

import SftpPanel from '@/components/sftp/SftpPanel.vue';
// 导入Terminal组件
import Terminal from '@/views/terminal/Terminal.vue';
// 导入SFTP服务
import { sftpService } from '@/services/ssh/index';
// 导入会话存储
import { useSessionStore } from '@/store/session';
import { useTerminalStore } from '@/store/terminal';
// 导入日志服务
import log from '@/services/log';
import { applyTerminalBackgroundCss, clearTerminalBackgroundCss } from '@/utils/terminalBackgroundCss';
import settingsService from '@/services/settings';

export default defineComponent({
  name: 'AppLayout',
  components: {
    AppSidebar,
    AppHeader,
    SftpPanel,
    Terminal // 注册Terminal组件
  },
  setup() {
    const route = useRoute();
    // const router = useRouter(); // 未使用
    const terminalTitle = ref('');

    // 移动端检测和侧边栏状态管理
    const isMobile = ref(false);
    const isSidebarOpen = ref(false);

    // 检测是否为移动端
    const checkMobile = () => {
      isMobile.value = window.innerWidth <= 768;
      // 移动端默认隐藏侧边栏
      if (isMobile.value) {
        isSidebarOpen.value = false;
      }
    };

    // 切换侧边栏显示状态
    const toggleSidebar = () => {
      if (isMobile.value) {
        isSidebarOpen.value = !isSidebarOpen.value;
      }
    };

    // 监听窗口大小变化
    const handleResize = () => {
      checkMobile();
    };

    const showSftpPanel = ref(false);
    const sftpPanelWidth = ref(450);

    const isSftpPanelClosing = ref(false);
    const activeSessionId = ref(null);
    const terminalHasBackground = computed(() => {
      const terminalStore = useTerminalStore();
      return terminalStore.useBackgroundImage;
    });

    // 添加终端组件引用
    const terminalComponent = ref(null);

    // 判断当前是否为终端路由
    const isTerminalRoute = computed(() => {
      return route.path === '/terminal' || route.path.startsWith('/terminal/');
    });

    // 获取当前终端ID，优先使用路由参数
    const getCurrentTerminalId = () => {
      if (route.params.id) {
        return route.params.id;
      }

      const sessionStore = useSessionStore();
      return sessionStore.getActiveSession();
    };

    // 终端操作方法（如需在此组件中触发，可在使用处实现）

    // 规范事件处理器，便于移除监听避免泄漏
    const handleTerminalTitleChange = event => {
      terminalTitle.value = event.detail;
    };

    const handleTerminalSessionChange = event => {
      if (event?.detail?.sessionId) {
        activeSessionId.value = event.detail.sessionId;
        debugTerminalLog(`当前活动会话ID已更新: ${activeSessionId.value}`);
      }
    };

    const handleSSHSessionCreated = event => {
      if (event?.detail?.sessionId) {
        debugTerminalLog(`SSH会话已创建: ${event.detail.sessionId}`);
      }
    };

    // 背景状态变更
    const handleTerminalBgStatus = event => {
      if (!event?.detail) return;
      const terminalStore = useTerminalStore();
      terminalStore.toggleBackgroundImage(!!event.detail.enabled);
      if (event.detail.bgSettings) {
        updateCssVariables(event.detail.bgSettings);
      }
      debugTerminalLog('终端背景状态已更新:', event.detail.enabled);
    };

    // SFTP 面板相关事件
    const handleCloseSftpPanelEvent = () => closeSftpPanel();
    const handleRequestToggleSftpPanel = event => {
      if (event?.detail?.sessionId) {
        activeSessionId.value = event.detail.sessionId;
        toggleSftpPanel();
      }
    };

    // 获取当前活动的会话ID
    const getCurrentSessionId = () => {
      try {
        // 在终端路由中获取当前活动的SSH会话
        if (isTerminalRoute.value) {
          const sessionStore = useSessionStore();
          // 直接尝试获取活动会话ID
          const currentSessionId = sessionStore.getActiveSession();

          if (currentSessionId) {
            // 更新当前活动会话ID
            if (currentSessionId !== activeSessionId.value) {
              activeSessionId.value = currentSessionId;
            }
            return currentSessionId;
          } else if (activeSessionId.value) {
            // 如果sessionStore没有返回活动会话，但我们已有缓存的会话ID，则使用它
            return activeSessionId.value;
          }

          // 尝试从props或route参数中获取
          const routeId = route.params.id;
          if (routeId) {
            activeSessionId.value = routeId;
            return routeId;
          }
        }
        return null;
      } catch (error) {
        log.error('获取当前会话ID失败:', error);
        // 如果有已知会话ID则返回它，否则返回null
        return activeSessionId.value || null;
      }
    };

    // 监听路由变化，当切换到终端路由时触发刷新
    const VERBOSE_TERMINAL_LOG = false;
    const debugTerminalLog = VERBOSE_TERMINAL_LOG ? (...args) => log.debug(...args) : () => {};

    watch(
      () => route.path,
      (newPath, oldPath) => {
        if (newPath.startsWith('/terminal') && !oldPath.startsWith('/terminal')) {
          // 切换到终端路由，提前置位“连接中”状态，保证覆盖层尽快出现
          try {
            const preId = route.params.id || getCurrentSessionId();
            if (preId) {
              window.dispatchEvent(
                new CustomEvent('terminal:session-change', {
                  detail: { sessionId: preId, isTabSwitch: false, isNewSession: true }
                })
              );
            }
          } catch (_) {}

          // 然后再进行终端聚焦等后续流程（初始化交由 Terminal.vue 负责）
          nextTick(() => {
            if (terminalComponent.value) {
              // 获取当前会话ID
              const currentId = getCurrentSessionId();

              if (currentId) {
                try {
                  const terminalStore = useTerminalStore();
                  // 已存在的终端，只需聚焦；不存在则由 Terminal.vue 完成初始化
                  if (terminalStore.hasTerminal(currentId)) {
                    terminalStore.focusTerminal(currentId);
                  }
                } catch (error) {
                  log.error('[AppLayout] 处理终端聚焦失败:', error);
                }
              }
            }
          });
        }

        // 如果是从终端路由切换到不同的路径，不需要特殊处理
        // v-show已经处理了终端的显示/隐藏
        if (oldPath.startsWith('/terminal') && !newPath.startsWith('/terminal')) {
          if (VERBOSE_TERMINAL_LOG) {
            debugTerminalLog('离开终端路由，隐藏终端');
          }
          // 移除原来的terminal:deactivate事件
        }
      }
    );

    // 更新CSS变量以供AppLayout使用（提前定义，供事件处理与初始化调用）
    const updateCssVariables = bgSettings => {
      try {
        if (bgSettings && bgSettings.enabled && bgSettings.url) {
          applyTerminalBackgroundCss(bgSettings);
        } else {
          clearTerminalBackgroundCss();
        }
      } catch (_) {}
    };

    // 初始化
    onMounted(() => {
      // 初始化移动端检测
      checkMobile();
      window.addEventListener('resize', handleResize);

      // 获取并设置当前活动会话ID
      const currentId = getCurrentSessionId();
      if (currentId) {
        activeSessionId.value = currentId;
        // AppLayout初始化设置activeSessionId

        // 如果当前有SSH会话，确保可以接收网络延迟更新
        try {
          // 查找使用中的网络连接
          if (isTerminalRoute.value && activeSessionId.value && VERBOSE_TERMINAL_LOG) {
            debugTerminalLog(`当前活动终端ID: ${activeSessionId.value}，确保延迟更新可正常显示`);
          }
        } catch (error) {
          log.error('初始化SSH会话状态失败:', error);
        }
      }

      // 加载保存的SFTP面板宽度
      try {
        const savedWidth = localStorage.getItem('sftpPanelWidth');
        if (savedWidth) {
          const width = parseInt(savedWidth, 10);
          const maxWidth = window.innerWidth * 0.9;
          if (!isNaN(width) && width >= 300 && width <= maxWidth) {
            sftpPanelWidth.value = width;
          } else if (!isNaN(width) && width > maxWidth) {
            // 如果保存的宽度超过了当前最大值，则使用最大值
            sftpPanelWidth.value = maxWidth;
          }
        }
      } catch (error) {
        log.error('加载SFTP面板宽度失败:', error);
      }

      // 添加窗口大小变化监听器
      window.addEventListener('resize', handleWindowResize);

      // 绑定全局事件监听（具名处理器，便于卸载）
      window.addEventListener('terminal:title-change', handleTerminalTitleChange);
      window.addEventListener('terminal:session-change', handleTerminalSessionChange);
      window.addEventListener('ssh:session-created', handleSSHSessionCreated);
      window.addEventListener('terminal-bg-status', handleTerminalBgStatus);

      // 初始化时从设置服务快照读取一次背景设置
      try {
        const bg = settingsService.getTerminalBackground?.();
        if (bg && typeof bg === 'object') {
          const terminalStore = useTerminalStore();
          terminalStore.toggleBackgroundImage(!!bg.enabled);
          updateCssVariables(bg);
          debugTerminalLog('初始化时应用终端背景状态', { enabled: !!bg.enabled });
        }
      } catch (error) {
        log.error('初始化读取终端背景设置失败:', error);
      }

      // 监听关闭监控面板和SFTP面板的事件
      const appContainer = document.querySelector('.app-container');
      if (appContainer) {
        appContainer.addEventListener('close-sftp-panel', handleCloseSftpPanelEvent);
      }

      // 监听来自各个终端工具栏的SFTP面板切换请求
      window.addEventListener('request-toggle-sftp-panel', handleRequestToggleSftpPanel);
    });

    

    // 在组件卸载时移除监听器
    onUnmounted(() => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('resize', handleWindowResize);

      // 移除会话/标题/SSH相关监听器
      window.removeEventListener('terminal:title-change', handleTerminalTitleChange);
      window.removeEventListener('terminal:session-change', handleTerminalSessionChange);
      window.removeEventListener('ssh:session-created', handleSSHSessionCreated);
      window.removeEventListener('terminal-bg-status', handleTerminalBgStatus);

      // 移除关闭SFTP面板事件监听器
      const appContainer = document.querySelector('.app-container');
      if (appContainer) {
        appContainer.removeEventListener('close-sftp-panel', handleCloseSftpPanelEvent);
      }

      // 移除请求切换SFTP面板事件监听器
      window.removeEventListener('request-toggle-sftp-panel', handleRequestToggleSftpPanel);
    });

    // 处理窗口大小变化
    const handleWindowResize = () => {
      if (showSftpPanel.value) {
        const maxWidth = window.innerWidth * 0.95;
        // 如果当前宽度超过了新的最大值，则调整为最大值
        if (sftpPanelWidth.value > maxWidth) {
          sftpPanelWidth.value = maxWidth;

          // 保存更新后的宽度
          saveSftpPanelWidth();
        }
      }
    };

    // 保存SFTP面板宽度
    const saveSftpPanelWidth = () => {
      try {
        localStorage.setItem('sftpPanelWidth', sftpPanelWidth.value.toString());
      } catch (error) {
        log.error('保存SFTP面板宽度失败:', error);
      }
    };

    // 处理SFTP面板尺寸调整
    const handleSftpPanelResize = newWidth => {
      sftpPanelWidth.value = newWidth;
      // 保存到本地存储
      try {
        localStorage.setItem('sftpPanelWidth', newWidth.toString());
      } catch (e) {
        log.error('保存SFTP面板宽度失败:', e);
      }
    };

    // 打开SFTP面板
    const toggleSftpPanel = event => {
      // 阻止事件冒泡，避免触发全局点击处理器
      if (event) {
        event.stopPropagation();
      }

      // 获取当前活动的会话ID
      const currentSessionId = getCurrentSessionId();

      if (!currentSessionId) {
        ElMessage.error('没有活动的SSH会话，无法打开SFTP面板');
        return;
      }

      // 检查面板是否已经打开，只有未打开时才执行打开操作
      if (!showSftpPanel.value) {
        // 直接显示SFTP面板
        activeSessionId.value = currentSessionId;
        showSftpPanel.value = true;
      } else if (activeSessionId.value !== currentSessionId) {
        // 如果SFTP面板已打开且活动会话ID不同，询问是否切换
        const sessionStore = useSessionStore();
        const session = sessionStore.getSession(currentSessionId);

        // 获取会话名称，确保显示有效的信息
        let sessionName = '当前会话';
        if (session) {
          if (
            session.connection &&
            (session.connection.name || (session.connection.username && session.connection.host))
          ) {
            sessionName =
              session.connection.name ||
              `${session.connection.username}@${session.connection.host}`;
          } else if (session.username && session.host) {
            // 会话对象可能直接包含用户名和主机信息
            sessionName = `${session.username}@${session.host}`;
          } else if (session.title) {
            // 至少显示会话标题
            sessionName = session.title;
          } else {
            // 如果什么都没有，至少显示会话ID
            sessionName = currentSessionId;
          }
        }

        ElMessageBox.confirm(`是否要切换至(${sessionName})的SFTP文件管理器？`, '切换SFTP会话', {
          confirmButtonText: '是',
          cancelButtonText: '否',
          type: 'warning'
        })
          .then(() => {
            // 用户确认切换
            activeSessionId.value = currentSessionId;
            // 触发SFTP面板刷新
            window.dispatchEvent(
              new CustomEvent('sftp:session-changed', { detail: currentSessionId })
            );
          })
          .catch(() => {
            // 用户取消操作，保持当前SFTP会话
          });
      }
    };

    // 关闭SFTP面板
    const closeSftpPanel = () => {
      isSftpPanelClosing.value = true;

      // 在关闭面板前确保关闭SFTP会话
      if (activeSessionId.value) {
        debugTerminalLog(`关闭SFTP面板，清理会话: ${activeSessionId.value}`);
        // 检查会话是否仍然存在
        if (
          sftpService.activeSftpSessions &&
          sftpService.activeSftpSessions.has(activeSessionId.value)
        ) {
          sftpService.closeSftpSession(activeSessionId.value).catch(error => {
            log.error(`关闭SFTP会话失败: ${error.message || '未知错误'}`, error);
          });
        } else {
          debugTerminalLog(`SFTP会话 ${activeSessionId.value} 已经关闭，跳过`);
        }
      }

      // 等待动画完成后再隐藏面板
      setTimeout(() => {
        showSftpPanel.value = false;
        isSftpPanelClosing.value = false;
        debugTerminalLog('关闭SFTP面板');
      }, 300); // 与动画持续时间一致
    };

    // 监听路由变化，关闭SFTP面板
    watch(
      () => route.path,
      (newPath, oldPath) => {
        // 只有在实际路由变化时关闭SFTP面板
        if (newPath !== oldPath && showSftpPanel.value) {
          debugTerminalLog('路由变化，关闭SFTP面板:', oldPath, '->', newPath);
          closeSftpPanel();
        }
      }
    );

    return {
      isTerminalRoute,
      terminalTitle,

      // 移动端和侧边栏状态
      isMobile,
      isSidebarOpen,
      toggleSidebar,

      showSftpPanel,
      toggleSftpPanel,
      closeSftpPanel,
      sftpPanelWidth,

      isSftpPanelClosing,
      activeSessionId,
      handleSftpPanelResize,

      terminalHasBackground,

      getCurrentTerminalId,
      terminalComponent
    };
  }
});
</script>

<style scoped>
.app-container {
  display: flex;
  height: 100vh;
  min-height: 100vh;
  overflow: hidden;
  background-color: var(--color-bg-page);
  position: relative; /* 让贯穿分割线基于容器定位 */
}

/* 贯穿顶部到底部的分割线（无阴影），定位在侧边栏右侧 */
.app-container::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--layout-sidebar-width);
  width: var(--divider-width);
  background-color: var(--divider-color);
  transition: var(--divider-transition);
  pointer-events: none;
  z-index: var(--z-fixed);
}


.main-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  min-height: 0;
  /* 主内容无需再绘制分割线 */
  position: relative;
}

.content {
  flex: 1;
  overflow-y: auto;
  background-color: var(--color-bg-page);
  border-top: none;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
  position: relative; /* 参与堆叠，便于与背景层分层 */
  z-index: 1; /* 位于背景层之上 */
}

/* 系统监控面板容器 */
.monitoring-panel-container {
  position: fixed;
  top: var(--layout-header-height); /* 使用应用头部高度令牌 */
  right: 0;
  bottom: 0;
  z-index: var(--z-fixed);
  pointer-events: auto;
  overflow: visible;
}

/* 独立终端背景层已移除，改为在 .content 上通过 ::before 绘制，避免叠加与层级干扰 */

@media (max-width: 768px) {
  .app-container {
    height: 100vh;
    min-height: 100vh;
    flex-direction: column;
  }

  .main-content {
    min-height: 0;
  }
  /* 移动端侧边栏为覆盖式，隐藏分割线 */
  .app-container::before { content: none; }
}

/* 当启用终端背景时，使内容区域透明，露出底层背景图 */
.content.terminal-bg-active,
.content.terminal-surface-transparent {
  background-color: transparent;
}

/* 在内容容器内部绘制背景，避免与外部层级竞争 */
.content.terminal-bg-active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 0; /* 背景层，内容子元素天然在其上方绘制 */
  pointer-events: none;
  background-image: var(--terminal-bg-image, none);
  background-size: var(--terminal-bg-size, cover);
  background-position: center;
  background-repeat: var(--terminal-bg-repeat, no-repeat);
  opacity: var(--terminal-bg-opacity, 0.5);
}


/* 背景开启时，让终端容器自身变透明，避免覆盖伪元素背景 */
.content.terminal-bg-active :deep(.terminal-container),
.content.terminal-surface-transparent :deep(.terminal-container) {
  background-color: transparent !important;
}

/* 在使用背景图时，让终端区域内的主要容器背景透明，完全依赖底图与主题前景色 */
.content.terminal-bg-active .terminal-individual-toolbar,
.content.terminal-surface-transparent .terminal-individual-toolbar,
.content.terminal-bg-active .terminal-ai-combined-area,
.content.terminal-surface-transparent .terminal-ai-combined-area,
.content.terminal-bg-active .terminal-monitoring-panel,
.content.terminal-surface-transparent .terminal-monitoring-panel,
.content.terminal-bg-active .terminal-right-area,
.content.terminal-surface-transparent .terminal-right-area,
.content.terminal-bg-active .terminal-content-padding,
.content.terminal-surface-transparent .terminal-content-padding {
  background: transparent !important;
  background-color: transparent !important;
}

/* 监控面板边框在背景图模式下弱化，避免硬分割线影响观感 */
.content.terminal-bg-active .terminal-monitoring-panel,
.content.terminal-surface-transparent .terminal-monitoring-panel {
  border-right-color: transparent !important;
}

/* 移动端遮罩层样式 */
.mobile-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: var(--z-overlay);
  opacity: 0;
  animation: fadeIn 0.3s ease-in-out forwards;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
