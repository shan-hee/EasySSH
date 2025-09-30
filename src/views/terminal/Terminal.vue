<template>
  <div class="terminal-container theme-transition">
    <div class="terminals-wrapper theme-transition">
      <div
        v-for="termId in terminalIds"
        :key="termId"
        class="terminal-content-wrapper theme-transition"
        :class="{
          'terminal-active': isActiveTerminal(termId),
          'terminal-ready': terminalInitialized[termId]
        }"
        :style="getTerminalStyle(termId)"
      >
        <div
          v-show="shouldShowTerminalConnectingAnimation(termId)"
          class="connecting-overlay"
          :class="{ 'fade-out': !shouldShowTerminalConnectingAnimation(termId) }"
        >
          <rocket-loader
            :phase="getTerminalRocketPhase(termId)"
            @animation-complete="() => handleTerminalAnimationComplete(termId)"
          />
        </div>

        <div class="terminal-individual-toolbar">
          <terminal-toolbar
            :has-background="terminalHasBackground"
            :active-session-id="termId"
            @toggle-sftp-panel="toggleSftpPanel"
            @toggle-monitoring-panel="toggleMonitoringPanel"
            @toggle-ai-input="handleAIInputToggle"
          />
        </div>

        <TerminalFrame
          :tab-switching="isTabSwitching"
          :show-monitoring="shouldShowDesktopMonitoringPanel(termId) && isActiveTerminal(termId)"
          :animate-monitoring="shouldAnimateMonitoring(termId)"
          :with-monitoring="shouldShowDesktopMonitoringPanel(termId)"
          :show-ai="shouldShowAICombinedPanel(termId) && isActiveTerminal(termId)"
          :is-active="isActiveTerminal(termId)"
        >
          <template #monitoring>
            <MonitoringPaneHost
              :visible="isMonitoringPanelVisible(termId)"
              :monitoring-data="getMonitoringData(termId)"
              :terminal-id="termId"
              :state-manager="getTerminalStateManager(termId)"
              :disable-animation="isTabSwitching"
            />
          </template>

          <template #terminal>
            <div
              :ref="el => setTerminalRef(el, termId)"
              class="terminal-content theme-transition"
              :data-terminal-id="termId"
            />
          </template>

          <template #ai>
            <AICombinedHost
              :terminal-id="termId"
              :messages="getAIMessages(termId)"
              :max-height="getAIPanelMaxHeight()"
              :is-mobile="isMobile()"
              :is-streaming="getAIStreamingState(termId)"
              :ai-service="getAIService()"
              :set-panel-ref="el => setAICombinedPanelRef(el, termId)"
              @ai-response="handleAIResponse"
              @ai-streaming="handleAIStreaming"
              @mode-change="handleAIModeChange"
              @input-focus="handleAIInputFocus"
              @input-blur="handleAIInputBlur"
              @execute-command="handleExecuteCommand"
              @clear-history="handleAIClearHistory"
              @edit-command="handleAIEditCommand"
              @add-to-scripts="handleAIAddToScripts"
              @height-change="handleAIPanelHeightChange"
              @height-change-start="handleAIPanelHeightChangeStart"
              @height-change-end="handleAIPanelHeightChangeEnd"
            />
          </template>
        </TerminalFrame>

        <mobile-monitoring-drawer
          :visible="shouldShowMobileMonitoringDrawer(termId) && isActiveTerminal(termId)"
          :monitoring-data="getMonitoringData(termId)"
          :terminal-id="termId"
          @close="hideMobileMonitoringDrawer(termId)"
          @update:visible="updateMobileDrawerVisibility(termId, $event)"
        />
      </div>
    </div>

    <terminal-autocomplete
      ref="autocompleteRef"
      :visible="autocomplete.visible"
      :suggestions="autocomplete.suggestions"
      :position="autocomplete.position"
      @select="handleAutocompleteSelect"
      @close="handleAutocompleteClose"
    />
  </div>
</template>

<script>
import {
  ref,
  onMounted,
  onBeforeUnmount,
  nextTick,
  watch,
  computed,
  onActivated,
  onDeactivated
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useConnectionStore } from '../../store/connection';
import { useLocalConnectionsStore } from '../../store/localConnections';
import { useUserStore } from '../../store/user';
import { useTabStore } from '../../store/tab';
import { useTerminalStore } from '../../store/terminal';

import sshService from '../../services/ssh/index';
import RocketLoader from '../../components/common/RocketLoader.vue';
import settingsService from '../../services/settings';
// 导入终端工具栏组件
import TerminalToolbar from '../../components/terminal/TerminalToolbar.vue';
// 导入终端自动完成组件
import TerminalAutocomplete from '../../components/terminal/TerminalAutocomplete.vue';
// 导入终端自动完成服务
import terminalAutocompleteService from '../../services/terminal-autocomplete';
// 导入日志服务
import log from '../../services/log';
// 导入响应式监控面板组件
// 导入移动端监控抽屉组件
import MobileMonitoringDrawer from '../../components/monitoring/MobileMonitoringDrawer.vue';
// 拆分后的宿主组件
import MonitoringPaneHost from './MonitoringPaneHost.vue';
import AICombinedHost from './AICombinedHost.vue';
import TerminalFrame from './TerminalFrame.vue';
// 导入AI面板状态管理
import { useAIPanelStore } from '../../store/ai-panel.js';

// 导入会话存储
import { useSessionStore } from '../../store/session';

// 在import部分添加字体加载器导入
import { waitForFontsLoaded } from '../../utils/fontLoader';

// 导入监控状态管理器
import monitoringStateManager from '../../services/monitoringStateManager';
// 导入监控状态管理器工厂
import monitoringStateManagerFactory from '../../services/monitoringStateManagerFactory';
// 导入AI服务
import aiService from '../../services/ai/ai-service.js';
import scriptLibraryService from '../../services/scriptLibrary';
import personalizationService from '../../services/personalization';
import { applyTerminalBackgroundCss, clearTerminalBackgroundCss } from '@/utils/terminalBackgroundCss';
import { EVENTS } from '@/services/events';
import { getMsVar } from '@/utils/cssVars';

