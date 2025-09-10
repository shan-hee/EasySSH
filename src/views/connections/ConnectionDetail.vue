<template>
  <div class="connection-detail-container">
    <div class="connection-header">
      <div class="connection-info">
        <el-button
          class="back-button"
          link
          @click="goBack"
        >
          <el-icon><arrow-left /></el-icon> 返回
        </el-button>
        <h1>{{ connection ? connection.name : '连接详情' }}</h1>
        <el-tag
          v-if="isConnected"
          type="success"
          size="small"
        >
          已连接
        </el-tag>
        <el-tag
          v-else
          type="info"
          size="small"
        >
          未连接
        </el-tag>
      </div>
      <div class="connection-actions">
        <el-button
          v-if="!isConnected"
          type="primary"
          @click="connect"
        >
          <el-icon><connection /></el-icon>连接
        </el-button>
        <el-button
          v-else
          type="danger"
          @click="disconnect"
        >
          <el-icon><circle-close /></el-icon>断开连接
        </el-button>
        <el-button @click="editConnection">
          <el-icon><edit /></el-icon>编辑
        </el-button>
      </div>
    </div>

    <!-- 终端区域 -->
    <div class="terminal-container">
      <div class="terminal-header">
        <div class="terminal-tabs">
          <div
            v-for="(tab, index) in tabs"
            :key="index"
            :class="['terminal-tab', { active: activeTab === index }]"
            @click="switchTab(index)"
          >
            <span>{{ tab.title }}</span>
            <el-icon
              v-if="tabs.length > 1"
              class="close-icon"
              @click.stop="closeTab(index)"
            >
              <close />
            </el-icon>
          </div>
          <div
            class="add-tab"
            @click="addTab"
          >
            <el-icon><plus /></el-icon>
          </div>
        </div>
        <div class="terminal-controls">
          <el-tooltip
            content="全屏"
            placement="top"
          >
            <el-button
              circle
              @click="toggleFullscreen"
            >
              <el-icon><full-screen /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip
            content="设置"
            placement="top"
          >
            <el-button
              circle
              @click="showSettings"
            >
              <el-icon><setting /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>
      <div class="terminal-content">
        <div
          ref="terminalElement"
          class="terminal"
        />
      </div>
    </div>

    <!-- 连接信息底栏 -->
    <div class="connection-footer">
      <div class="footer-item">
        <span class="item-label">主机:</span>
        <span>{{ connection?.host }}</span>
      </div>
      <div class="footer-item">
        <span class="item-label">端口:</span>
        <span>{{ connection?.port }}</span>
      </div>
      <div class="footer-item">
        <span class="item-label">用户:</span>
        <span>{{ connection?.username }}</span>
      </div>
      <div class="footer-item">
        <span class="item-label">延迟:</span>
        <span>{{ latency }}ms</span>
      </div>
      <div class="footer-item">
        <span class="item-label">上线时间:</span>
        <span>{{ uptime }}</span>
      </div>
    </div>

    <!-- 终端设置对话框 -->
    <el-dialog
      v-model="settingsVisible"
      title="终端设置"
      width="500px"
    >
      <el-form label-position="top">
        <el-form-item label="字体大小">
          <el-slider
            v-model="terminalSettings.fontSize"
            :min="8"
            :max="24"
            :step="1"
            :marks="{ 8: '小', 16: '中', 24: '大' }"
          />
        </el-form-item>
        <el-form-item label="字体">
          <el-select
            v-model="terminalSettings.fontFamily"
            style="width: 100%"
          >
            <el-option
              label="Consolas"
              value="Consolas"
            />
            <el-option
              label="Monaco"
              value="Monaco"
            />
            <el-option
              label="Courier New"
              value="'Courier New'"
            />
            <el-option
              label="Droid Sans Mono"
              value="'Droid Sans Mono'"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="颜色主题">
          <el-select
            v-model="terminalSettings.theme"
            style="width: 100%"
          >
            <el-option
              label="暗色"
              value="dark"
            />
            <el-option
              label="亮色"
              value="light"
            />
            <el-option
              label="复古"
              value="retro"
            />
            <el-option
              label="黑客风格"
              value="hacker"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="光标样式">
          <el-select
            v-model="terminalSettings.cursorStyle"
            style="width: 100%"
          >
            <el-option
              label="块状"
              value="block"
            />
            <el-option
              label="下划线"
              value="underline"
            />
            <el-option
              label="竖线"
              value="bar"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-switch
            v-model="terminalSettings.cursorBlink"
            active-text="光标闪烁"
          />
        </el-form-item>
        <el-form-item>
          <el-switch
            v-model="terminalSettings.scrollback"
            active-text="启用回滚"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="resetSettings">恢复默认</el-button>
          <el-button
            type="primary"
            @click="applySettings"
          >应用</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Connection,
  CircleClose,
  Edit,
  Plus,
  Close,
  FullScreen,
  Setting,
  ArrowLeft
} from '@element-plus/icons-vue';

