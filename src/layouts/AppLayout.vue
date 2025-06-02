<template>
  <div class="app-container">
    <AppSidebar />
    <div class="main-content">
      <AppHeader />

      <!-- 添加终端背景层，仅在终端界面显示 -->
      <div v-if="isTerminalRoute && terminalHasBackground" class="terminal-background"></div>

      <main class="content">
        <!-- 终端组件直接嵌入为常驻组件，使用v-show控制显示/隐藏 -->
        <keep-alive>
          <Terminal 
            v-show="isTerminalRoute" 
            :id="getCurrentTerminalId()"
            key="global-terminal-component"
            ref="terminalComponent"
          />
        </keep-alive>
        
        <!-- 非终端路由仍然使用router-view渲染 -->
        <router-view v-if="!isTerminalRoute"></router-view>
      </main>
    </div>

    <!-- 系统监控面板 -->
    <div v-if="showMonitoringPanel" class="monitoring-panel-container">
      <MonitoringPanel 
        @close="closeMonitoringPanel" 
        :serverId="monitorSessionId"
        :serverInfo="monitorServerInfo"
        :isInstalled="monitoringInstalled"
        :width="monitoringPanelWidth"
        v-model:width="monitoringPanelWidth"
        @resize="handleMonitoringPanelResize"
        :session-id="monitorSessionId"
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
import { defineComponent, computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import MonitoringPanel from '@/components/monitoring/MonitoringPanel.vue'
import SftpPanel from '@/components/sftp/SftpPanel.vue'
// 导入Terminal组件
import Terminal from '@/views/terminal/Terminal.vue'
// 导入SFTP服务
import { sftpService } from '@/services/ssh/index'
// 导入会话存储
import { useSessionStore } from '@/store/session'
import { useTerminalStore } from '@/store/terminal'
// 导入日志服务
import log from '@/services/log'

export default defineComponent({
  name: 'AppLayout',
  components: {
    AppSidebar,
    AppHeader,
    MonitoringPanel,
    SftpPanel,
    Terminal // 注册Terminal组件
  },
  setup() {
    const route = useRoute()
    const router = useRouter()
    const terminalTitle = ref('')
    const showMonitoringPanel = ref(false)
    const showSftpPanel = ref(false)
    const sftpPanelWidth = ref(450)
    const monitoringPanelWidth = ref(450)
    const isSftpPanelClosing = ref(false)
    const activeSessionId = ref(null)
    const terminalHasBackground = computed(() => {
      const terminalStore = useTerminalStore()
      return terminalStore.useBackgroundImage
    })
    const monitorSessionId = ref(null)
    const monitorServerInfo = ref(null)
    const monitoringInstalled = ref(false)
    // 添加终端组件引用
    const terminalComponent = ref(null)
    
    // 判断当前是否为终端路由
    const isTerminalRoute = computed(() => {
      return route.path === '/terminal' || route.path.startsWith('/terminal/')
    })
    
    // 获取当前终端ID，优先使用路由参数
    const getCurrentTerminalId = () => {
      if (route.params.id) {
        return route.params.id
      }
      
      const sessionStore = useSessionStore()
      return sessionStore.getActiveSession()
    }
    
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
        log.debug(`当前活动会话ID已更新: ${activeSessionId.value}`);
      }
    });
    
    // 监听SSH会话创建
    window.addEventListener('ssh:session-created', (event) => {
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
    watch(() => route.path, (newPath, oldPath) => {
      if (newPath.startsWith('/terminal') && !oldPath.startsWith('/terminal')) {
        // 切换到终端路由，触发终端刷新
        nextTick(() => {
          if (terminalComponent.value) {
            // 获取当前会话ID
            const currentId = getCurrentSessionId();
            
            if (currentId) {
              log.debug('路由切换到终端，触发终端显示和刷新', currentId);
              
              // 检查终端是否已经存在，如果存在则不设置isNewCreation
              const terminalStore = useTerminalStore();
              const isSessionCreating = terminalStore.isSessionCreating(currentId);
              const hasExistingTerminal = terminalStore.hasTerminal(currentId);
              const hasTerminalSession = terminalStore.hasTerminalSession(currentId);
              
              // 只有在会话不存在且未在创建中时才标记为新创建
              const isNewCreation = !hasExistingTerminal && !hasTerminalSession && !isSessionCreating;
              
              log.debug(`终端状态检查: 终端存在=${hasExistingTerminal}, 会话存在=${hasTerminalSession}, 正在创建=${isSessionCreating}`);
              
              // 只使用一个事件触发终端初始化，避免多次触发导致创建多个SSH会话
              window.dispatchEvent(new CustomEvent('terminal:refresh-status', {
                detail: {
                  sessionId: currentId,
                  forceShow: true, // 添加强制显示标记
                  isNewCreation: isNewCreation // 仅在确认需要新创建时设为true
                }
              }));

              // 添加延迟聚焦逻辑，确保终端已经初始化完成
              setTimeout(() => {
                // 导入终端Store并聚焦终端
                import('../store/terminal').then(({ useTerminalStore }) => {
                  const terminalStore = useTerminalStore()
                  if (terminalStore.hasTerminal(currentId)) {
                    log.debug(`从其他页面切换到终端，聚焦终端: ${currentId}`)
                    terminalStore.focusTerminal(currentId)
                  } else {
                    log.debug(`终端 ${currentId} 尚未初始化，等待后再次尝试聚焦`)
                    // 如果终端还没初始化，再等待一段时间
                    setTimeout(() => {
                      if (terminalStore.hasTerminal(currentId)) {
                        log.debug(`延迟聚焦终端: ${currentId}`)
                        terminalStore.focusTerminal(currentId)
                      }
                    }, 500)
                  }
                }).catch(error => {
                  log.error('导入终端Store失败:', error)
                })
              }, 200)
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
    });
    
    // 初始化
    onMounted(() => {
      // 获取并设置当前活动会话ID
      const currentId = getCurrentSessionId();
      if (currentId) {
        activeSessionId.value = currentId;
        log.debug(`AppLayout初始化时设置activeSessionId: ${activeSessionId.value}`);
        
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
      
      // 加载保存的监控面板宽度
      try {
        const savedWidth = localStorage.getItem('monitoringPanelWidth');
        if (savedWidth) {
          const width = parseInt(savedWidth, 10);
          const maxWidth = window.innerWidth * 0.9;
          if (!isNaN(width) && width >= 300 && width <= maxWidth) {
            monitoringPanelWidth.value = width;
          } else if (!isNaN(width) && width > maxWidth) {
            // 如果保存的宽度超过了当前最大值，则使用最大值
            monitoringPanelWidth.value = maxWidth;
          }
        }
      } catch (error) {
        log.error('加载监控面板宽度失败:', error);
      }
      
      // 添加窗口大小变化监听器
      window.addEventListener('resize', handleWindowResize);
      
      // 监听终端背景状态
      window.addEventListener('terminal-bg-status', (event) => {
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
      
      // 监听切换监控面板事件
      window.addEventListener('toggle-monitoring-panel', (event) => {
        log.debug('[监控面板] 收到切换监控面板事件:', event.detail);
        toggleMonitoringPanel(event.detail);
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
      
      // 监听显示监控面板事件
      window.addEventListener('show-monitoring-panel', (event) => {
        if (event.detail) {
          toggleMonitoringPanel(event.detail)
        } else {
          toggleMonitoringPanel()
        }
      })
      
      // 监听关闭监控面板和SFTP面板的事件
      const appContainer = document.querySelector('.app-container')
      if (appContainer) {
        appContainer.addEventListener('close-monitoring-panel', () => {
          closeMonitoringPanel()
        })
        
        appContainer.addEventListener('close-sftp-panel', () => {
          closeSftpPanel()
        })
      }

      // 监听来自各个终端工具栏的SFTP面板切换请求
      window.addEventListener('request-toggle-sftp-panel', (event) => {
        if (event.detail && event.detail.sessionId) {
          // 设置活动会话ID并切换SFTP面板
          activeSessionId.value = event.detail.sessionId;
          toggleSftpPanel();
        }
      });

      // 监听来自各个终端工具栏的监控面板切换请求
      window.addEventListener('request-toggle-monitoring-panel', (event) => {
        if (event.detail && event.detail.sessionId) {
          // 设置活动会话ID并切换监控面板
          activeSessionId.value = event.detail.sessionId;
          monitorSessionId.value = event.detail.sessionId;
          toggleMonitoringPanel();
        }
      });
    });

    // 更新CSS变量以供AppLayout使用
    const updateCssVariables = (bgSettings) => {
      if (bgSettings.enabled && bgSettings.url) {
        document.documentElement.style.setProperty('--terminal-bg-image', `url(${bgSettings.url})`)
        document.documentElement.style.setProperty('--terminal-bg-opacity', bgSettings.opacity.toString())

        // 设置背景尺寸
        let backgroundSize = 'cover'
        if (bgSettings.mode === 'contain') {
          backgroundSize = 'contain'
        } else if (bgSettings.mode === 'fill') {
          backgroundSize = '100% 100%'
        } else if (bgSettings.mode === 'none') {
          backgroundSize = 'auto'
        } else if (bgSettings.mode === 'repeat') {
          backgroundSize = 'auto'
        }
        document.documentElement.style.setProperty('--terminal-bg-size', backgroundSize)

        // 设置背景重复
        const backgroundRepeat = bgSettings.mode === 'repeat' ? 'repeat' : 'no-repeat'
        document.documentElement.style.setProperty('--terminal-bg-repeat', backgroundRepeat)

        log.debug('AppLayout CSS变量已更新:', {
          image: bgSettings.url,
          opacity: bgSettings.opacity,
          size: backgroundSize,
          repeat: backgroundRepeat
        })
      } else {
        document.documentElement.style.removeProperty('--terminal-bg-image')
        document.documentElement.style.removeProperty('--terminal-bg-opacity')
        document.documentElement.style.removeProperty('--terminal-bg-size')
        document.documentElement.style.removeProperty('--terminal-bg-repeat')

        log.debug('AppLayout CSS变量已清除')
      }
    }

    // 在组件卸载时移除监听器
    onUnmounted(() => {
      window.removeEventListener('resize', handleWindowResize);
      
      // 移除会话相关监听器
      window.removeEventListener('terminal:session-change', () => {});
      window.removeEventListener('terminal-bg-status', () => {});
      window.removeEventListener('ssh:session-created', () => {});
      window.removeEventListener('toggle-monitoring-panel', () => {});
      
      // 移除显示监控面板事件监听器
      window.removeEventListener('show-monitoring-panel', () => {})
      
      // 移除关闭面板事件监听器
      const appContainer = document.querySelector('.app-container')
      if (appContainer) {
        appContainer.removeEventListener('close-monitoring-panel', () => {})
        appContainer.removeEventListener('close-sftp-panel', () => {})
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
      
      if (showMonitoringPanel.value) {
        const maxWidth = window.innerWidth * 0.95;
        // 如果当前宽度超过了新的最大值，则调整为最大值
        if (monitoringPanelWidth.value > maxWidth) {
          monitoringPanelWidth.value = maxWidth;
          
          // 保存更新后的宽度
          saveMonitoringPanelWidth();
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
    
    // 保存监控面板宽度
    const saveMonitoringPanelWidth = () => {
      try {
        localStorage.setItem('monitoringPanelWidth', monitoringPanelWidth.value.toString());
      } catch (error) {
        log.error('保存监控面板宽度失败:', error);
      }
    };
    
    // 处理SFTP面板尺寸调整
    const handleSftpPanelResize = (newWidth) => {
      sftpPanelWidth.value = newWidth
      // 保存到本地存储
      try {
        localStorage.setItem('sftpPanelWidth', newWidth.toString())
      } catch (e) {
        log.error('保存SFTP面板宽度失败:', e)
      }
    };
    
    // 处理监控面板尺寸调整
    const handleMonitoringPanelResize = (newWidth) => {
      monitoringPanelWidth.value = newWidth
      // 保存到本地存储
      try {
        localStorage.setItem('monitoringPanelWidth', newWidth.toString())
      } catch (e) {
        log.error('保存监控面板宽度失败:', e)
      }
    };
    
    // 打开监控面板
    const toggleMonitoringPanel = (status) => {
      // 如果监控面板已经显示，不要重复处理
      if (showMonitoringPanel.value) {
        // 移除控制台日志输出，避免污染控制台
        return;
      }
      
      try {
        // 检查是否已传入连接信息（来自TerminalToolbar的优化处理）
        if (status && status.useExistingConnection && status.connection) {
          log.debug('使用传入的现有连接信息:', status.connection);
          
          const sessionInfo = {
            id: status.sessionId || 'session_' + Date.now(),
            connection: status.connection
          };
          
          // 将会话信息传递给监控面板
          monitorSessionId.value = sessionInfo.id;
          monitorServerInfo.value = sessionInfo.connection;
          monitoringInstalled.value = status.installed === true;
          
          // 显示监控面板 - 只切换显示状态
          showMonitoringPanel.value = true;
          
          log.debug('打开监控面板（使用现有连接）', { 
            sessionId: sessionInfo.id, 
            serverInfo: sessionInfo.connection
          });
          return;
        }
        
        // 获取当前活动的会话ID
        let currentSessionId = getCurrentSessionId();
        
        // 如果无法获取会话ID但状态中携带了sessionId，则使用它
        if (!currentSessionId && status && status.sessionId) {
          currentSessionId = status.sessionId;
          log.debug(`使用从状态获取的会话ID: ${currentSessionId}`);
        }
        
        // 尝试直接从会话存储中获取会话信息
        let sessionFound = false;
        let sessionInfo = null;
        
        // 从SessionStore中获取会话信息
        if (currentSessionId) {
          const sessionStore = useSessionStore();
          sessionInfo = sessionStore.getSession(currentSessionId);
          if (sessionInfo && sessionInfo.connection) {
            sessionFound = true;
            log.debug('从SessionStore找到会话信息:', sessionInfo);
          }
        }
        
        // 如果SessionStore中没有找到，尝试从sessionStorage中获取
        if (!sessionFound) {
          try {
            const storedSessions = JSON.parse(sessionStorage.getItem('ssh-sessions') || '[]');
            if (storedSessions.length > 0) {
              // 使用第一个活动会话
              sessionInfo = {
                id: storedSessions[0].id || 'session_' + Date.now(),
                connection: {
                  host: storedSessions[0].host || '192.210.143.132',
                  username: storedSessions[0].username || 'root',
                  port: storedSessions[0].port || 22
                }
              };
              sessionFound = true;
              log.debug('从sessionStorage找到会话信息:', sessionInfo);
            }
          } catch (e) {
            log.error('从sessionStorage解析会话信息失败:', e);
          }
        }
        
        // 如果依然没有找到会话信息，创建一个临时会话对象
        if (!sessionFound) {
          sessionInfo = {
            id: 'temp_session_' + Date.now(),
            connection: {
              host: '192.210.143.132', // 使用默认主机地址
              username: 'root',
              port: 22
            }
          };
          log.debug('创建临时会话信息:', sessionInfo);
        }
        
        // 检查是否是一键安装请求
        if (status && status.install === true && sessionInfo) {
          const installCommand = `curl -sSL ${window.location.origin}/api/monitor/install-script | sudo bash`;
          window.dispatchEvent(new CustomEvent('terminal:execute-command', { 
            detail: {
              command: installCommand,
              sessionId: sessionInfo.id
            }
          }));
          ElMessage.success('正在执行安装命令，请在终端中查看进度');
          return;
        }
        
        // 将会话信息传递给监控面板
        monitorSessionId.value = sessionInfo.id;
        monitorServerInfo.value = sessionInfo.connection;
        monitoringInstalled.value = status && status.installed === true;
        
        // 显示监控面板 - 只切换显示状态，不创建新连接
        showMonitoringPanel.value = true;
        
        log.debug('打开监控面板', { 
          sessionId: sessionInfo.id, 
          serverInfo: sessionInfo.connection,
          installed: monitoringInstalled.value 
        });
      } catch (error) {
        log.error('打开监控面板失败:', error);
        ElMessage.error('无法打开监控面板: ' + (error.message || '未知错误'));
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
      
      // 在关闭面板前确保关闭SFTP会话
      if (activeSessionId.value) {
        log.debug(`关闭SFTP面板，清理会话: ${activeSessionId.value}`);
        // 检查会话是否仍然存在
        if (sftpService.activeSftpSessions && sftpService.activeSftpSessions.has(activeSessionId.value)) {
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
    }
    
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
      showMonitoringPanel,
      toggleMonitoringPanel,
      closeMonitoringPanel,
      showSftpPanel,
      toggleSftpPanel,
      closeSftpPanel,
      sftpPanelWidth,
      monitoringPanelWidth,
      isSftpPanelClosing,
      activeSessionId,
      handleSftpPanelResize,
      handleMonitoringPanelResize,
      terminalHasBackground,
      monitorSessionId,
      monitorServerInfo,
      monitoringInstalled,
      getCurrentTerminalId,
      terminalComponent
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