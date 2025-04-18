<template>
  <div class="app-container">
    <AppSidebar />
    <div class="main-content">
      <AppHeader />
      <TerminalToolbar 
        v-if="isTerminalRoute" 
        @toggle-sftp-panel="toggleSftpPanel" 
        @toggle-monitoring-panel="toggleMonitoringPanel"
        :has-background="terminalHasBackground"
        :active-session-id="activeSessionId"
      />

      <!-- 添加终端背景层，仅在终端界面显示 -->
      <div v-if="isTerminalRoute && terminalHasBackground" class="terminal-background"></div>

      <main class="content" :class="{ 'with-terminal-tools': isTerminalRoute }">
        <router-view></router-view>
      </main>
    </div>

    <!-- 系统监控面板 -->
    <div v-if="showMonitoringPanel" class="monitoring-panel-container">
      <MonitoringPanel 
        @close="closeMonitoringPanel" 
        :serverId="monitorSessionId"
        :serverInfo="monitorServerInfo"
        :isInstalled="monitoringInstalled"
      />
    </div>
    
    <!-- SFTP文件管理器侧边栏 -->
    <SftpPanel
      v-if="showSftpPanel"
      :session-id="activeSessionId"
      :width="sftpPanelWidth"
      :is-closing="isSftpPanelClosing"
      v-model:width="sftpPanelWidth"
      @close="closeSftpPanel"
      @resize="handleSftpPanelResize"
    />
  </div>
</template>