export default {
  name: 'ConnectionDetail',
  components: {
    Connection,
    CircleClose,
    Edit,
    Plus,
    Close,
    FullScreen,
    Setting,
    ArrowLeft
  },
  setup() {
    const _route = useRoute();
    const router = useRouter();
    const terminalElement = ref(null);

    // 连接状态
    const isConnected = ref(false);
    const latency = ref('--');
    const connectionStartTime = ref(null);

    // 连接信息 (模拟数据)
    const connection = reactive({
      id: 1,
      name: '开发服务器',
      host: 'dev.example.com',
      port: 22,
      username: 'developer',
      authType: 'password',
      group: 'development',
      favorite: true
    });

    // 终端标签页
    const tabs = ref([{ title: 'Terminal 1' }]);
    const activeTab = ref(0);

    // 终端设置
    const settingsVisible = ref(false);
    const terminalSettings = reactive({
      fontSize: 14,
      fontFamily: 'Consolas',
      theme: 'dark',
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: true
    });

    // 计算上线时间
    const uptime = computed(() => {
      if (!connectionStartTime.value) return '--';

      const now = new Date();
      const diff = Math.floor((now - connectionStartTime.value) / 1000);

      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;

      if (hours > 0) {
        return `${hours}时${minutes}分${seconds}秒`;
      } else if (minutes > 0) {
        return `${minutes}分${seconds}秒`;
      } else {
        return `${seconds}秒`;
      }
    });

    // 模拟连接
    const connect = () => {
      isConnected.value = true;
      connectionStartTime.value = new Date();
      latency.value = Math.floor(Math.random() * 50) + 10;

      // 这里应该有初始化终端和建立SSH连接的代码
      // 模拟随机延迟
      const interval = setInterval(() => {
        if (isConnected.value) {
          latency.value = Math.floor(Math.random() * 50) + 10;
        } else {
          clearInterval(interval);
        }
      }, 5000);
    };

    // 断开连接
    const disconnect = () => {
      isConnected.value = false;
      connectionStartTime.value = null;
      latency.value = '--';

      // 这里应该有断开SSH连接的代码
    };

    // 返回连接列表
    const goBack = () => {
      router.push({ name: 'ConnectionList' });
    };

    // 编辑连接
    const editConnection = () => {
      // 跳转到编辑页面或打开编辑对话框
    };

    // 终端标签页相关
    const switchTab = index => {
      activeTab.value = index;
      // 这里应该有切换终端实例的代码
    };

    const addTab = () => {
      tabs.value.push({ title: `Terminal ${tabs.value.length + 1}` });
      activeTab.value = tabs.value.length - 1;
      // 这里应该有创建新终端实例的代码
    };

    const closeTab = index => {
      // 如果关闭的是当前活动标签，需要切换到临近标签
      if (activeTab.value === index) {
        activeTab.value = index === 0 ? 0 : index - 1;
      } else if (activeTab.value > index) {
        // 如果关闭的标签在当前活动标签之前，需要调整活动标签索引
        activeTab.value--;
      }

      tabs.value.splice(index, 1);
      // 这里应该有销毁终端实例的代码
    };

    // 终端设置相关
    const showSettings = () => {
      settingsVisible.value = true;
    };

    const applySettings = () => {
      settingsVisible.value = false;
      // 这里应该有应用终端设置的代码
    };

    const resetSettings = () => {
      Object.assign(terminalSettings, {
        fontSize: 14,
        fontFamily: 'Consolas',
        theme: 'dark',
        cursorStyle: 'block',
        cursorBlink: true,
        scrollback: true
      });
    };

    // 全屏模式
    const toggleFullscreen = () => {
      // 切换终端全屏模式
    };

    onMounted(() => {
      // 根据路由参数加载连接信息

      // 这里应该有加载连接详情的代码
      // 以及初始化终端的代码
    });

    onUnmounted(() => {
      // 确保断开连接
      if (isConnected.value) {
        disconnect();
      }

      // 销毁终端实例
    });

    return {
      terminalElement,
      connection,
      isConnected,
      latency,
      uptime,
      tabs,
      activeTab,
      settingsVisible,
      terminalSettings,
      goBack,
      connect,
      disconnect,
      editConnection,
      switchTab,
      addTab,
      closeTab,
      showSettings,
      applySettings,
      resetSettings,
      toggleFullscreen
    };
  }
};
</script>

<style scoped>
.connection-detail-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.connection-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid var(--el-border-color);
}

.connection-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.back-button {
  margin-right: 10px;
}

.connection-actions {
  display: flex;
  gap: 10px;
}

.terminal-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--el-color-info-light-9);
  border-bottom: 1px solid var(--el-border-color);
}

.terminal-tabs {
  display: flex;
  overflow-x: auto;
  max-width: calc(100% - 100px);
}

.terminal-tab {
  display: flex;
  align-items: center;
  padding: 8px 15px;
  background-color: var(--el-color-info-light-8);
  border-right: 1px solid var(--el-border-color);
  cursor: pointer;
  white-space: nowrap;
}

.terminal-tab.active {
  background-color: var(--el-color-white);
  font-weight: bold;
}

.close-icon {
  margin-left: 8px;
  font-size: 12px;
}

.add-tab {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  color: var(--el-color-primary);
}

.terminal-controls {
  display: flex;
  gap: 8px;
  padding: 0 10px;
}

.terminal-content {
  flex: 1;
  background-color: #000;
  overflow: hidden;
  padding: 20px;
}

.terminal {
  width: 100%;
  height: 100%;
}

.connection-footer {
  display: flex;
  gap: 20px;
  padding: 8px 15px;
  background-color: var(--el-color-info-light-9);
  border-top: 1px solid var(--el-border-color);
  font-size: 13px;
}

.footer-item {
  display: flex;
}

.item-label {
  color: var(--el-text-color-secondary);
  margin-right: 5px;
}
</style>
