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

      <!-- 添加终端背景层，仅在终端界面显示 -->
      <div v-if="isTerminalRoute && terminalHasBackground" class="terminal-background" />

      <main class="content">
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

    // 监听终端标题变化
    window.addEventListener('terminal:title-change', event => {
      terminalTitle.value = event.detail;
    });

    // 监听会话变化
    window.addEventListener('terminal:session-change', event => {
      if (event.detail && event.detail.sessionId) {
        activeSessionId.value = event.detail.sessionId;
        log.debug(`当前活动会话ID已更新: ${activeSessionId.value}`);
      }
    });

    // 监听SSH会话创建
    window.addEventListener('ssh:session-created', event => {
      // 更新最新的SSH会话ID
      if (event.detail && event.detail.sessionId) {
        // 可以保留这个SSH ID以便于工具栏显示网络延迟信息
        log.debug(`SSH会话已创建: ${event.detail.sessionId}`);
      }
    });

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
    watch(
      () => route.path,
      (newPath, oldPath) => {
        if (newPath.startsWith('/terminal') && !oldPath.startsWith('/terminal')) {
          // 切换到终端路由，触发终端刷新
          nextTick(() => {
            if (terminalComponent.value) {
              // 获取当前会话ID
              const currentId = getCurrentSessionId();

              if (currentId) {
                // 路由切换到终端

                // 检查终端是否已经存在，如果存在则不设置isNewCreation
                const terminalStore = useTerminalStore();
                const isSessionCreating = terminalStore.isSessionCreating(currentId);
                const hasExistingTerminal = terminalStore.hasTerminal(currentId);
                const hasTerminalSession = terminalStore.hasTerminalSession(currentId);

                // 只有在会话不存在且未在创建中时才标记为新创建
                const isNewCreation =
                  !hasExistingTerminal && !hasTerminalSession && !isSessionCreating;

                // 优化：只在新创建终端时记录详细状态，减少重复日志
                if (isNewCreation) {
                  // 新建终端
                }

                // 直接处理终端初始化，避免重复的事件触发
                try {
                  const terminalStore = useTerminalStore();

                  if (isNewCreation) {
                    // 新创建的终端，需要初始化
                    // 准备初始化新终端

                    // 等待DOM更新后再初始化
                    nextTick(async () => {
                      const container = document.querySelector(`#terminal-container-${currentId}`);
                      if (container) {
                        await terminalStore.initializeTerminal(currentId, container);
                      }
                    });
                  } else {
                    // 已存在的终端，只需聚焦
                    if (terminalStore.hasTerminal(currentId)) {
                      // 聚焦已存在的终端
                      terminalStore.focusTerminal(currentId);
                    }
                  }
                } catch (error) {
                  log.error('[AppLayout] 处理终端初始化失败:', error);
                }
              }
            }
          });
        }

        // 如果是从终端路由切换到不同的路径，不需要特殊处理
        // v-show已经处理了终端的显示/隐藏
        if (oldPath.startsWith('/terminal') && !newPath.startsWith('/terminal')) {
          log.debug('离开终端路由，隐藏终端');
          // 移除原来的terminal:deactivate事件
        }
      }
    );

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
          if (isTerminalRoute.value && activeSessionId.value) {
            log.debug(`当前活动终端ID: ${activeSessionId.value}，确保延迟更新可正常显示`);
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

      // 监听终端背景状态
      window.addEventListener('terminal-bg-status', event => {
        if (event.detail) {
          // 不要直接修改计算属性
          // terminalHasBackground.value = event.detail.enabled;
          // 应该修改终端商店中的状态
          const terminalStore = useTerminalStore();
          terminalStore.toggleBackgroundImage(event.detail.enabled);

          // 如果有完整的背景设置，更新CSS变量
          if (event.detail.bgSettings) {
            updateCssVariables(event.detail.bgSettings);
          } else {
            // 如果只有enabled状态，从localStorage读取完整设置
            try {
              const savedBgSettings = localStorage.getItem('easyssh_terminal_bg');
              if (savedBgSettings) {
                const bgSettings = JSON.parse(savedBgSettings);
                updateCssVariables(bgSettings);
              }
            } catch (error) {
              log.error('读取背景设置失败:', error);
            }
          }

          log.debug('终端背景状态已更新:', event.detail.enabled);
        }
      });

      // 初始化时直接读取终端背景设置
      try {
        const savedBgSettings = localStorage.getItem('easyssh_terminal_bg');
        if (savedBgSettings) {
          const bgSettings = JSON.parse(savedBgSettings);
          // 不要直接修改计算属性
          // terminalHasBackground.value = bgSettings.enabled;
          // 应该修改终端商店中的状态
          const terminalStore = useTerminalStore();
          terminalStore.toggleBackgroundImage(bgSettings.enabled);

          // 立即更新CSS变量
          updateCssVariables(bgSettings);

          log.debug('初始化时读取终端背景状态', { enabled: bgSettings.enabled });
        }
      } catch (error) {
        log.error('初始化读取终端背景设置失败:', error);
      }

      // 监听关闭监控面板和SFTP面板的事件
      const appContainer = document.querySelector('.app-container');
      if (appContainer) {
        appContainer.addEventListener('close-sftp-panel', () => {
          closeSftpPanel();
        });
      }

      // 监听来自各个终端工具栏的SFTP面板切换请求
      window.addEventListener('request-toggle-sftp-panel', event => {
        if (event.detail && event.detail.sessionId) {
          // 设置活动会话ID并切换SFTP面板
          activeSessionId.value = event.detail.sessionId;
          toggleSftpPanel();
        }
      });
    });

    // 更新CSS变量以供AppLayout使用
    const updateCssVariables = bgSettings => {
      if (bgSettings.enabled && bgSettings.url) {
        document.documentElement.style.setProperty('--terminal-bg-image', `url(${bgSettings.url})`);
        document.documentElement.style.setProperty(
          '--terminal-bg-opacity',
          bgSettings.opacity.toString()
        );

        // 设置背景尺寸
        let backgroundSize = 'cover';
        if (bgSettings.mode === 'contain') {
          backgroundSize = 'contain';
        } else if (bgSettings.mode === 'fill') {
          backgroundSize = '100% 100%';
        } else if (bgSettings.mode === 'none') {
          backgroundSize = 'auto';
        } else if (bgSettings.mode === 'repeat') {
          backgroundSize = 'auto';
        }
        document.documentElement.style.setProperty('--terminal-bg-size', backgroundSize);

        // 设置背景重复
        const backgroundRepeat = bgSettings.mode === 'repeat' ? 'repeat' : 'no-repeat';
        document.documentElement.style.setProperty('--terminal-bg-repeat', backgroundRepeat);

        // AppLayout CSS变量已更新
      } else {
        document.documentElement.style.removeProperty('--terminal-bg-image');
        document.documentElement.style.removeProperty('--terminal-bg-opacity');
        document.documentElement.style.removeProperty('--terminal-bg-size');
        document.documentElement.style.removeProperty('--terminal-bg-repeat');

        // AppLayout CSS变量已清除
      }
    };

    // 在组件卸载时移除监听器
    onUnmounted(() => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('resize', handleWindowResize);

      // 移除会话相关监听器
      window.removeEventListener('terminal:session-change', () => {});
      window.removeEventListener('terminal-bg-status', () => {});
      window.removeEventListener('ssh:session-created', () => {});
      window.removeEventListener('toggle-monitoring-panel', () => {});

      // 移除显示监控面板事件监听器
      window.removeEventListener('show-monitoring-panel', () => {});

      // 移除关闭面板事件监听器
      const appContainer = document.querySelector('.app-container');
      if (appContainer) {
        appContainer.removeEventListener('close-monitoring-panel', () => {});
        appContainer.removeEventListener('close-sftp-panel', () => {});
      }

      // 移除事件监听器
      window.removeEventListener('request-toggle-sftp-panel', () => {});
      window.removeEventListener('request-toggle-monitoring-panel', () => {});
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
        log.debug(`关闭SFTP面板，清理会话: ${activeSessionId.value}`);
        // 检查会话是否仍然存在
        if (
          sftpService.activeSftpSessions &&
          sftpService.activeSftpSessions.has(activeSessionId.value)
        ) {
          sftpService.closeSftpSession(activeSessionId.value).catch(error => {
            log.error(`关闭SFTP会话失败: ${error.message || '未知错误'}`, error);
          });
        } else {
          log.debug(`SFTP会话 ${activeSessionId.value} 已经关闭，跳过`);
        }
      }

      // 等待动画完成后再隐藏面板
      setTimeout(() => {
        showSftpPanel.value = false;
        isSftpPanelClosing.value = false;
        log.debug('关闭SFTP面板');
      }, 300); // 与动画持续时间一致
    };

    // 监听路由变化，关闭SFTP面板
    watch(
      () => route.path,
      (newPath, oldPath) => {
        // 只有在实际路由变化时关闭SFTP面板
        if (newPath !== oldPath && showSftpPanel.value) {
          log.debug('路由变化，关闭SFTP面板:', oldPath, '->', newPath);
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
}

.main-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.content {
  flex: 1;
  overflow-y: auto;
  background-color: var(--color-bg-page);
  border-top: none;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
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

/* 终端背景样式 */
.terminal-background {
  position: absolute;
  top: var(--layout-header-height); /* 使用应用头部高度令牌 */
  left: var(--layout-sidebar-width); /* 使用侧边栏宽度令牌 */
  right: 0;
  bottom: 0;
  z-index: -1; /* 确保在内容下方 */
  background-image: var(--terminal-bg-image, none);
  background-size: var(--terminal-bg-size, cover);
  background-position: center;
  background-repeat: var(--terminal-bg-repeat, no-repeat);
  opacity: var(--terminal-bg-opacity, 0.5);
  pointer-events: none; /* 确保点击事件可以穿透背景 */
}

@media (max-width: 768px) {
  .terminal-background {
    left: 0; /* 在移动设备上占满整个宽度 */
  }
}

@media (max-width: 768px) {
  .app-container {
    height: 100vh;
    min-height: 100vh;
    flex-direction: column;
  }

  .main-content {
    min-height: 0;
  }
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