export default {
  name: 'Terminal',
  components: {
    RocketLoader,
    TerminalToolbar, // 注册工具栏组件
    TerminalAutocomplete, // 注册自动完成组件
    MonitoringPaneHost, // 监控面板宿主
    MobileMonitoringDrawer, // 注册移动端监控抽屉组件
    AICombinedHost, // AI合并面板宿主
    TerminalFrame
  },
  props: {
    id: {
      type: String,
      required: false,
      default: null
    }
  },
  setup(props) {
    const route = useRoute();
    const router = useRouter();
    const connectionStore = useConnectionStore();
    const localConnectionsStore = useLocalConnectionsStore();
    const userStore = useUserStore();
    const tabStore = useTabStore();
    const terminalStore = useTerminalStore();
    const VERBOSE_TERMINAL_LOG = false;
    const debugLog = (...args) => {
      if (VERBOSE_TERMINAL_LOG) {
        log.debug(...args);
      }
    };

    const sessionStore = useSessionStore(); // 添加会话存储

    // 统一时长（从CSS变量读取，可根据主题动态调整）
    const durations = ref({
      tabSwitchWindow: 320,
      monitoringAnimFlag: 500,
      motionMicro: 100,
      motionTiny: 120,
      motionFast: 160,
      motionQuick: 220,
      motionStandard: 300,
      motionSlow: 500
    });
    const refreshDurations = () => {
      try {
        durations.value.tabSwitchWindow = getMsVar('--terminal-tab-switch-window', 320);
        durations.value.monitoringAnimFlag = getMsVar('--monitoring-anim-flag', 500);
        durations.value.motionMicro = getMsVar('--motion-micro', 100);
        durations.value.motionTiny = getMsVar('--motion-tiny', 120);
        durations.value.motionFast = getMsVar('--motion-fast', 160);
        durations.value.motionQuick = getMsVar('--motion-quick', 220);
        durations.value.motionStandard = getMsVar('--motion-standard', 300);
        durations.value.motionSlow = getMsVar('--motion-slow', 500);
      } catch (_) {}
    };

    // 终端引用映射，key为连接ID，value为DOM元素
    const terminalRefs = ref({});
    // 终端初始化状态，key为连接ID，value为是否已初始化
    const terminalInitialized = ref({});
    // 当前所有打开的终端ID列表
    const terminalIds = ref([]);

    const title = ref('终端');
    const status = ref('正在连接...');
    // 将isConnecting从普通的响应式变量改为每个终端的连接状态跟踪
    const terminalConnectingStates = ref({}); // 每个终端的连接状态
    const isConnectingInProgress = ref(false); // 添加连接进行中标志，避免并发请求
    // 添加终端背景状态变量
    const terminalHasBackground = ref(false);

    // 替换全局初始化标志为每个终端的初始化状态映射
    const terminalInitializingStates = ref({});

    // 监控面板相关状态
    const monitoringPanelStates = ref({}); // 每个终端的监控面板显示状态
    const monitoringDataCache = ref({}); // 每个终端的监控数据缓存
    const terminalStateManagers = ref({}); // 每个终端的状态管理器实例映射
    // 仅在用户主动切换监控面板时启用动画，其他场景（如页签切换/自动切换）不动画
    const monitoringAnimateFlags = ref({});
    let cleanupMonitoringListener = null; // 监控数据监听器清理函数

    // AI合并面板相关状态
    const aiCombinedPanelStates = ref({}); // 每个终端的AI合并面板显示状态
    const aiPanelStore = useAIPanelStore(); // AI面板状态管理
    const aiCombinedPanelRefs = ref({}); // AI合并面板组件引用
    const aiStreamingStates = ref({}); // 每个终端的AI流式输出状态

    // 标签切换状态 - 用于在切换页签时禁用监控面板动画
    const isTabSwitching = ref(false);

    // 监控面板动画/尺寸调整状态，避免动画期间频繁 fit 导致闪烁
    const isMonitoringPanelAnimating = ref(false);
    let resizeAfterAnimationTimer = null;

    // 终端监控面板动画状态（避免动画期间频繁 fit 导致闪烁）

    // 终端柔性适配：在最终 fit 前后做一次轻微淡入，掩盖画布重绘造成的闪烁
    const softRefitTerminal = termId => {
      try {
        const id = termId || activeConnectionId.value;
        if (!id || !terminalStore.hasTerminal(id)) return;

        // 选择 xterm 根元素（我们在创建时为元素打过 data-terminal-id 标识）
        const el = document.querySelector(`.xterm[data-terminal-id="${id}"]`);
        if (!el) {
          terminalStore.fitTerminal(id);
          return;
        }

        // 轻微淡出，下一帧执行 fit，再淡入
        const transFrag = `opacity var(--motion-tiny) var(--theme-transition-timing)`;
        el.style.transition = el.style.transition
          ? `${el.style.transition}, ${transFrag}`
          : transFrag;
        el.style.willChange = 'opacity';
        el.style.opacity = '0.01';

        requestAnimationFrame(() => {
          try {
            terminalStore.fitTerminal(id);
          } catch (_) {
            void 0;
          }
          requestAnimationFrame(() => {
            el.style.opacity = '1';
            // 清理 will-change，避免长期占用合成层
            setTimeout(() => {
              el.style.willChange = ''; /* 保留过渡属性以复用 */
            }, durations.value.motionFast);
          });
        });
      } catch (_) {
        // 兜底直接适配
        try {
          terminalStore.fitTerminal(termId || activeConnectionId.value);
        } catch (_) {
          void 0;
        }
      }
    };

    // 每个终端的火箭动画阶段状态
    const terminalRocketPhases = ref({});

    // 获取指定终端的火箭动画阶段
    const getTerminalRocketPhase = termId => {
      return terminalRocketPhases.value[termId] || 'connecting';
    };

    // 设置指定终端的火箭动画阶段
    const setTerminalRocketPhase = (termId, phase) => {
      terminalRocketPhases.value[termId] = phase;
    };

    // 处理指定终端的动画完成事件
    const handleTerminalAnimationComplete = termId => {
      // 动画完成后，确保加载覆盖层隐藏
      // 重置火箭动画状态，为下次连接做准备
      setTimeout(() => {
        setTerminalRocketPhase(termId, 'connecting');
      }, durations.value.motionQuick); // 与动画时长令牌保持一致
    };

    // 检查指定终端是否应该显示连接动画
    const shouldShowTerminalConnectingAnimation = termId => {
      if (!termId) return false;

      // 检查终端是否正在连接中
      if (terminalConnectingStates.value[termId]) {
        if (getTerminalRocketPhase(termId) !== 'connecting') {
          setTerminalRocketPhase(termId, 'connecting');
        }
        return true;
      }

      // 检查终端是否在初始化中
      if (terminalInitializingStates.value[termId]) {
        if (getTerminalRocketPhase(termId) !== 'connecting') {
          setTerminalRocketPhase(termId, 'connecting');
        }
        return true;
      }

      // 检查终端是否已初始化
      if (!terminalInitialized.value[termId]) {
        if (getTerminalRocketPhase(termId) !== 'connecting') {
          setTerminalRocketPhase(termId, 'connecting');
        }
        return true;
      }

      // 如果终端已经初始化，开始完成阶段动画
      if (terminalInitialized.value[termId] && getTerminalRocketPhase(termId) === 'connecting') {
        setTerminalRocketPhase(termId, 'connected');
        // 立即开始完成动画
        setTimeout(() => {
          if (getTerminalRocketPhase(termId) === 'connected') {
            setTerminalRocketPhase(termId, 'completing');
          }
        }, durations.value.motionMicro); // 很短的延迟，只是为了确保状态更新
        return true;
      }

      const currentPhase = getTerminalRocketPhase(termId);
      return currentPhase === 'connected' || currentPhase === 'completing';
    };

    // 终端背景设置
    const terminalBg = ref({
      enabled: false,
      url: '',
      opacity: 0.5,
      mode: 'cover'
    });

    // 自动完成状态
    const autocomplete = ref({
      visible: false,
      suggestions: [],
      position: { x: 0, y: 0 }
    });

    // 自动完成组件引用
    const autocompleteRef = ref(null);
    // 自动完成 Teleport 目标（稳定的容器元素）
    const autocompleteTeleportEl = computed(() => {
      try {
        // 仅将补全框挂载到当前激活终端的 viewport
        const activeId = activeConnectionId.value;
        if (!activeId || !terminalStore.hasTerminal(activeId)) return '';
        const el = terminalRefs.value[activeId];
        if (!el) return '';
        const vp = el.querySelector('.xterm-viewport');
        return vp || '';
      } catch (e) {
        return '';
      }
    });

    // 自动完成位置更新相关
    const autocompleteEventDisposers = ref([]);

    // 使用 rAF 节流位置更新，避免频繁事件导致的闪烁
    let autocompleteRaf = 0;
    const updateAutocompletePosition = () => {
      if (autocompleteRaf) return; // 已有调度
      autocompleteRaf = requestAnimationFrame(() => {
        try {
          const id = activeConnectionId.value;
          if (!id || !autocomplete.value.visible) return;
          if (!terminalStore.hasTerminal(id)) return;
          const terminal = terminalStore.getTerminal(id);
          if (!terminal) return;
          const position = terminalAutocompleteService.calculatePosition(terminal);
          // 位置保护：仅在有效时覆盖，避免用无效位置顶掉有效位置
          const isValid = position && position.x > 4 && position.y > 4;
          if (
            isValid ||
            !autocomplete.value.position ||
            !(autocomplete.value.position.x > 4 && autocomplete.value.position.y > 4)
          ) {
            autocomplete.value.position = position;
          }
        } catch (_) {
          // 忽略位置计算错误，避免打断输入
        } finally {
          autocompleteRaf = 0;
        }
      });
    };

    // 火箭动画阶段（用于过渡显示）
    // 由每个终端的动画控制逻辑管理

    // 连接动画显示逻辑已由每个终端独立方法处理（shouldShowTerminalConnectingAnimation）

    // 计算终端背景样式
    const terminalBgStyle = computed(() => {
      if (!terminalBg.value.enabled || !terminalBg.value.url) {
        return {};
      }

      let backgroundSize = 'cover';
      if (terminalBg.value.mode === 'contain') {
        backgroundSize = 'contain';
      } else if (terminalBg.value.mode === 'fill') {
        backgroundSize = '100% 100%';
      } else if (terminalBg.value.mode === 'none') {
        backgroundSize = 'auto';
      } else if (terminalBg.value.mode === 'repeat') {
        backgroundSize = 'auto';
      }

      return {
        backgroundImage: `url(${terminalBg.value.url})`,
        backgroundSize,
        backgroundRepeat: terminalBg.value.mode === 'repeat' ? 'repeat' : 'no-repeat',
        backgroundPosition: 'center center',
        opacity: terminalBg.value.opacity
      };
    });

    // 计算当前连接ID，优先使用props中的ID，如果没有则使用路由参数或会话存储
    const activeConnectionId = computed(() => {
      // 优先使用props中的ID
      if (props.id) {
        return props.id;
      }

      // 其次使用路由参数
      if (route.params.id) {
        return route.params.id;
      }

      // 最后使用会话存储中的活动会话
      return sessionStore.getActiveSession();
    });

    // 监听活动终端变化，更新状态管理器
    watch(
      activeConnectionId,
      (newTerminalId, oldTerminalId) => {
        if (newTerminalId && newTerminalId !== oldTerminalId) {
          // 获取主机信息
          const session = terminalStore.sessions[newTerminalId];
          const hostId = session?.host || newTerminalId;

          // 设置状态管理器的当前终端
          monitoringStateManager.setTerminal(newTerminalId, hostId);

          debugLog(`[终端] 状态管理器已切换到终端: ${newTerminalId}`);
        }
      },
      { immediate: true }
    );

    // 检查终端是否为当前活动终端
    const isActiveTerminal = termId => {
      return termId === activeConnectionId.value;
    };

    // 获取终端样式，控制显示/隐藏
    const getTerminalStyle = _termId => {
      // 不再通过内联样式控制可见性，改为通过CSS类控制
      // 返回空对象，让CSS类处理所有样式变化
      return {};
    };

    // 设置终端引用
    const setTerminalRef = (el, termId) => {
      if (el && !terminalRefs.value[termId]) {
        terminalRefs.value[termId] = el;
        // 如果终端ID在列表中但尚未初始化，则初始化
        if (!terminalInitialized.value[termId]) {
          initTerminal(termId, el);
        }
      }
    };

    // 初始化特定ID的终端 - 使用统一初始化流程，避免重复逻辑
    const initTerminal = async (termId, container) => {
      try {
        if (!termId || !container) {
          log.error('初始化终端失败: 缺少ID或容器');
          return false;
        }

        // 确保字体已经加载完成
        await waitForFontsLoaded();

        // 清理错误状态的连接
        if (terminalStore.getTerminalStatus(termId) === 'error') {
          delete terminalInitialized.value[termId];
          delete terminalInitializingStates.value[termId];
          delete terminalConnectingStates.value[termId];

          if (sessionStore.getSession(termId)) {
            sessionStore.setActiveSession(null);
          }
        }

        // 检查终端状态
        const hasTerminal = terminalStore.hasTerminal(termId);
        const hasSession = terminalStore.hasTerminalSession(termId);
        const isCreating = terminalStore.isSessionCreating(termId);

        // 如果终端或会话不存在，且不在创建中，才尝试初始化
        if ((!hasTerminal || !hasSession) && !isCreating) {
          // 调用统一初始化流程
          const success = await terminalStore.initTerminal(termId, container);
          return success;
        } else if (hasTerminal && hasSession) {
          // 终端和会话都存在，直接标记为已初始化
          terminalInitialized.value[termId] = true;
          terminalConnectingStates.value[termId] = false;
          terminalInitializingStates.value[termId] = false;
          return true;
        } else if (isCreating) {
          // 正在创建中，标记状态
          terminalInitializingStates.value[termId] = true;
          terminalConnectingStates.value[termId] = true;
          return false;
        }

        // 未满足初始化条件
        return false;
      } catch (error) {
        log.error(`终端初始化错误: ${error.message}`, error);
        return false;
      }
    };

    // 应用终端设置的逻辑已集中到 terminalStore.applySettingsToAllTerminals 中

    // 加载终端背景设置（从设置服务快照读取）
    const loadTerminalBgSettings = () => {
      try {
        const bg = settingsService.getTerminalBackground?.();
        if (bg && typeof bg === 'object') {
          terminalBg.value = { ...bg };
          terminalHasBackground.value = !!bg.enabled;
          // 更新CSS变量以供AppLayout使用
          updateCssVariables();
        }
      } catch (error) {
        log.error('加载终端背景设置失败:', error);
      }
    };

    // 更新CSS变量以供AppLayout使用（统一工具）
    // 使用局部函数包装，便于调用
    const updateCssVariables = () => {
      if (terminalBg.value.enabled && terminalBg.value.url) {
        applyTerminalBackgroundCss(terminalBg.value);
      } else {
        clearTerminalBackgroundCss();
      }
    };

    // 监听终端背景设置变化事件（使用命名函数以便正确移除）
    let bgChangeHandler = null;
    const listenForBgChanges = () => {
      // 创建命名的处理函数
      bgChangeHandler = event => {
        if (event.detail) {
          terminalBg.value = { ...event.detail };

          // 更新本地背景状态
          terminalHasBackground.value = event.detail.enabled;

          // 发送背景图状态变更事件
      window.dispatchEvent(
        new CustomEvent(EVENTS.TERMINAL_BG_STATUS, {
          detail: {
            enabled: terminalBg.value.enabled,
            bgSettings: terminalBg.value
          }
        })
      );

          // 更新CSS变量
          if (terminalBg.value.enabled && terminalBg.value.url) {
            applyTerminalBackgroundCss(terminalBg.value);
          } else {
            clearTerminalBackgroundCss();
          }

          // 背景开关或参数变化后，刷新所有终端主题以应用/取消透明背景
          try {
            const currentTheme = settingsService.getTerminalSettings()?.theme || 'dark';
            terminalStore.applySettingsToAllTerminals({ theme: currentTheme });
          } catch (_) {}
        }
      };

      // 使用命名函数添加监听器
      window.addEventListener(EVENTS.TERMINAL_BG_CHANGED, bgChangeHandler);
    };

    // 添加防抖计时器
    const updateIdListDebounceTimer = ref(null);

    // 监听打开的终端标签页，更新终端ID列表
    const updateTerminalIds = () => {
      // 添加防抖处理
      if (updateIdListDebounceTimer.value) {
        clearTimeout(updateIdListDebounceTimer.value);
      }

      updateIdListDebounceTimer.value = setTimeout(() => {
        // 获取所有终端类型的标签页
        const terminalTabs = tabStore.tabs.filter(
          tab => tab.type === 'terminal' && tab.data && tab.data.connectionId
        );

        // 提取所有终端ID
        const newIds = [...new Set(terminalTabs.map(tab => tab.data.connectionId))];

        // 查找要删除的ID
        const idsToRemove = terminalIds.value.filter(id => !newIds.includes(id));

        if (idsToRemove.length > 0) {
          debugLog(`发现${idsToRemove.length}个不在标签页中的终端ID，准备移除:`, idsToRemove);

          // 清理不在标签页中的终端ID及其相关状态
          for (const idToRemove of idsToRemove) {
            // 清理终端状态
            delete terminalInitialized.value[idToRemove];
            delete terminalInitializingStates.value[idToRemove];
            delete terminalConnectingStates.value[idToRemove];
            delete terminalSized.value[idToRemove];

            // 清理定时器
            if (resizeDebounceTimers.value[idToRemove]) {
              clearTimeout(resizeDebounceTimers.value[idToRemove]);
              delete resizeDebounceTimers.value[idToRemove];
            }

            // 清理引用
            if (terminalRefs.value[idToRemove]) {
              terminalRefs.value[idToRemove] = null;
              delete terminalRefs.value[idToRemove];
            }
          }
        }

        // 比较新旧ID列表，只有当内容不同时才更新和记录日志
        const currentIds = terminalIds.value;
        const hasChanged =
          newIds.length !== currentIds.length ||
          newIds.some(id => !currentIds.includes(id)) ||
          currentIds.some(id => !newIds.includes(id));

        if (hasChanged) {
          // 更新ID列表
          terminalIds.value = newIds;
          debugLog('更新终端ID列表:', terminalIds.value);
        }

        updateIdListDebounceTimer.value = null;
      }, 50); // 50ms防抖延迟
    };

    // 添加防抖控制
    const resizeDebounceTimers = ref({});

    // 添加终端尺寸已调整标志
    const terminalSized = ref({});

    // 调整终端大小（添加防抖逻辑和尺寸状态跟踪）
    const resizeTerminal = (termId = null) => {
      // 防抖函数 - 避免短时间内多次调整同一终端
      const debouncedResize = id => {
        // 如果已有定时器，先清除
        if (resizeDebounceTimers.value[id]) {
          clearTimeout(resizeDebounceTimers.value[id]);
        }

        // 设置新的定时器
        resizeDebounceTimers.value[id] = setTimeout(() => {
          if (!terminalStore.hasTerminal(id)) return;

          try {
            // 移除重复的调整日志 - 由 terminalStore.fitTerminal 统一输出
            terminalStore.fitTerminal(id);
            // 标记终端尺寸已调整
            terminalSized.value[id] = true;
            // 清除定时器引用
            delete resizeDebounceTimers.value[id];
          } catch (error) {
            log.error(`调整终端 ${id} 大小失败:`, error);
          }
        }, 50); // 短延迟防抖
      };

      // 如果指定了ID，只调整该终端大小
      if (termId) {
        // 仅当终端未被调整过大小时才进行调整
        if (!terminalSized.value[termId]) {
          debouncedResize(termId);
        } else {
          debugLog(`终端 ${termId} 已调整过大小，跳过调整`);
        }
        return;
      }

      // 否则调整所有终端大小，优先调整活动终端
      const activeId = activeConnectionId.value;
      if (activeId && terminalStore.hasTerminal(activeId) && !terminalSized.value[activeId]) {
        debouncedResize(activeId);
      }

      // 然后调整其它未调整过大小的终端
      terminalIds.value.forEach(id => {
        if (id !== activeId && terminalStore.hasTerminal(id) && !terminalSized.value[id]) {
          debouncedResize(id);
        }
      });
    };

    // 为组件添加最后聚焦的终端ID跟踪
    const lastFocusedTerminalId = ref(null);

    // 强制应用光标样式的函数
    const forceCursorStyle = termId => {
      if (!termId || !terminalStore.hasTerminal(termId)) return;

      try {
        const terminal = terminalStore.getTerminal(termId);
        const settings = settingsService.getTerminalSettings();

        if (terminal && settings) {
          // 根据终端store的实现，terminal直接是xterm.js实例

          // 立即应用光标样式
          if (settings.cursorStyle && terminal.setOption) {
            terminal.setOption('cursorStyle', settings.cursorStyle);
          }
          if (settings.cursorBlink !== undefined && terminal.setOption) {
            terminal.setOption('cursorBlink', settings.cursorBlink);
          }

          // 强制刷新终端显示
          if (terminal.refresh) {
            terminal.refresh(terminal.buffer.active.cursorY, terminal.buffer.active.cursorY);
          }
        }
      } catch (error) {
        log.warn(`强制应用光标样式失败: ${error.message}`);
      }
    };

    // 修改聚焦逻辑，跟踪焦点状态并立即应用光标样式
    const focusTerminal = termId => {
      if (!termId || !terminalStore.hasTerminal(termId)) return false;

      try {
        // 先强制应用光标样式
        // 这样可以避免终端切换时光标样式从默认滑块样式转换到用户设置样式的闪烁问题
        forceCursorStyle(termId);

        // 然后聚焦终端
        terminalStore.focusTerminal(termId);
        lastFocusedTerminalId.value = termId;

        // 聚焦后立即再次强制应用光标样式
        nextTick(() => {
          forceCursorStyle(termId);
        });

        return true;
      } catch (error) {
        log.error(`聚焦终端 ${termId} 失败:`, error);
        return false;
      }
    };

    // 切换终端函数
    const switchToTerminal = async termId => {
      if (!termId || !terminalStore.hasTerminal(termId)) return;

      // 取消所有正在进行的大小调整
      Object.keys(resizeDebounceTimers.value).forEach(id => {
        clearTimeout(resizeDebounceTimers.value[id]);
        delete resizeDebounceTimers.value[id];
      });

      // 使用nextTick确保DOM更新
      nextTick(() => {
        if (terminalStore.hasTerminal(termId)) {
          // 仅当终端未调整过大小时才调整
          if (!terminalSized.value[termId]) {
            resizeTerminal(termId);
          }
          focusTerminal(termId);
        }
      });
    };

    // 监听标签页状态变化，更新终端ID列表
    watch(
      () => tabStore.tabs,
      (newTabs, oldTabs) => {
        // 检测已关闭的终端标签
        if (oldTabs && oldTabs.length > newTabs.length) {
          // 查找已关闭的终端标签
          const closedTabs = oldTabs.filter(
            oldTab =>
              !newTabs.some(
                newTab =>
                  newTab.data &&
                  oldTab.data &&
                  newTab.data.connectionId === oldTab.data.connectionId
              ) &&
              oldTab.type === 'terminal' &&
              oldTab.data &&
              oldTab.data.connectionId
          );

          // 处理已关闭的终端标签
          if (closedTabs.length > 0) {
            for (const closedTab of closedTabs) {
              const closedId = closedTab.data.connectionId;
              debugLog(`检测到标签页关闭，移除终端ID: ${closedId}`);

              // 从终端ID列表中移除
              terminalIds.value = terminalIds.value.filter(id => id !== closedId);

              // 清理与此终端相关的所有状态
              delete terminalInitialized.value[closedId];
              delete terminalInitializingStates.value[closedId];
              delete terminalConnectingStates.value[closedId];
              delete terminalSized.value[closedId];

              if (resizeDebounceTimers.value[closedId]) {
                clearTimeout(resizeDebounceTimers.value[closedId]);
                delete resizeDebounceTimers.value[closedId];
              }

              // 清理引用
              if (terminalRefs.value[closedId]) {
                terminalRefs.value[closedId] = null;
                delete terminalRefs.value[closedId];
              }

              // 清理本地监控面板偏好缓存，避免长期堆积
              try {
                localStorage.removeItem(`monitoring-panel-user-hidden-${closedId}`);
              } catch (_) {}
            }
          }
        }

        updateTerminalIds();
      },
      { deep: true, immediate: true }
    );

    // 监听会话切换，确保工具栏同步和终端切换
    const handleSessionChange = event => {
      if (!event?.detail?.sessionId) return;

      const { sessionId, isTabSwitch } = event.detail;

      // 如果是标签切换，临时禁用监控面板动画
      if (isTabSwitch) {
        isTabSwitching.value = true;
      }

      // 如果终端ID不在列表中，添加到列表
      if (!terminalIds.value.includes(sessionId)) {
        terminalIds.value.push(sessionId);
      }

      // 为新终端初始化监控面板默认状态
      if (monitoringPanelStates.value[sessionId] === undefined) {
        monitoringPanelStates.value[sessionId] = isDesktop(); // 桌面端默认显示
        debugLog(`[终端] 新终端监控面板默认状态: ${sessionId}, 显示: ${isDesktop()}`);
      }

      // 为新终端创建状态管理器实例
      if (!terminalStateManagers.value[sessionId]) {
        getTerminalStateManager(sessionId);
      }

      // 检查是否是标签切换模式
      if (!isTabSwitch) {
        // 重置该终端的火箭动画状态为连接中
        setTerminalRocketPhase(sessionId, 'connecting');

        // 无论终端是否已存在，都将其状态设置为正在连接
        // 这确保了火箭动画能正常显示，即使是已有终端
        terminalConnectingStates.value[sessionId] = true;

        // 告知工具栏重置状态 - 发送工具栏状态重置事件
        window.dispatchEvent(
          new CustomEvent(EVENTS.TERMINAL_TOOLBAR_RESET, {
            detail: { sessionId }
          })
        );

        // 如果终端已经存在，延迟更新连接状态
        if (terminalStore.hasTerminal(sessionId)) {
          setTimeout(() => {
            terminalConnectingStates.value[sessionId] = false;
          }, 1000);
        }
      } else {
        // 标签切换，不显示连接动画
        terminalConnectingStates.value[sessionId] = false;

        // 发送工具栏同步事件
        window.dispatchEvent(
          new CustomEvent(EVENTS.TERMINAL_TOOLBAR_SYNC, {
            detail: { sessionId }
          })
        );
        // 强制关闭监控动画标记，避免出现滑入效果
        monitoringAnimateFlags.value[sessionId] = false;
      }

      // 延迟切换以确保终端初始化完成
      setTimeout(() => {
        switchToTerminal(sessionId);
        if (terminalStore.hasTerminal(sessionId)) {
          forceCursorStyle(sessionId);
        }
        // 如果是标签切换，切换完成后尽快恢复动画
        if (isTabSwitch) {
          // 延长禁用动画窗口，覆盖监控面板和布局过渡
          // nextTick+rAF 可能过早复位，改为短暂超时
          setTimeout(() => {
            isTabSwitching.value = false;
          }, durations.value.tabSwitchWindow);
        }
      }, 100);
    };

    // 修改watch函数，添加连接中状态检查
    watch(
      () => route.path,
      newPath => {
        // 当路径变为'/terminal'（无参数）时，从会话存储获取会话ID
        if (
          newPath === '/terminal' &&
          !isConnectingInProgress.value &&
          !Object.values(terminalInitializingStates.value).some(state => state)
        ) {
          const currentSessionId = sessionStore.getActiveSession();
          if (currentSessionId) {
            debugLog(`检测到终端路径变更，使用会话存储ID: ${currentSessionId}`);
            updateTerminalIds();
          }
        }
      },
      { immediate: true }
    );

    // 定义处理键盘快捷键事件的函数
    const handleKeyboardAction = action => {
      if (action === 'terminal.clear') {
        clearTerminal();
      }
    };

    // 处理终端主题更新事件 - 优化为同步批量更新
    const handleTerminalThemeUpdate = async event => {
      log.info('收到终端主题更新事件:', event.detail);
      log.info('当前终端ID列表:', terminalIds.value);

      // 直接获取当前UI主题对应的终端主题
      const uiTheme = event.detail?.uiTheme || 'dark';
      const terminalThemeName = uiTheme === 'light' ? 'light' : 'dark';
      const themeConfig = settingsService.getTerminalTheme(terminalThemeName);
      log.info('获取到的新主题配置:', themeConfig);

      // 使用applySettingsToAllTerminals方法批量更新所有终端的主题
      try {
        log.info(`开始批量更新所有终端主题为: ${terminalThemeName}`);
        const results = await terminalStore.applySettingsToAllTerminals({
          theme: terminalThemeName
        });
        log.info('批量更新终端主题完成:', results);

        // 统计成功和失败的数量
        const successCount = Object.values(results).filter(success => success).length;
        const totalCount = Object.keys(results).length;
        log.info(`主题更新结果: ${successCount}/${totalCount} 个终端更新成功`);

        // 为 xterm 进行一次轻微淡入，形成过渡感（适用于Canvas/WebGL渲染）
        try {
          const nodes = document.querySelectorAll('.terminal-content-wrapper .xterm');
              nodes.forEach(el => {
                try {
                  const prev = el.style.transition || '';
                  const transFrag = `opacity var(--motion-quick) var(--theme-transition-timing)`;
                  el.style.transition = prev ? `${prev}, ${transFrag}` : transFrag;
                  el.style.willChange = 'opacity';
                  el.style.opacity = '0.01';
                  requestAnimationFrame(() => {
                    el.style.opacity = '1';
                    setTimeout(() => {
                      el.style.willChange = '';
                    }, durations.value.motionQuick);
                  });
                } catch (_) {}
              });
        } catch (_) {}
      } catch (error) {
        log.error('批量更新终端主题失败:', error);
      }
    };

    // 处理终端设置更新事件
    const handleTerminalSettingsUpdate = async event => {
      if (event.detail && event.detail.settings) {
        log.info('收到终端设置更新事件，应用到所有活动终端');

        // 更新设置服务中的设置（确保同步）
        try {
          const newSettings = event.detail.settings;
          if (settingsService.isInitialized) {
            // 更新设置服务中的终端设置
            Object.keys(newSettings).forEach(key => {
              if (newSettings[key] !== undefined) {
                settingsService.set(`terminal.${key}`, newSettings[key]);
              }
            });
            debugLog('设置服务中的终端设置已同步更新');
          }
        } catch (error) {
          log.error('同步设置服务失败:', error);
        }

        // 使用terminalStore的批量更新方法应用设置到所有终端
        try {
          log.info('开始批量更新所有终端设置');
          const results = await terminalStore.applySettingsToAllTerminals(event.detail.settings);
          log.info('批量更新终端设置完成:', results);

          // 统计成功和失败的数量
          const successCount = Object.values(results).filter(success => success).length;
          const totalCount = Object.keys(results).length;
          log.info(`设置更新结果: ${successCount}/${totalCount} 个终端更新成功`);
        } catch (error) {
          log.error('批量更新终端设置失败:', error);
        }
      }
    };

    // 监听外部工具栏事件
    const setupToolbarListeners = () => {
      window.addEventListener(EVENTS.TERMINAL_SEND_COMMAND, sendTerminalCommand);
      window.addEventListener(EVENTS.TERMINAL_CLEAR, clearTerminal);
      window.addEventListener(EVENTS.TERMINAL_DISCONNECT, disconnectTerminal);
      window.addEventListener(EVENTS.TERMINAL_EXECUTE_COMMAND, executeTerminalCommand);

      // 全局键盘管理器服务可用时绑定事件
      if (window.services?.keyboardManager) {
        window.services.keyboardManager.on('action', handleKeyboardAction);
      }

      // 监听 UI 服务就绪事件，以便在服务加载后绑定（优先 ui-services:ready，回退 services:ready）
      const bindKeyboardOnReady = () => {
        if (window.services?.keyboardManager) {
          window.services.keyboardManager.on('action', handleKeyboardAction);
          window.removeEventListener('ui-services:ready', bindKeyboardOnReady, { capture: false });
          window.removeEventListener('services:ready', bindKeyboardOnReady, { capture: false });
        }
      };
      window.addEventListener(EVENTS.UI_SERVICES_READY, bindKeyboardOnReady, { once: true });
      window.addEventListener(EVENTS.SERVICES_READY, bindKeyboardOnReady, { once: true });
    };

    // 移除外部工具栏事件监听
    const removeToolbarListeners = () => {
      window.removeEventListener(EVENTS.TERMINAL_SEND_COMMAND, sendTerminalCommand);
      window.removeEventListener(EVENTS.TERMINAL_CLEAR, clearTerminal);
      window.removeEventListener(EVENTS.TERMINAL_DISCONNECT, disconnectTerminal);
      window.removeEventListener(EVENTS.TERMINAL_EXECUTE_COMMAND, executeTerminalCommand);

      // 移除键盘快捷键事件监听
      if (window.services?.keyboardManager) {
        window.services.keyboardManager.off('action', handleKeyboardAction);
      }
    };

    // 清空当前活动终端
    const clearTerminal = () => {
      const id = activeConnectionId.value;
      if (id && terminalStore.hasTerminal(id)) {
        terminalStore.clearTerminal(id);
      }
    };

    // 发送命令到当前活动终端
    const sendTerminalCommand = () => {
      try {
        ElMessageBox.prompt('请输入要执行的命令', '发送命令', {
          confirmButtonText: '发送',
          cancelButtonText: '取消',
          inputPattern: /.+/,
          inputErrorMessage: '命令不能为空'
        })
          .then(({ value }) => {
            const id = activeConnectionId.value;
            if (id) {
              terminalStore.sendCommand(id, value);
            }
          })
          .catch(() => {
            // 用户取消输入，不做处理
          });
      } catch (error) {
        log.error('发送命令失败:', error);
      }
    };

    // 执行指定命令到终端
    const executeTerminalCommand = event => {
      if (event.detail && event.detail.command) {
        const id = event.detail.sessionId || activeConnectionId.value;
        if (id && terminalStore.hasTerminal(id)) {
          // 先发送换行符确保在新行开始命令
          terminalStore.sendCommand(id, '');
          // 延迟一小段时间后再发送实际命令
          setTimeout(() => {
            terminalStore.sendCommand(id, event.detail.command);
          }, 100);

          debugLog(`执行命令到终端 ${id}: ${event.detail.command}`);
        } else {
          log.error('无法执行命令：终端不存在或无效');
        }
      }
    };

    // 处理SSH错误
    // SSH错误处理已通过全局事件处理（setupSSHFailureHandler）集中处理

    // 断开当前活动终端连接
    const disconnectTerminal = async () => {
      ElMessageBox.confirm('确定要断开此连接吗？', '断开连接', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      })
        .then(() => {
          disconnectSession();
        })
        .catch(() => {
          // 用户取消，不执行任何操作
        });
    };

    // 断开会话函数
    const disconnectSession = async () => {
      const id = activeConnectionId.value;
      if (id) {
        const success = await terminalStore.disconnectTerminal(id);
        if (success) {
          log.info(`终端 ${id} 已断开`);

          // 从终端ID列表中移除
          terminalIds.value = terminalIds.value.filter(termId => termId !== id);
          // 移除终端初始化状态标记
          delete terminalInitialized.value[id];
          delete terminalInitializingStates.value[id];
          delete terminalConnectingStates.value[id];

          // 清理AI面板状态
          aiPanelStore.cleanupTerminal(id);

          // 检查是否所有终端都已完成连接
          const anyConnecting = Object.values(terminalConnectingStates.value).some(
            state => state === true
          );
          isConnectingInProgress.value = anyConnecting;

          // 找到对应标签页关闭
          const tabIndex = tabStore.tabs.findIndex(
            tab => tab.type === 'terminal' && tab.data && tab.data.connectionId === id
          );

          if (tabIndex >= 0) {
            tabStore.closeTab(tabIndex);
          }
        }
      }
    };

    // 创建全局的窗口大小变化处理函数，防止多个匿名函数导致无法正确移除
    // 窗口大小变化已由 ResizeObserver 处理

    // 在变量声明部分添加sftpPanelWidth
    const sftpPanelWidth = ref(600); // 默认SFTP面板宽度

    // 添加SFTP和监控面板相关方法
    const toggleSftpPanel = () => {
      // 通过事件将当前终端ID传递给父组件
      window.dispatchEvent(
        new CustomEvent(EVENTS.REQUEST_TOGGLE_SFTP_PANEL, {
          detail: { sessionId: activeConnectionId.value }
        })
      );
    };

    const toggleMonitoringPanel = async () => {
      const sessionId = activeConnectionId.value;
      if (!sessionId) {
        log.warn('[终端] 无法切换监控面板：没有活动会话');
        return;
      }

      try {
        // 标记本次切换为需要动画
        monitoringAnimateFlags.value[sessionId] = true;
        setTimeout(() => {
          monitoringAnimateFlags.value[sessionId] = false;
        }, durations.value.monitoringAnimFlag);
        // 切换当前活动终端的监控面板显示状态
        const currentState = monitoringPanelStates.value[sessionId] || false;
        monitoringPanelStates.value[sessionId] = !currentState;

        // 管理用户偏好
        if (!currentState) {
          // 用户手动显示面板，清除隐藏偏好
          localStorage.removeItem(`monitoring-panel-user-hidden-${sessionId}`);
        } else {
          // 用户手动隐藏面板，记录偏好
          localStorage.setItem(`monitoring-panel-user-hidden-${sessionId}`, 'true');
        }

        log.info(`[终端] 监控面板已${!currentState ? '显示' : '隐藏'}: ${sessionId}`);
      } catch (error) {
        log.error(`[终端] 切换监控面板失败: ${error.message}`);
        ElMessage.error(`切换监控面板失败: ${error.message}`);
      }
    };

    // 处理AI输入栏切换
    const handleAIInputToggle = visible => {
      const termId = activeConnectionId.value;
      if (!termId) {
        log.warn('[终端] 无法切换AI输入栏：没有活动终端');
        return;
      }

      // 根据visible参数设置AI合并面板状态
      // visible为true时显示，false时隐藏
      if (visible) {
        aiCombinedPanelStates.value[termId] = true;
      } else {
        aiCombinedPanelStates.value[termId] = false;
      }

      debugLog(`[终端] AI输入栏状态已切换: ${termId} -> ${visible}`);
    };

    // 检测是否为桌面端
    const isDesktop = () => {
      return window.innerWidth >= 768;
    };

    // 检测是否为移动端
    const isMobile = () => {
      return window.innerWidth < 768;
    };

    // 监控面板相关方法
    const shouldShowMonitoringPanel = termId => {
      // 如果没有设置过状态，则根据屏幕尺寸设置默认值
      if (monitoringPanelStates.value[termId] === undefined) {
        monitoringPanelStates.value[termId] = isDesktop(); // 桌面端默认显示，移动端默认隐藏
      }
      return monitoringPanelStates.value[termId] || false;
    };
    
    // 是否应为该终端的监控面板启用动画：仅当用户主动切换时
    const shouldAnimateMonitoring = termId => {
      return !!monitoringAnimateFlags.value[termId];
    };

    // 桌面端监控面板显示逻辑
    const shouldShowDesktopMonitoringPanel = termId => {
      return isDesktop() && shouldShowMonitoringPanel(termId);
    };

    // 移动端监控抽屉显示逻辑
    const shouldShowMobileMonitoringDrawer = termId => {
      return isMobile() && shouldShowMonitoringPanel(termId);
    };

    const isMonitoringPanelVisible = termId => {
      return monitoringPanelStates.value[termId] || false;
    };

    const getMonitoringData = termId => {
      return monitoringDataCache.value[termId] || {};
    };

    // 获取或创建指定终端的状态管理器实例
    const getTerminalStateManager = termId => {
      if (!termId) {
        log.warn('[终端] 无法获取状态管理器：终端ID为空');
        return null;
      }

      // 如果已存在实例，直接返回
      if (terminalStateManagers.value[termId]) {
        return terminalStateManagers.value[termId];
      }

      // 获取终端对应的主机信息
      const session = terminalStore.sessions[termId];
      const hostId = session?.host || termId;

      // 通过工厂创建新实例
      const stateManager = monitoringStateManagerFactory.getInstance(termId, hostId);
      if (stateManager) {
        terminalStateManagers.value[termId] = stateManager;
        debugLog(`[终端] 已创建状态管理器实例: ${termId} (主机: ${hostId})`);
      }

      return stateManager;
    };

    // 清理指定终端的状态管理器实例
    const cleanupTerminalStateManager = termId => {
      if (terminalStateManagers.value[termId]) {
        // 通过工厂销毁实例
        monitoringStateManagerFactory.destroyInstance(termId);
        delete terminalStateManagers.value[termId];
        debugLog(`[终端] 已清理状态管理器实例: ${termId}`);
      }
    };

    const hideMonitoringPanel = termId => {
      monitoringPanelStates.value[termId] = false;
      // 记录用户手动隐藏的偏好
      localStorage.setItem(`monitoring-panel-user-hidden-${termId}`, 'true');
      log.info(`[终端] 监控面板已隐藏: ${termId}`);
    };

    // 移动端抽屉特定方法
    const hideMobileMonitoringDrawer = termId => {
      hideMonitoringPanel(termId);
    };

    const updateMobileDrawerVisibility = (termId, visible) => {
      monitoringPanelStates.value[termId] = visible;
      if (!visible) {
        // 记录用户手动隐藏的偏好
        localStorage.setItem(`monitoring-panel-user-hidden-${termId}`, 'true');
      } else {
        // 用户手动显示，清除隐藏偏好
        localStorage.removeItem(`monitoring-panel-user-hidden-${termId}`);
      }
      log.info(`[终端] 移动端监控抽屉${visible ? '显示' : '隐藏'}: ${termId}`);
    };

    // 监听关闭监控面板事件（来自 AppLayout 转发）
    const handleCloseMonitoringPanel = event => {
      try {
        const sessionId = event?.detail?.sessionId || activeConnectionId.value;
        if (sessionId) {
          monitoringPanelStates.value[sessionId] = false;
          // 记录用户手动隐藏的偏好
          localStorage.setItem(`monitoring-panel-user-hidden-${sessionId}`, 'true');
        }
      } catch (_) {}
    };

    // 设置监控数据监听器 - 监听每个终端的独立状态管理器
    const setupMonitoringDataListener = () => {
      // 监听所有终端状态管理器的数据变化
      const watchers = [];

      // 为现有终端设置监听器
      const setupWatcherForTerminal = termId => {
        const stateManager = getTerminalStateManager(termId);
        if (stateManager) {
          const monitoringData = computed(() => stateManager.getMonitoringData());

          const watcher = watch(
            monitoringData,
            newData => {
              if (newData && Object.keys(newData).length > 0) {
                monitoringDataCache.value[termId] = { ...newData };
                // 监控数据已更新（日志已移除，用户可在WebSocket中查看）
              }
            },
            { deep: true }
          );

          watchers.push({ termId, watcher });
        }
      };

      // 为现有终端设置监听器
      Object.keys(terminalStore.sessions).forEach(setupWatcherForTerminal);

      // 监听新终端的创建
      const sessionWatcher = watch(
        () => Object.keys(terminalStore.sessions),
        (newTerminals, oldTerminals) => {
          const addedTerminals = newTerminals.filter(id => !oldTerminals.includes(id));
          addedTerminals.forEach(setupWatcherForTerminal);
        }
      );

      watchers.push({ termId: 'session-watcher', watcher: sessionWatcher });

      // 返回清理函数
      return () => {
        watchers.forEach(({ watcher }) => {
          if (typeof watcher === 'function') {
            watcher();
          }
        });
      };
    };

    // 初始化监控面板默认状态
    const initializeMonitoringPanelDefaults = () => {
      // 为所有现有的终端设置默认监控面板状态
      const currentTerminals = Object.keys(terminalStore.sessions);
      currentTerminals.forEach(termId => {
        if (monitoringPanelStates.value[termId] === undefined) {
          monitoringPanelStates.value[termId] = isDesktop(); // 桌面端默认显示
          debugLog(`[终端] 初始化监控面板默认状态: ${termId}, 显示: ${isDesktop()}`);
        }
      });

      // 如果有活动终端，也确保其状态被初始化
      if (
        activeConnectionId.value &&
        monitoringPanelStates.value[activeConnectionId.value] === undefined
      ) {
        monitoringPanelStates.value[activeConnectionId.value] = isDesktop();
        debugLog(
          `[终端] 初始化活动终端监控面板状态: ${activeConnectionId.value}, 显示: ${isDesktop()}`
        );
      }
    };

    // 处理监控面板响应式状态变化
    const handleMonitoringPanelResize = () => {
      const currentIsDesktop = isDesktop();
      const currentIsMobile = isMobile();

      Object.keys(terminalStore.sessions).forEach(termId => {
        // 桌面端逻辑：当从移动端切换到桌面端时，自动显示监控面板（如果用户没有手动设置过）
        if (currentIsDesktop && !monitoringPanelStates.value[termId]) {
          // 检查用户是否手动隐藏过面板（通过localStorage）
          const userPreference = localStorage.getItem(`monitoring-panel-user-hidden-${termId}`);
          if (!userPreference) {
            monitoringPanelStates.value[termId] = true;
            debugLog(`[终端] 窗口切换到桌面端，自动显示监控面板: ${termId}`);
          }
        }

        // 移动端逻辑：当从桌面端切换到移动端时，如果面板是显示的，保持状态但切换为抽屉模式
        if (currentIsMobile && monitoringPanelStates.value[termId]) {
          debugLog(`[终端] 窗口切换到移动端，监控面板切换为抽屉模式: ${termId}`);
          // 状态保持不变，只是显示方式从侧边面板切换为抽屉
        }
      });
    };

    // 组件挂载
    onMounted(() => {
      // 从CSS变量刷新时长配置
      try { refreshDurations(); } catch (_) {}
      // 初始化标签页标题
      if (tabStore.tabs.some(tab => tab.path === '/terminal')) {
        tabStore.updateTabTitle('/terminal', '终端');
      }

      // 设置自动完成回调
      setupAutocompleteCallbacks();

      // 加载并监听终端背景设置
      loadTerminalBgSettings();
      listenForBgChanges();

      // 监听工具栏事件
      setupToolbarListeners();

      // 添加全局键盘事件监听
      document.addEventListener('keydown', handleGlobalKeydown, true);

      // 设置监控数据监听器
      cleanupMonitoringListener = setupMonitoringDataListener();

      // 初始化监控面板默认状态
      initializeMonitoringPanelDefaults();

      // 初始化ResizeObserver - 在DOM挂载后安全地初始化
      nextTick(() => {
        const terminalContainer = document.querySelector('.terminal-container');
        if (terminalContainer) {
          resizeObserver = new ResizeObserver(() => {
            // 在AI面板拖拽或监控面板过渡动画期间，不频繁触发 fit，改为动画结束/短延迟后统一触发一次
            if (isAIPanelResizing.value || isMonitoringPanelAnimating.value) {
              if (resizeAfterAnimationTimer) clearTimeout(resizeAfterAnimationTimer);
              resizeAfterAnimationTimer = setTimeout(() => {
                if (
                  activeConnectionId.value &&
                  terminalStore.hasTerminal(activeConnectionId.value)
                ) {
                  terminalStore.fitTerminal(activeConnectionId.value);
                }
                // 处理监控面板响应式状态
                handleMonitoringPanelResize();
              }, durations.value.motionTiny);
              return;
            }

            if (activeConnectionId.value && terminalStore.hasTerminal(activeConnectionId.value)) {
              terminalStore.fitTerminal(activeConnectionId.value);
            }
            // 处理监控面板响应式状态
            handleMonitoringPanelResize();
          });
          resizeObserver.observe(terminalContainer);
        }
      });

      // 设置终端事件监听
      cleanupEvents = setupTerminalEvents();
      // 设置SSH失败事件监听
      cleanupSSHFailureEvents = setupSSHFailureHandler();

      // 添加会话切换事件监听
      window.addEventListener(EVENTS.TERMINAL_SESSION_CHANGE, handleSessionChange);
      window.addEventListener(EVENTS.TERMINAL_MONITORING_HIDE, handleCloseMonitoringPanel);
      // 移除重复的事件监听器 - 只保留 terminal-status-update 事件系统
      // window.addEventListener('terminal:refresh-status', handleTerminalRefreshStatus)

      // 添加终端主题更新监听器
      window.addEventListener(EVENTS.TERMINAL_THEME_UPDATE, handleTerminalThemeUpdate);

      // 添加终端设置更新监听器
      window.addEventListener(EVENTS.TERMINAL_SETTINGS_UPDATED, handleTerminalSettingsUpdate);

      // 监听监控面板的过渡动画，规避动画期间反复 fit 导致的闪烁
      const onMonitoringTransitionStart = e => {
        try {
          if (
            e?.target?.classList?.contains('terminal-monitoring-panel') &&
            (e.propertyName === 'width' || e.propertyName === 'transform')
          ) {
            isMonitoringPanelAnimating.value = true;
          }
        } catch (_) {}
      };
      const onMonitoringTransitionEnd = e => {
        try {
          if (
            e?.target?.classList?.contains('terminal-monitoring-panel') &&
            (e.propertyName === 'width' || e.propertyName === 'transform')
          ) {
            isMonitoringPanelAnimating.value = false;
            if (activeConnectionId.value && terminalStore.hasTerminal(activeConnectionId.value)) {
              // 在动画结束时做一次柔性适配，避免瞬时闪烁
              // 先将右侧区域宽度临时锁定为整数像素，避免亚像素导致的画布重采样
              try {
                const rightArea = document.querySelector(
                  '.terminal-content-wrapper.terminal-active .terminal-right-area'
                );
                if (rightArea) {
                  const rect = rightArea.getBoundingClientRect();
                  rightArea.style.width = `${Math.round(rect.width)}px`;
                  requestAnimationFrame(() => {
                    softRefitTerminal(activeConnectionId.value);
                    setTimeout(() => {
                      rightArea.style.width = '';
                    }, durations.value.motionFast);
                  });
                } else {
                  softRefitTerminal(activeConnectionId.value);
                }
              } catch (_) {
                softRefitTerminal(activeConnectionId.value);
              }
            }
          }
        } catch (_) {}
      };

      // 使用捕获阶段更稳妥地获取事件
      window.addEventListener('transitionstart', onMonitoringTransitionStart, true);
      window.addEventListener('transitionend', onMonitoringTransitionEnd, true);

      // 保存清理函数
      if (!cleanupEvents) cleanupEvents = () => {};
      const prevCleanup = cleanupEvents;
      cleanupEvents = () => {
        try {
          prevCleanup && prevCleanup();
        } catch (_) {}
        window.removeEventListener('transitionstart', onMonitoringTransitionStart, true);
        window.removeEventListener('transitionend', onMonitoringTransitionEnd, true);
      };

      // 如果有活动连接ID，则更新终端ID列表
      if (activeConnectionId.value) {
        if (!terminalIds.value.includes(activeConnectionId.value)) {
          terminalIds.value.push(activeConnectionId.value);
          debugLog(`更新终端ID列表: ${JSON.stringify(terminalIds.value)}`);
        }

        // 记录终端切换
        debugLog(`终端切换: undefined -> ${activeConnectionId.value}`);

        // 如果有DOM元素引用，尝试初始化终端
        if (terminalRefs.value[activeConnectionId.value]) {
          initTerminal(activeConnectionId.value, terminalRefs.value[activeConnectionId.value]);
        }

        // 延迟聚焦当前活动终端（组件挂载时）
        setTimeout(() => {
          if (terminalStore.hasTerminal(activeConnectionId.value)) {
            debugLog(`组件挂载后聚焦终端: ${activeConnectionId.value}`);
            focusTerminal(activeConnectionId.value);
          }
        }, durations.value.motionStandard);

        // 触发终端状态刷新事件，同步工具栏状态
        window.dispatchEvent(
          new CustomEvent(EVENTS.TERMINAL_REFRESH_STATUS, {
            detail: {
              sessionId: activeConnectionId.value,
              forceShow: true
            }
          })
        );
      }
    });

    onActivated(() => {
      debugLog('终端视图已激活');
      // 当组件激活时，自动聚焦当前活动终端
      if (activeConnectionId.value && terminalStore.hasTerminal(activeConnectionId.value)) {
        setTimeout(() => {
          debugLog(`组件激活后聚焦终端: ${activeConnectionId.value}`);
          focusTerminal(activeConnectionId.value);
        }, durations.value.motionMicro);
      }
    });

    onDeactivated(() => {
      debugLog('终端视图已失活');
      // 可以在这里添加失活时的处理逻辑
    });

    // 声明ResizeObserver变量
    let resizeObserver = null;

    // 声明清理函数变量
    let cleanupEvents = null;
    let cleanupSSHFailureEvents = null;

    // 处理终端管理事件
    const handleTerminalEvent = event => {
      const { command } = event.detail;

      if (command === 'resize-all') {
        terminalIds.value.forEach(id => {
          terminalStore.fitTerminal(id);
        });
      } else if (command === 'clear-active') {
        terminalStore.clearTerminal(activeConnectionId.value);
      } else if (command === 'focus') {
        terminalStore.focusTerminal(activeConnectionId.value);
      }
    };

    window.addEventListener(EVENTS.TERMINAL_COMMAND, handleTerminalEvent);

    // 在组件卸载时清理
    onBeforeUnmount(() => {
      debugLog('离开终端路由，隐藏终端');

      // 1. 首先停止所有键盘事件监听，防止在销毁过程中触发新的操作
      document.removeEventListener('keydown', handleGlobalKeydown, true);

      // 2. 清理自动完成服务，停止所有防抖任务
      terminalAutocompleteService.destroy();

      // 3. 安全地断开ResizeObserver
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }

      // 4. 清理所有状态管理器实例
      Object.keys(terminalStateManagers.value).forEach(termId => {
        cleanupTerminalStateManager(termId);
      });

      // 5. 移除其他事件监听
      if (cleanupEvents) cleanupEvents();
      if (cleanupSSHFailureEvents) cleanupSSHFailureEvents();
      if (cleanupMonitoringListener) cleanupMonitoringListener();
      if (resizeAfterAnimationTimer) {
        clearTimeout(resizeAfterAnimationTimer);
        resizeAfterAnimationTimer = null;
      }
      // 清理背景设置监听器
      if (bgChangeHandler) {
        window.removeEventListener(EVENTS.TERMINAL_BG_CHANGED, bgChangeHandler);
        bgChangeHandler = null;
      }
      // 清理工具栏事件监听
      removeToolbarListeners();
      window.removeEventListener(EVENTS.TERMINAL_COMMAND, handleTerminalEvent);
        window.removeEventListener(EVENTS.TERMINAL_SESSION_CHANGE, handleSessionChange);
        window.removeEventListener(EVENTS.TERMINAL_MONITORING_HIDE, handleCloseMonitoringPanel);
      window.removeEventListener(EVENTS.TERMINAL_THEME_UPDATE, handleTerminalThemeUpdate);
      window.removeEventListener(EVENTS.TERMINAL_SETTINGS_UPDATED, handleTerminalSettingsUpdate);

      // 保持会话不关闭，但停止特定组件的监听
      debugLog('终端组件卸载，保留会话');
    });

    // 移除重复的事件处理函数 - 统一使用 terminal-status-update 事件系统
    // 原 handleTerminalRefreshStatus 函数已删除，避免与 terminal-status-update 事件重复处理

    // 新会话事件的处理逻辑已由更上层的会话管理统一处理

    // SSH连接成功事件处理已移至 TerminalToolbar.vue 组件中统一管理
    // 这里移除了重复的死代码，避免混淆和潜在的冲突

    // 添加终端状态更新事件监听
    const setupTerminalEvents = () => {
      // 监听终端状态变化事件
      const handleTerminalStatusUpdate = event => {
        const { terminalId, status, isNew, sessionId } = event.detail;

        // 优化：只在关键状态变化时记录日志，减少噪音
        if (status === 'ready' || status === 'error') {
          debugLog(`收到终端状态刷新事件: ${terminalId}, ${status}, 新创建=${isNew || false}`);
        }

        // 根据状态更新UI
        if (status === 'initializing') {
          terminalInitializingStates.value[terminalId] = true;
          terminalConnectingStates.value[terminalId] = true;

          // 如果是新会话，确保添加到终端ID列表
          if (isNew && !terminalIds.value.includes(terminalId)) {
            terminalIds.value.push(terminalId);
            debugLog(`更新终端ID列表: ${JSON.stringify(terminalIds.value)}`);
          }
        } else if (status === 'ready') {
          // 终端已就绪
          terminalInitialized.value[terminalId] = true;
          terminalInitializingStates.value[terminalId] = false;
          terminalConnectingStates.value[terminalId] = false;

          // 脚本库同步不再在连接就绪时触发（保留认证成功触发）

          // 初始化AI面板状态
          aiPanelStore.initializeTerminal(terminalId);

          // 确保终端显示独立状态
          // 降低日志频率 - 状态独立确保是常规操作
          // debugLog(`正在确保终端[${terminalId}]的状态独立`)

          if (isNew) {
            debugLog(`强制显示终端: ${terminalId}`);
          }

          // 终端就绪后，尝试聚焦终端
          nextTick(() => {
            // 如果这是当前活动的终端，自动聚焦
            if (isActiveTerminal(terminalId)) {
              // 降低日志级别 - 聚焦是常规操作
              debugLog(`终端 ${terminalId} 就绪，自动聚焦`);

              // 先强制应用光标样式
              forceCursorStyle(terminalId);

              // 然后聚焦终端
              focusTerminal(terminalId);

              // 确保终端大小正确
              setTimeout(() => {
                resizeTerminal(terminalId);
                // 调整大小后再次确保光标样式正确
                forceCursorStyle(terminalId);
              }, 100);
            }
          });

          // 收到连接成功事件后，如果是当前激活的终端，更新标题等信息
          if (isActiveTerminal(terminalId) && sessionId) {
            // 获取连接信息
            let connection = null;
            if (userStore.isLoggedIn) {
              connection = connectionStore.getConnectionById(terminalId);
            } else {
              connection = localConnectionsStore.getConnectionById(terminalId);
            }

            if (connection) {
              // 更新标题和标签页标题
              title.value = `${connection.name || connection.host} - 终端`;
              const tabTitle = `${connection.username}@${connection.host}`;
              tabStore.updateTabTitle('/terminal', tabTitle);

              // 通知会话存储这是当前活动会话
              sessionStore.setActiveSession(terminalId);
              debugLog(`当前活动会话ID已更新: ${terminalId}`);
            }
          }
        } else if (status === 'error') {
          // 终端初始化失败
          terminalInitializingStates.value[terminalId] = false;
          terminalConnectingStates.value[terminalId] = false;
          terminalInitialized.value[terminalId] = false;

          // 直接清理本地状态
          delete terminalRefs.value[terminalId];

          // 从终端ID列表中移除
          terminalIds.value = terminalIds.value.filter(id => id !== terminalId);

          // 清理会话存储中的状态
          if (sessionStore.getSession(terminalId)) {
            sessionStore.setActiveSession(null);
          }

          // 仅在会话实际存在的情况下尝试断开连接
          if (terminalStore.hasTerminalSession(terminalId)) {
            terminalStore.disconnectTerminal(terminalId).finally(() => {
              // 导航回连接配置界面
              router.push('/connections/new');
            });
          } else {
            // 如果会话不存在，直接返回连接配置界面
            router.push('/connections/new');
          }
        } else if (status === 'cancelled') {
          terminalInitializingStates.value[terminalId] = false;
          terminalConnectingStates.value[terminalId] = false;
          terminalInitialized.value[terminalId] = false;

          delete terminalRefs.value[terminalId];
          terminalIds.value = terminalIds.value.filter(id => id !== terminalId);

          if (sessionStore.getSession(terminalId)) {
            sessionStore.setActiveSession(null);
          }

          if (tabStore.connectionFailed) {
            tabStore.connectionFailed(terminalId, '连接已取消', { status: 'cancelled' });
          }

          if (terminalId === activeConnectionId.value) {
            setTimeout(() => {
              if (router.currentRoute.value.path.includes('/terminal/')) {
                router.push('/connections/new');
              }
            }, 50);
          }
        }
      };

      // 添加SSH会话创建失败事件监听
      const handleSessionCreationFailed = event => {
        if (!event.detail) return;

        const { sessionId, terminalId, error, reason, status } = event.detail;
        debugLog(
          `收到SSH会话创建失败事件: 会话ID=${sessionId}, 终端ID=${terminalId || '未知'}, 错误=${error}, 状态=${status}`
        );

        // 如果有终端ID，清理相关状态
        if (terminalId) {
          // 清理终端状态
          terminalInitializingStates.value[terminalId] = false;
          terminalConnectingStates.value[terminalId] = false;
          terminalInitialized.value[terminalId] = false;

          // 清理引用
          if (terminalRefs.value[terminalId]) {
            terminalRefs.value[terminalId] = null;
            delete terminalRefs.value[terminalId];
          }

          // 从终端ID列表中移除
          terminalIds.value = terminalIds.value.filter(id => id !== terminalId);

          // 清理会话存储
          if (sessionStore.getSession(terminalId)) {
            sessionStore.setActiveSession(null);
          }

          // 如果是当前活动连接，显示错误并导航回连接配置界面
          if (terminalId === activeConnectionId.value) {
            // 提取简洁错误信息，避免重复
            let errorMessage = error || '服务器无响应';
            // 如果错误消息包含"SSH连接失败:"，则删除这个前缀
            errorMessage = errorMessage.replace(/SSH连接失败:\s*/g, '');

            // 翻译常见的英文错误消息为中文
            const errorTranslations = {
              'All configured authentication methods failed':
                '所有认证方式均失败，请检查用户名和密码',
              'Authentication failed': '认证失败，请检查用户名和密码',
              'Connection refused': '连接被拒绝，请检查服务器地址和端口',
              'Connection timed out': '连接超时，请检查网络和服务器状态',
              'Host not found': '无法找到主机，请检查服务器地址',
              'Network error': '网络错误，请检查网络连接',
              'Permission denied': '权限被拒绝，请检查用户名和密码',
              'Server unexpectedly closed connection': '服务器意外关闭连接',
              'Unable to connect': '无法连接到服务器',
              'Connection failed': '连接失败',
              'Invalid username or password': '用户名或密码错误'
            };

            // 寻找完全匹配的错误消息进行翻译
            if (errorTranslations[errorMessage]) {
              errorMessage = errorTranslations[errorMessage];
            } else {
              // 寻找部分匹配的错误消息
              for (const [engError, cnError] of Object.entries(errorTranslations)) {
                if (errorMessage.includes(engError)) {
                  errorMessage = cnError;
                  break;
                }
              }
            }

            const normalizedStatus = (status || '').toLowerCase();
            const suppressedPatterns = ['正常关闭', 'frontend_monitor_unsubscribed', 'user_close', '连接已关闭', '终端关闭'];
            const combinedReason = `${errorMessage} ${(reason || '').toLowerCase()}`;
            const matchesSuppression = suppressedPatterns.some(pattern =>
              combinedReason.toLowerCase().includes(pattern.toLowerCase())
            );
            const isExpectedClosure = normalizedStatus === 'cancelled' || matchesSuppression;
            const finalErrorMessage = isExpectedClosure ? '连接已取消' : errorMessage;

            // 错误消息由全局 ssh-connection-failed 事件处理统一弹出

            // 调用页签回滚逻辑
            if (tabStore.connectionFailed) {
              tabStore.connectionFailed(terminalId, finalErrorMessage, {
                status: isExpectedClosure ? 'cancelled' : normalizedStatus || 'failed'
              });
            }

            // 发送自定义事件，通知终端清理完成
            window.dispatchEvent(
              new CustomEvent('ssh-cleanup-done', {
                detail: { connectionId: terminalId }
              })
            );

            // 延迟导航，确保清理完成（如果页签回滚没有处理导航）
            setTimeout(() => {
              // 检查当前路由，如果还在终端页面则导航回连接配置
              if (router.currentRoute.value.path.includes('/terminal/')) {
                router.push('/connections/new');
              }
            }, 100);
          }
        }
      };

      // 添加事件监听
      window.addEventListener(EVENTS.TERMINAL_STATUS_UPDATE, handleTerminalStatusUpdate);
      window.addEventListener(EVENTS.SSH_SESSION_CREATION_FAILED, handleSessionCreationFailed);

      // 返回清理函数
      return () => {
        window.removeEventListener(EVENTS.TERMINAL_STATUS_UPDATE, handleTerminalStatusUpdate);
        window.removeEventListener(EVENTS.SSH_SESSION_CREATION_FAILED, handleSessionCreationFailed);
      };
    };

    // 监听URL路径和参数变化
    watch(
      () => [route.params.id, route.path],
      ([newId, newPath]) => {
        // 如果路径不是终端相关路径，直接返回
        if (!newPath.includes('/terminal')) {
          return;
        }

        // 获取最新的连接ID
        const currentId = activeConnectionId.value;

        // 如果路由参数不是ID，则使用会话存储ID
        const routeId = newId || sessionStore.getActiveSession();

        if (routeId && routeId !== currentId) {
          debugLog(`[Terminal] 会话切换: ${currentId} -> ${routeId}`);

          // 如果终端ID不在列表中，则添加
          if (!terminalIds.value.includes(routeId)) {
            terminalIds.value.push(routeId);
            debugLog(`[Terminal] 终端列表更新: ${terminalIds.value.length}个终端`);
          }

          // 通知会话存储更新活动会话
          sessionStore.setActiveSession(routeId);

          // 如果已有终端引用，尝试初始化
          if (terminalRefs.value[routeId]) {
            debugLog(`切换到终端: ${routeId}`);
            // 这里不需要再重复整个初始化流程，只需检查并确保显示
            if (!terminalInitialized.value[routeId]) {
              debugLog(`终端 ${routeId} 不存在，等待初始化完成`);
              initTerminal(routeId, terminalRefs.value[routeId]);
            }
          }
        }
      },
      { immediate: true }
    );

    // 自动完成处理函数
    const handleAutocompleteSelect = suggestion => {
      try {
        const activeId = activeConnectionId.value;
        if (!activeId) return;

        const terminal = terminalStore.getTerminal(activeId);
        if (!terminal) return;

        // 个性化：记录选择（带主机上下文）
        try {
          const sess = sessionStore.getSession(activeId) || {};
          personalizationService.onSelect(suggestion, {
            host: sess.host,
            username: sess.username,
            connectionId: activeId
          });
        } catch (_) {}

        terminalAutocompleteService.selectSuggestion(suggestion, terminal);
        autocomplete.value.visible = false;

        debugLog('选择自动完成建议:', suggestion.text);
      } catch (error) {
        log.error('处理自动完成选择失败:', error);
      }
    };

    const handleAutocompleteClose = () => {
      autocomplete.value.visible = false;
    };

    // 设置自动完成服务回调
    const setupAutocompleteCallbacks = () => {
      terminalAutocompleteService.setCallbacks({
        onSuggestionsUpdate: (suggestions, position) => {
          // 更新建议
          autocomplete.value.suggestions = suggestions;

          // 仅在位置有效时更新，避免被(0,0)等无效位置覆盖
          if (position && position.x > 4 && position.y > 4) {
            autocomplete.value.position = position;
          }

          // 控制可见性
          autocomplete.value.visible = suggestions.length > 0;

          // 个性化：记录曝光（带主机上下文）
          try {
            const activeId = activeConnectionId.value;
            const sess = activeId ? sessionStore.getSession(activeId) || {} : {};
            personalizationService.onShow(suggestions, {
              host: sess.host,
              username: sess.username,
              connectionId: activeId
            });
          } catch (_) {}

          // 位置保护：如果可见但当前位置无效，尝试立即纠正
          if (
            autocomplete.value.visible &&
            (!autocomplete.value.position ||
              !(autocomplete.value.position.x > 4 && autocomplete.value.position.y > 4))
          ) {
            updateAutocompletePosition();
          }
        }
      });
    };

    // 监听自动补全可见性，绑定/解绑事件保持位置同步
    watch(
      () => autocomplete.value.visible,
      visible => {
        // 清理旧的监听
        if (autocompleteEventDisposers.value && autocompleteEventDisposers.value.length) {
          autocompleteEventDisposers.value.forEach(d => {
            try {
              d && typeof d.dispose === 'function' && d.dispose();
            } catch (_) {}
          });
          autocompleteEventDisposers.value = [];
        }

        if (visible) {
          // 立即对齐
          updateAutocompletePosition();

          const id = activeConnectionId.value;
          if (id && terminalStore.hasTerminal(id)) {
            const terminal = terminalStore.getTerminal(id);
            if (terminal) {
              try {
                const d1 = terminal.onCursorMove(() => updateAutocompletePosition());
                const d2 = terminal.onScroll(() => updateAutocompletePosition());
                const d3 = terminal.onResize(() => updateAutocompletePosition());
                autocompleteEventDisposers.value.push(d1, d2, d3);
              } catch (_) {
                // 某些版本可能没有这些事件
              }
            }
          }
        }
      },
      { immediate: false }
    );

    // 监听用户登录状态变化，处理自动补全
    watch(
      () => userStore.isLoggedIn,
      (newLoginStatus, oldLoginStatus) => {
        // 优化：只在有意义的状态变化时记录日志，避免初始化期间的噪音
        if (oldLoginStatus !== undefined && oldLoginStatus !== newLoginStatus) {
          debugLog(`用户登录状态变化: ${oldLoginStatus} -> ${newLoginStatus}`);
        }

        // 如果用户登出，立即隐藏自动补全建议
        if (oldLoginStatus && !newLoginStatus) {
          debugLog('用户登出，隐藏自动补全建议');
          autocomplete.value.visible = false;
          autocomplete.value.suggestions = [];
          // 重置自动补全服务状态
          terminalAutocompleteService.reset();
        }

        // 如果用户登录，可以在这里做一些初始化工作
        if (!oldLoginStatus && newLoginStatus) {
          debugLog('用户登录，自动补全功能已启用');
        }
      },
      { immediate: false } // 不需要立即执行，只监听变化
    );

    // 键盘事件处理
    const handleGlobalKeydown = event => {
      if (autocompleteRef.value && autocomplete.value.visible) {
        // 检查是否是需要特殊处理的键
        if (
          event.key === 'ArrowUp' ||
          event.key === 'ArrowDown' ||
          event.key === 'Tab' ||
          event.key === 'Escape'
        ) {
          // 阻止事件传播和默认行为
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          // 调用自动补全组件的键盘处理
          autocompleteRef.value.handleKeydown(event);
          return false;
        }

        // 对于Enter键，调用处理函数，根据返回值决定是否阻止传播
        if (event.key === 'Enter') {
          const handled = autocompleteRef.value.handleKeydown(event);
          if (handled) {
            // 如果自动补全处理了回车键（有选中项），阻止事件传播
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return false;
          }
          // 如果没有选中项，让终端正常处理回车键
          return;
        }

        // 对于其他键，也调用处理函数但不阻止传播
        autocompleteRef.value.handleKeydown(event);
      }
    };

    // 添加SSH连接失败处理事件
    const setupSSHFailureHandler = () => {
      const handleSSHConnectionFailed = event => {
        if (!event.detail) return;

        const { connectionId, error, message, reason, status } = event.detail;
        debugLog(`收到全局SSH连接失败事件: ${connectionId}, 错误: ${error}, 状态: ${status}`);

        if (!connectionId) return;

        // 清理本地状态
        if (terminalInitialized.value[connectionId]) {
          delete terminalInitialized.value[connectionId];
        }
        if (terminalInitializingStates.value[connectionId]) {
          delete terminalInitializingStates.value[connectionId];
        }
        if (terminalConnectingStates.value[connectionId]) {
          delete terminalConnectingStates.value[connectionId];
        }
        if (terminalRefs.value[connectionId]) {
          delete terminalRefs.value[connectionId];
        }

        // 提取简洁错误信息，避免重复的"SSH连接失败"前缀
        let errorMessage = message || error || '服务器无响应';
        // 如果错误消息包含"SSH连接失败:"，则删除这个前缀
        errorMessage = errorMessage.replace(/SSH连接失败:\s*/g, '');

        // 翻译常见的英文错误消息为中文
        const errorTranslations = {
          'All configured authentication methods failed': '所有认证方式均失败，请检查用户名和密码',
          'Authentication failed': '认证失败，请检查用户名和密码',
          'Connection refused': '连接被拒绝，请检查服务器地址和端口',
          'Connection timed out': '连接超时，请检查网络和服务器状态',
          'Host not found': '无法找到主机，请检查服务器地址',
          'Network error': '网络错误，请检查网络连接',
          'Permission denied': '权限被拒绝，请检查用户名和密码',
          'Server unexpectedly closed connection': '服务器意外关闭连接',
          'Unable to connect': '无法连接到服务器',
          'Connection failed': '连接失败',
          'Invalid username or password': '用户名或密码错误'
        };

        // 寻找完全匹配的错误消息进行翻译
        if (errorTranslations[errorMessage]) {
          errorMessage = errorTranslations[errorMessage];
        } else {
          // 寻找部分匹配的错误消息
          for (const [engError, cnError] of Object.entries(errorTranslations)) {
            if (errorMessage.includes(engError)) {
              errorMessage = cnError;
              break;
            }
          }
        }

        const normalizedStatus = (status || '').toLowerCase();
        const baseForSuppression = `${errorMessage} ${(reason || '').toLowerCase()}`;
        const suppressedPatterns = ['正常关闭', 'frontend_monitor_unsubscribed', 'user_close', '连接已关闭', '终端关闭'];
        const matchesSuppression = suppressedPatterns.some(pattern =>
          baseForSuppression.toLowerCase().includes(pattern.toLowerCase())
        );
        const isExpectedClosure = normalizedStatus === 'cancelled' || matchesSuppression;

        const finalErrorMessage = isExpectedClosure ? '连接已取消' : errorMessage;

        if (!isExpectedClosure) {
          ElMessage.error(`连接失败: ${finalErrorMessage}`);
        } else {
          debugLog('连接已取消，跳过错误提示', {
            connectionId,
            reason: reason || errorMessage
          });
        }

        // 从终端ID列表中移除
        terminalIds.value = terminalIds.value.filter(id => id !== connectionId);

        // 清理会话存储
        if (sessionStore.getSession(connectionId)) {
          sessionStore.setActiveSession(null);
        }

        // 调用页签回滚逻辑
        if (tabStore.connectionFailed) {
          tabStore.connectionFailed(connectionId, finalErrorMessage, {
            status: isExpectedClosure ? 'cancelled' : normalizedStatus || 'failed'
          });
        }

        // 导航回连接配置界面（如果页签回滚没有处理导航）
        if (connectionId === activeConnectionId.value) {
          // 延迟导航，让页签回滚逻辑先执行
          setTimeout(() => {
            // 检查当前路由，如果还在终端页面则导航回连接配置
            if (router.currentRoute.value.path.includes('/terminal/')) {
              router.push('/connections/new');
            }
          }, 100);
        }
      };

      // 添加全局事件监听
      window.addEventListener('ssh-connection-failed', handleSSHConnectionFailed);

      // 返回清理函数
      return () => {
        window.removeEventListener('ssh-connection-failed', handleSSHConnectionFailed);
      };
    };

    // ===== AI输入栏相关方法 =====

    /**
     * 检查是否应该显示AI合并面板
     * @param {string} termId 终端ID
     * @returns {boolean} 是否显示AI合并面板
     */
    const shouldShowAICombinedPanel = termId => {
      if (!termId) return false;

      // 检查AI服务是否可用
      const aiService = getAIService();
      if (!aiService || !aiService.isEnabled) return false;

      // 检查终端是否已连接
      if (!terminalStore.hasTerminal(termId)) return false;

      // 仅在显式开启时显示（默认关闭，点击开启）
      return aiCombinedPanelStates.value[termId] === true;
    };

    /**
     * 获取AI服务实例
     * @returns {Object} AI服务实例
     */
    const getAIService = () => {
      try {
        return aiService;
      } catch (error) {
        log.error('获取AI服务失败', error);
        return null;
      }
    };

    /**
     * 处理AI流式输出开始
     * @param {Object} data 流式输出数据
     */
    const handleAIStreaming = data => {
      try {
        const termId = activeConnectionId.value;
        if (!termId) return;

        const { isStreaming, userMessage, partialContent } = data;

        // 更新流式状态
        aiStreamingStates.value[termId] = isStreaming;

        if (isStreaming) {
          // 开始流式输出时，显示面板并添加用户消息
          aiPanelStore.showPanel(termId);

          if (userMessage) {
            aiPanelStore.addMessage(termId, {
              type: 'user',
              content: userMessage,
              timestamp: Date.now()
            });
          }

          // 添加或更新AI响应消息（流式）
          const messages = aiPanelStore.getMessages(termId);
          const lastMessage = messages[messages.length - 1];

          if (lastMessage && lastMessage.type === 'assistant' && lastMessage.isStreaming) {
            // 更新现有的流式消息
            lastMessage.content = partialContent;
            lastMessage.timestamp = Date.now();
          } else {
            // 添加新的流式消息
            aiPanelStore.addMessage(termId, {
              type: 'assistant',
              content: partialContent,
              timestamp: Date.now(),
              isStreaming: true
            });
          }
        } else {
          // 流式输出结束，标记消息为完成
          const messages = aiPanelStore.getMessages(termId);
          const lastMessage = messages[messages.length - 1];

          if (lastMessage && lastMessage.isStreaming) {
            lastMessage.isStreaming = false;
          }
        }

        debugLog('AI流式输出处理', { termId, isStreaming, contentLength: partialContent?.length });
      } catch (error) {
        log.error('处理AI流式输出失败', { error: error.message });
      }
    };

    /**
     * 处理AI响应
     * @param {Object} response AI响应数据
     */
    const handleAIResponse = async response => {
      try {
        const termId = activeConnectionId.value;
        if (!termId) return;

        // 结束流式状态
        aiStreamingStates.value[termId] = false;

        // 使用AI服务的面板集成方法
        const aiService = getAIService();
        if (aiService) {
          await aiService.handleResponseForPanel(termId, response.userMessage, response);
        }

        log.info('AI响应已处理', response);
      } catch (error) {
        log.error('处理AI响应失败', { error: error.message });
      }
    };

    // 在终端显示AI响应的逻辑已迁移到面板集成中

    /**
     * 处理AI响应内容，为命令添加可执行的按钮
     * @param {string} content 原始内容
     * @param {string} terminalId 终端ID
     * @returns {Object} {content: 处理后的内容, commands: 找到的命令列表}
     */
    // 处理AI响应内容的方法已不再需要（面板负责渲染和交互）

    /**
     * 处理AI模式变化
     * @param {string} mode 新的AI模式
     */
    const handleAIModeChange = mode => {
      try {
        debugLog('AI模式切换', { mode });
      } catch (error) {
        log.error('处理AI模式变化失败', { error: error.message });
      }
    };

    /**
     * 处理AI输入框获得焦点
     */
    const handleAIInputFocus = () => {
      try {
        debugLog('AI输入框获得焦点');
        // 可以在这里添加焦点处理逻辑
      } catch (error) {
        log.error('处理AI输入框焦点失败', { error: error.message });
      }
    };

    /**
     * 处理AI输入框失去焦点
     */
    const handleAIInputBlur = () => {
      try {
        debugLog('AI输入框失去焦点');
        // 可以在这里添加失焦处理逻辑
      } catch (error) {
        log.error('处理AI输入框失焦失败', { error: error.message });
      }
    };

    /**
     * 处理执行命令
     * @param {Object} data 命令数据 {terminalId, command}
     */
    const handleExecuteCommand = data => {
      try {
        const { terminalId, command } = data;

        debugLog('执行命令', { terminalId, command });

        // 获取SSH会话ID
        const sessionId = terminalStore.sessions[terminalId];
        if (!sessionId) {
          log.error('未找到SSH会话ID', { terminalId });
          return;
        }

        // 通过SSH服务获取会话
        const session = sshService.sessions.get(sessionId);
        if (!session) {
          log.error('未找到SSH会话', { sessionId });
          return;
        }

        // 检查WebSocket连接状态
        if (!session.socket || session.socket.readyState !== WebSocket.OPEN) {
          log.error('SSH连接未就绪', { sessionId, readyState: session.socket?.readyState });
          return;
        }

        // 检查SSH连接状态
        if (session.connectionState?.status !== 'connected') {
          log.error('SSH会话未连接', { sessionId, status: session.connectionState?.status });
          return;
        }

        // 发送命令到SSH会话
        sshService._processTerminalInput(session, `${command}\r`);

        log.info('命令已发送到SSH会话', { terminalId, sessionId, command });
      } catch (error) {
        log.error('执行命令失败', { error: error.message });
      }
    };
    // ===== AI交互面板相关方法 =====

    // 旧的AI面板显示逻辑已被合并面板取代

    /**
     * 获取AI消息历史
     * @param {string} termId 终端ID
     * @returns {Array} AI消息列表
     */
    const getAIMessages = termId => {
      return aiPanelStore.getMessages(termId);
    };

    /**
     * 获取AI面板最大高度
     * @returns {number} 最大高度（像素）
     */
    const getAIPanelMaxHeight = () => {
      // 计算终端高度的50%作为最大高度
      const terminalHeight = window.innerHeight - 200; // 减去头部和其他UI元素
      return Math.max(aiPanelStore.globalSettings.minPanelHeight, Math.floor(terminalHeight * 0.5));
    };

    /**
     * 获取AI流式输出状态
     * @param {string} termId 终端ID
     * @returns {boolean} 是否正在流式输出
     */
    const getAIStreamingState = termId => {
      return aiStreamingStates.value[termId] || false;
    };

    /**
     * 设置AI合并面板引用
     * @param {Object} el DOM元素
     * @param {string} termId 终端ID
     */
    const setAICombinedPanelRef = (el, termId) => {
      if (el && termId) {
        aiCombinedPanelRefs.value[termId] = el;
      }
    };

    /**
     * 处理AI面板显示/隐藏切换
     * @param {boolean} visible 是否可见
     */
    const handleAIPanelToggle = visible => {
      const termId = activeConnectionId.value;
      if (termId) {
        if (visible) {
          aiPanelStore.showPanel(termId);
        } else {
          aiPanelStore.hidePanel(termId);
        }
        debugLog(`AI面板${visible ? '显示' : '隐藏'}`, { termId });
      }
    };

    /**
     * 处理清空AI历史
     */
    const handleAIClearHistory = () => {
      const termId = activeConnectionId.value;
      if (termId) {
        aiPanelStore.clearMessages(termId);
        debugLog('AI历史已清空', { termId });
      }
    };

    /**
     * 处理AI面板执行命令
     * @param {Object} data 命令数据
     */
    const handleAIExecuteCommand = data => {
      const { command, terminalId } = data;
      handleExecuteCommand({ terminalId, command });
    };

    /**
     * 处理AI面板编辑命令
     * @param {Object} data 命令数据
     */
    const handleAIEditCommand = data => {
      const { command, terminalId } = data;
      const termId = terminalId || activeConnectionId.value;

      if (!termId) {
        log.error('无法编辑命令：没有活动终端');
        return;
      }

      // 将编辑后的命令作为新消息添加到AI面板
      aiPanelStore.addMessage(termId, {
        type: 'user',
        content: `编辑后的命令：\n\`\`\`bash\n${command}\n\`\`\``,
        timestamp: Date.now()
      });

      debugLog('命令已编辑并添加到AI面板', { command, termId });
    };

    /**
     * 处理添加到脚本库
     * @param {Object} data 脚本数据
     */
    const handleAIAddToScripts = data => {
      const { command, name, description, language } = data;
      const termId = activeConnectionId.value;

      if (!termId) {
        log.error('无法添加脚本：没有活动终端');
        return;
      }

      // 添加成功消息到AI面板
      aiPanelStore.addMessage(termId, {
        type: 'system',
        content: `✅ 脚本 "${name}" 已成功添加到脚本库\n\n**命令：** \`${command}\`\n**描述：** ${description}`,
        timestamp: Date.now()
      });

      log.info('脚本已添加到脚本库', { name, command, description, language });
    };

    // AI面板高度调整状态
    const isAIPanelResizing = ref(false);

    /**
     * 处理AI面板高度变化开始
     */
    const handleAIPanelHeightChangeStart = () => {
      isAIPanelResizing.value = true;
    };

    /**
     * 处理AI面板高度变化结束
     */
    const handleAIPanelHeightChangeEnd = () => {
      isAIPanelResizing.value = false;
      // 调整结束后，调整终端大小
      const termId = activeConnectionId.value;
      if (termId) {
        nextTick(() => {
          resizeTerminal(termId);
        });
      }
    };

    /**
     * 处理AI面板高度变化
     * @param {number} height 新高度
     */
    const handleAIPanelHeightChange = height => {
      const termId = activeConnectionId.value;
      if (termId) {
        aiPanelStore.setPanelHeight(termId, height);
        // 只有在不是拖拽过程中才调整终端大小
        if (!isAIPanelResizing.value) {
          nextTick(() => {
            resizeTerminal(termId);
          });
        }
      }
    };

    return {
      terminalIds,
      title,
      status,
      isConnectingInProgress,
      terminalBg,
      terminalBgStyle,
      activeConnectionId,
      isActiveTerminal,
      getTerminalStyle,
      setTerminalRef,
      terminalInitialized,
      terminalHasBackground,
      sftpPanelWidth,
      updateTerminalIds,
      toggleSftpPanel,
      toggleMonitoringPanel,
      handleAIInputToggle,
      // 标签切换动画控制
      isTabSwitching,
      // 监控面板相关方法
      shouldShowMonitoringPanel,
      shouldAnimateMonitoring,
      shouldShowDesktopMonitoringPanel,
      shouldShowMobileMonitoringDrawer,
      isMonitoringPanelVisible,
      getMonitoringData,
      hideMonitoringPanel,
      hideMobileMonitoringDrawer,
      updateMobileDrawerVisibility,
      // 状态管理器相关方法
      getTerminalStateManager,
      cleanupTerminalStateManager,
      // 每个终端独立的火箭动画相关
      shouldShowTerminalConnectingAnimation,
      getTerminalRocketPhase,
      handleTerminalAnimationComplete,
      // 自动完成相关
      autocomplete,
      autocompleteRef,
      handleAutocompleteSelect,
      handleAutocompleteClose,
      // AI合并面板相关
      shouldShowAICombinedPanel,
      getAIService,
      handleAIResponse,
      handleAIStreaming,
      handleAIModeChange,
      handleAIInputFocus,
      handleAIInputBlur,
      handleExecuteCommand,
      getAIMessages,
      getAIPanelMaxHeight,
      getAIStreamingState,
      setAICombinedPanelRef,
      handleAIPanelToggle,
      handleAIClearHistory,
      handleAIExecuteCommand,
      handleAIEditCommand,
      handleAIAddToScripts,
      handleAIPanelHeightChange,
      handleAIPanelHeightChangeStart,
      handleAIPanelHeightChangeEnd,
      isMobile,
      // 自动完成 Teleport 目标
      autocompleteTeleportEl
    };
  }
};
</script>