<script>
import { defineComponent, computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import MonitoringPanel from '@/components/monitoring/MonitoringPanel.vue'
import TerminalToolbar from '@/components/terminal/TerminalToolbar.vue'
import SftpPanel from '@/components/sftp/SftpPanel.vue'
// 导入SFTP服务
import { sftpService } from '@/services/ssh'
// 导入会话存储
import { useSessionStore } from '@/store/session'

export default defineComponent({
  name: 'AppLayout',
  components: {
    AppSidebar,
    AppHeader,
    MonitoringPanel,
    TerminalToolbar,
    SftpPanel
  },
  setup() {
    const route = useRoute()
    const terminalTitle = ref('')
    const showMonitoringPanel = ref(false)
    const showSftpPanel = ref(false)
    const sftpPanelWidth = ref(600)
    const isSftpPanelClosing = ref(false)
    const activeSessionId = ref(null)
    const terminalHasBackground = ref(false)
    const monitorSessionId = ref(null)
    const monitorServerInfo = ref(null)
    const monitoringInstalled = ref(false)
    
    // 判断当前是否为终端路由
    const isTerminalRoute = computed(() => {
      return route.path.includes('/terminal');
    })
    
    // 终端操作方法
    const sendTerminalCommand = () => {
      // 使用事件总线发送事件给终端组件
      window.dispatchEvent(new CustomEvent('terminal:send-command'));
    }
    
    const clearTerminal = () => {
      window.dispatchEvent(new CustomEvent('terminal:clear'));
    }
    
    const disconnectTerminal = () => {
      window.dispatchEvent(new CustomEvent('terminal:disconnect'));
    }
    
    // 监听终端标题变化
    window.addEventListener('terminal:title-change', (event) => {
      terminalTitle.value = event.detail;
    });
    
    // 监听会话变化
    window.addEventListener('terminal:session-change', (event) => {
      if (event.detail && event.detail.sessionId) {
        activeSessionId.value = event.detail.sessionId;
        console.log(`当前活动会话ID已更新: ${activeSessionId.value}`);
      }
    });
    
    // 监听SSH会话创建
    window.addEventListener('ssh:session-created', (event) => {
      // 更新最新的SSH会话ID
      if (event.detail && event.detail.sessionId) {
        // 可以保留这个SSH ID以便于工具栏显示网络延迟信息
        console.log(`SSH会话已创建: ${event.detail.sessionId}`);
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
        console.error('获取当前会话ID失败:', error);
        // 如果有已知会话ID则返回它，否则返回null
        return activeSessionId.value || null;
      }
    };
    
    // 初始化
    onMounted(() => {
      // 获取并设置当前活动会话ID
      const currentId = getCurrentSessionId();
      if (currentId) {
        activeSessionId.value = currentId;
        console.log(`AppLayout初始化时设置activeSessionId: ${activeSessionId.value}`);
        
        // 如果当前有SSH会话，确保可以接收网络延迟更新
        try {
          // 查找使用中的网络连接
          if (isTerminalRoute.value && activeSessionId.value) {
            console.log(`当前活动终端ID: ${activeSessionId.value}，确保延迟更新可正常显示`);
          }
        } catch (error) {
          console.error('初始化SSH会话状态失败:', error);
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
        console.error('加载SFTP面板宽度失败:', error);
      }
      
      // 添加窗口大小变化监听器
      window.addEventListener('resize', handleWindowResize);
      
      // 监听终端背景状态
      window.addEventListener('terminal-bg-status', (event) => {
        if (event.detail) {
          terminalHasBackground.value = event.detail.enabled;
          console.log('终端背景状态已更新:', event.detail.enabled);
        }
      });
      
      // 初始化时直接读取终端背景设置
      try {
        const savedBgSettings = localStorage.getItem('easyssh_terminal_bg');
        if (savedBgSettings) {
          const bgSettings = JSON.parse(savedBgSettings);
          terminalHasBackground.value = bgSettings.enabled;
          console.log('初始化时读取终端背景状态:', bgSettings.enabled);
        }
      } catch (error) {
        console.error('初始化读取终端背景设置失败:', error);
      }
    });
    
    // 在组件卸载时移除监听器
    onUnmounted(() => {
      window.removeEventListener('resize', handleWindowResize);
      
      // 移除会话相关监听器
      window.removeEventListener('terminal:session-change', () => {});
      window.removeEventListener('terminal-bg-status', () => {});
      window.removeEventListener('ssh:session-created', () => {});
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
        console.error('保存SFTP面板宽度失败:', error);
      }
    };
    
    // 处理SFTP面板尺寸调整
    const handleSftpPanelResize = (width) => {
      saveSftpPanelWidth();
    };
    
    // 打开监控面板
    const toggleMonitoringPanel = (status) => {
      try {
        // 获取当前活动的会话ID和信息
        let currentSessionId = getCurrentSessionId();
        
        // 如果无法获取会话ID但状态中携带了sessionId，则使用它
        if (!currentSessionId && status && status.sessionId) {
          currentSessionId = status.sessionId;
          console.log(`使用从状态获取的会话ID: ${currentSessionId}`);
        }
        
        if (!currentSessionId) {
          ElMessage.error('没有活动的SSH会话，无法打开监控面板');
          return;
        }
        
        // 获取会话信息
        const sessionStore = useSessionStore();
        let session = sessionStore.getSession(currentSessionId);
        
        // 如果无法获取会话信息但有活动会话ID，尝试创建一个简单的会话对象
        if (!session && currentSessionId) {
          // 创建一个临时会话对象
          session = {
            id: currentSessionId,
            connection: {
              host: currentSessionId.split('@')[1] || currentSessionId,
              username: currentSessionId.split('@')[0] || 'root'
            }
          };
          console.log('创建临时会话对象:', session);
        }
        
        if (!session || !session.connection) {
          ElMessage.error('无法获取会话信息');
          return;
        }
        
        // 检查是否是一键安装请求
        if (status && status.install === true) {
          // 发送安装监控服务的命令到终端
          const installCommand = `curl -sSL ${window.location.origin}/api/monitor/install-script | sudo bash`;
          
          // 使用自定义事件将命令发送到当前活动的终端
          window.dispatchEvent(new CustomEvent('terminal:execute-command', { 
            detail: {
              command: installCommand,
              sessionId: currentSessionId
            }
          }));
          
          // 显示提示消息
          ElMessage.success('正在执行安装命令，请在终端中查看进度');
          return;
        }
        
        // 将会话信息传递给监控面板
        monitorSessionId.value = currentSessionId;
        monitorServerInfo.value = session.connection;
        
        // 根据状态决定是否预设安装状态
        monitoringInstalled.value = status && status.installed === true;
        
        // 显示监控面板
        showMonitoringPanel.value = true;
        
        console.log('打开监控面板', { 
          sessionId: currentSessionId, 
          installed: monitoringInstalled.value 
        });
      } catch (error) {
        console.error('打开监控面板失败:', error);
      }
    }
    
    // 关闭监控面板
    const closeMonitoringPanel = () => {
      showMonitoringPanel.value = false;
    }
    
    // 打开SFTP面板
    const toggleSftpPanel = (event) => {
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
          if (session.connection && (session.connection.name || (session.connection.username && session.connection.host))) {
            sessionName = session.connection.name || `${session.connection.username}@${session.connection.host}`;
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
        
        ElMessageBox.confirm(
          `是否要切换至(${sessionName})的SFTP文件管理器？`,
          '切换SFTP会话',
          {
            confirmButtonText: '是',
            cancelButtonText: '否',
            type: 'warning'
          }
        ).then(() => {
          // 用户确认切换
          activeSessionId.value = currentSessionId;
          // 触发SFTP面板刷新
          window.dispatchEvent(new CustomEvent('sftp:session-changed', { detail: currentSessionId }));
        }).catch(() => {
          // 用户取消操作，保持当前SFTP会话
        });
      }
    }
    
    // 关闭SFTP面板
    const closeSftpPanel = () => {
      isSftpPanelClosing.value = true;
      
      // 等待动画完成后再隐藏面板
      setTimeout(() => {
        showSftpPanel.value = false;
        isSftpPanelClosing.value = false;
        console.log('关闭SFTP面板');
      }, 300); // 与动画持续时间一致
    }
    
    // 监听路由变化，关闭SFTP面板
    watch(
      () => route.path,
      (newPath, oldPath) => {
        // 只有在实际路由变化时关闭SFTP面板
        if (newPath !== oldPath && showSftpPanel.value) {
          console.log('路由变化，关闭SFTP面板:', oldPath, '->', newPath);
          closeSftpPanel();
        }
      }
    );
    
    return {
      isTerminalRoute,
      terminalTitle,
      showMonitoringPanel,
      toggleMonitoringPanel,
      closeMonitoringPanel,
      showSftpPanel,
      toggleSftpPanel,
      closeSftpPanel,
      sftpPanelWidth,
      isSftpPanelClosing,
      activeSessionId,
      handleSftpPanelResize,
      terminalHasBackground,
      monitorSessionId,
      monitorServerInfo,
      monitoringInstalled
    }
  }
})
</script>

<style scoped>
.app-container {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background-color: #121212;
}

.main-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.content {
  flex: 1;
  overflow-y: auto;
  background-color: #121212;
  border-top: none;
}

.content.with-terminal-tools {
  height: calc(100% - 36px);
}

/* 终端工具栏，确保其位于适当层级 */
.terminal-toolbar {
  position: relative;
  z-index: 3;
  background-color: transparent;
}

/* 系统监控面板容器 */
.monitoring-panel-container {
  position: fixed;
  top: 40px;
  right: 0;
  bottom: 0;
  z-index: 1000;
  pointer-events: auto;
  overflow: visible;
}

/* 终端背景样式 */
.terminal-background {
  position: absolute;
  top: 40px; /* 留出顶部导航栏的空间 */
  left: 40px; /* 留出侧边栏的空间 */
  right: 0;
  bottom: 0;
  z-index: 1; /* 确保在内容下方 */
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
</style> 