<style scoped>
/* ===== 终端组件样式 - 使用系统设计令牌 ===== */

/* 通用主题切换过渡效果 - 使用系统令牌 */
.theme-transition {
  transition:
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    background var(--theme-transition-duration) var(--theme-transition-timing),
    border-color var(--theme-transition-duration) var(--theme-transition-timing),
    color var(--theme-transition-duration) var(--theme-transition-timing),
    box-shadow var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 终端主容器 */
.terminal-container {
  height: 100%;
  width: 100%;
  position: relative;
  background-color: var(--color-bg-page);
  overflow: hidden;
  /* 性能优化 */
  transform-style: preserve-3d;
  perspective: 1000px;
  will-change: contents;
  contain: layout size paint;
  /* 布局 */
  display: flex;
  flex-direction: column;
}

/* 终端包装器 */
.terminals-wrapper {
  position: relative;
  height: 100%;
  width: 100%;
  isolation: isolate; /* 创建堆叠上下文 */
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* 单个终端内容包装器 */
.terminal-content-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 1;
  /* 性能优化 */
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  /* 默认隐藏，只显示活动终端 */
  visibility: hidden;
  /* 渲染优化 */
  contain: strict;
  content-visibility: auto;
  contain-intrinsic-size: 100%;
  /* 布局 */
  display: flex;
  flex-direction: column;
}

/* 活动终端状态 */
.terminal-content-wrapper.terminal-active {
  z-index: 5;
  visibility: visible;
  pointer-events: auto;
  content-visibility: visible;
}

/* 非活动终端状态 */
.terminal-content-wrapper:not(.terminal-active) {
  z-index: 1;
  pointer-events: none;
}

/* 终端工具栏 */
.terminal-individual-toolbar {
  flex-shrink: 0;
  z-index: 10;
  height: var(--layout-toolbar-height); /* 使用终端工具栏专用高度令牌 */
  color: var(--color-text-primary);
  transition:
    color var(--theme-transition-duration) var(--theme-transition-timing),
    background-color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 终端主体区域 */
:deep(.terminal-main-area) {
  flex: 1;
  display: flex;
  flex-direction: row;
  height: calc(100% - var(--layout-toolbar-height)); /* 使用终端工具栏专用高度令牌 */
  overflow: hidden;
}

/* 监控面板 */
:deep(.terminal-monitoring-panel) {
  flex-shrink: 0;
  z-index: 9;
  width: 320px; /* 监控面板固定宽度 */
  max-width: 35vw; /* 响应式最大宽度 */
  height: 100%;
  overflow: hidden;
  border-right: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  /* 使用系统主题过渡令牌（边框+文字颜色） */
  transition:
    border-color var(--theme-transition-duration) var(--theme-transition-timing),
    color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 右侧内容区域：终端 + AI输入栏 */
:deep(.terminal-right-area) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  color: var(--color-text-primary);
  transition:
    color var(--theme-transition-duration) var(--theme-transition-timing),
    background-color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 有监控面板时的右侧区域 */
:deep(.terminal-right-area.with-monitoring-panel) {
  width: calc(100% - 320px); /* 减去监控面板宽度（不再动画，降低重排） */
}

/* 终端内容填充区域 */

:deep(.terminal-content-padding) {
  flex: 1;
  box-sizing: border-box;
  width: 100%;
  position: relative;
  overflow: visible;
  padding: 0;
  min-height: 0; /* 允许flex收缩 */
}

/* AI合并面板区域 */
:deep(.terminal-ai-combined-area) {
  flex-shrink: 0;
  height: auto;
  background: transparent;
  z-index: 10;
  overflow: visible;
  order: 3; /* AI合并面板在最下方 */
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
}

/* ===== AI合并面板显隐过渡 ===== */
/* 入场/离场动画：轻微上滑 + 淡入淡出 */
:deep(.ai-combined-toggle-enter-active),
:deep(.ai-combined-toggle-leave-active) {
  transition:
    opacity var(--transition-slow),
    transform var(--transition-slow);
}

/* ===== 监控面板显隐过渡（transform-only，避免宽度动画） ===== */
:deep(.monitoring-toggle-enter-active),
:deep(.monitoring-toggle-leave-active) {
  transition:
    opacity var(--transition-slow),
    transform var(--transition-slow);
}

:deep(.monitoring-toggle-enter-from),
:deep(.monitoring-toggle-leave-to) {
  opacity: 0;
  transform: translateX(-12px);
}

:deep(.monitoring-toggle-enter-to),
:deep(.monitoring-toggle-leave-from) {
  opacity: 1;
  transform: translateX(0);
}

:deep(.ai-combined-toggle-enter-from),
:deep(.ai-combined-toggle-leave-to) {
  opacity: 0;
  transform: translateY(12px);
}

:deep(.ai-combined-toggle-enter-to),
:deep(.ai-combined-toggle-leave-from) {
  opacity: 1;
  transform: translateY(0);
}

/* ===== 响应式设计 ===== */

/* 平板和移动端 */
@media (max-width: 768px) {
  :deep(.terminal-main-area) {
    flex-direction: row; /* 保持水平布局 */
  }

  :deep(.terminal-monitoring-panel) {
    display: none; /* 移动端隐藏侧边监控面板，使用抽屉模式 */
  }

  :deep(.terminal-right-area) {
    width: 100%; /* 移动端占满全宽 */
    height: 100%;
  }

  :deep(.terminal-right-area.with-monitoring-panel) {
    width: 100%; /* 移动端抽屉模式，占满全宽 */
    height: 100%;
  }

  :deep(.terminal-ai-combined-area) {
    margin: 0 var(--spacing-xs);
  }
}

/* 小屏幕手机 */
@media (max-width: 480px) {
  :deep(.terminal-monitoring-panel) {
    display: none; /* 小屏幕隐藏监控面板 */
  }

  :deep(.terminal-right-area.with-monitoring-panel) {
    height: 100%; /* 小屏幕占满全高 */
  }

  :deep(.terminal-ai-combined-area) {
    margin: 0;
  }
}

/* ===== 终端内容区域 ===== */

/* 终端内容容器 */
.terminal-content {
  height: calc(100% - var(--spacing-xl)); /* 减去底部间距 */
  width: calc(100% - var(--spacing-md)); /* 减去右侧间距 */
  position: relative;
  margin: var(--spacing-md) 0 var(--spacing-md) var(--spacing-md); /* 使用系统间距令牌 */
  box-sizing: border-box;
  overflow: hidden;
}

/* Reduce motion: disable transitions and animations when user prefers reduced motion */
@media (prefers-reduced-motion: reduce) {
  .monitoring-toggle-enter-active,
  .monitoring-toggle-leave-active,
  .ai-combined-toggle-enter-active,
  .ai-combined-toggle-leave-active,
  .terminal-right-area,
  .terminal-monitoring-panel,
  .connecting-overlay {
    transition: none !important;
    animation: none !important;
  }
}
/* ===== 连接状态覆盖层 ===== */

/* 连接中覆盖层 */
.connecting-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: transparent;
  transition: opacity var(--transition-slow); /* 使用系统过渡令牌 */
}

/* 淡出状态 */
.connecting-overlay.fade-out {
  opacity: 0;
  pointer-events: none;
}

/* ===== XTerm.js 样式优化 ===== */

/* XTerm 主容器 */
:deep(.xterm) {
  height: 100% !important;
  width: 100% !important;
  position: relative;
  box-sizing: border-box;

  /* 字体渲染优化 - 确保所有渲染器下一致 */
  font-smooth: always;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;

  /* 防止字体渲染闪烁 */
  font-display: swap;

  /* 柔性适配时的轻微淡入过渡，掩盖画布重绘 */
  transition: opacity var(--motion-tiny) var(--theme-transition-timing);
}

/* XTerm 视口 */
:deep(.xterm-viewport) {
  overflow-y: auto !important;
  overflow-x: hidden;
}

/* 统一让 xterm 容器/视口/屏幕/行背景透明，配合 allowTransparency 与主题透明展示底图 */
:deep(.xterm),
:deep(.xterm-viewport),
:deep(.xterm-screen),
:deep(.xterm-rows) {
  background: transparent !important;
  background-color: transparent !important;
}

/* XTerm 滚动条样式 - 使用系统设计令牌 */
:deep(.xterm-viewport::-webkit-scrollbar) {
  width: 5px; /* 细滚动条 */
  height: 0; /* 隐藏横向滚动条 */
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background-color: var(--color-border-default);
  border-radius: var(--radius-lg); /* 使用系统圆角令牌 */
  border: none;
  transition: background-color var(--transition-fast); /* 使用系统过渡令牌 */
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background-color: var(--color-border-dark);
}

/* XTerm 屏幕 */
:deep(.xterm-screen) {
  width: 100%;
  height: 100%;
  position: relative; /* 保障子 canvas 绝对定位的参照 */
}

/* 保障 xterm 的多层 canvas 重叠而非竖向堆叠（应对外部样式/构建偶发覆盖） */
:deep(.xterm-screen canvas) {
  position: absolute !important;
  left: 0 !important;
  top: 0 !important;
}

/* 确保光标样式立即生效，避免闪烁 */
:deep(.xterm-cursor-layer) {
  transition: none !important;
}

:deep(.xterm-cursor) {
  transition: none !important;
}

/* 强制应用光标样式 */
:deep(.xterm.focus .xterm-cursor) {
  transition: none !important;
}

/* AI命令链接样式 */
:deep(.xterm-decoration-overview-ruler) {
  display: none;
}

/* 终端中的链接样式 */
:deep(.xterm-link) {
  color: var(--color-primary) !important;
  font-style: italic !important;
  text-decoration: none !important;
  cursor: pointer !important;
  transition: all 0.2s ease !important;
}

:deep(.xterm-link:hover) {
  text-decoration: underline !important;
  color: var(--color-primary-hover) !important;
}

/* 确保AI命令链接有正确的样式 */
:deep(.xterm-rows .xterm-link) {
  background: transparent !important;
}

/* ===== 渲染器特定优化 ===== */

/* Canvas渲染器优化 */
:deep(.xterm-canvas) {
  /* 确保Canvas渲染清晰 */
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;

  /* 优化Canvas性能 */
  will-change: transform;
}

/* DOM渲染器优化 */
:deep(.xterm-rows) {
  /* 确保DOM渲染的字体清晰 */
  font-smooth: always;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;

  /* 优化文本渲染 */
  text-rendering: optimizeLegibility;
  font-feature-settings: 'liga' 0; /* 禁用连字以保持一致性 */
}

/* 字符网格对齐优化 */
:deep(.xterm-char-measure-element) {
  /* 确保字符测量准确 */
  font-variant-ligatures: none;
  font-feature-settings: 'liga' 0;
}

/* 光标渲染优化 */
:deep(.xterm-cursor-layer) {
  /* 确保光标在所有渲染器下都清晰 */
  image-rendering: pixelated;
  image-rendering: -moz-crisp-edges;
  image-rendering: crisp-edges;
}

/* 选择高亮优化 */
:deep(.xterm-selection) {
  /* 确保选择高亮在所有渲染器下一致 */
  opacity: 0.3;
  mix-blend-mode: multiply;
}

/* ===== AI合并面板区域样式 ===== */
/* 确保AI合并面板不影响终端布局 */
.terminal-right-area {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.terminal-content-padding {
  flex: 1;
  overflow: hidden;
  order: 1; /* 终端内容在最上方 */
}

/* 移动端AI合并面板适配 */
@media (max-width: 768px) {
  .terminal-ai-combined-area {
    margin: 0 var(--spacing-xs);
  }
}
</style>
