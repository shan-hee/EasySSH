<template>
  <Modal 
    v-model:visible="isVisible" 
    title="注销所有设备" 
    customClass="logout-devices-modal"
    :hide-footer="true"
    @close="handleClose"
  >
    <div class="logout-devices-container">
      <div class="warning-icon">
        <svg viewBox="0 0 24 24" width="50" height="50">
          <path fill="#ff9800" d="M1,21h22L12,2L1,21z M13,18h-2v-2h2V18z M13,14h-2V8h2V14z" />
        </svg>
      </div>
      <div class="logout-title">
        确定要注销所有设备吗？
      </div>
      <div class="logout-description">
        此操作将立即中断您在所有设备上的会话，包括当前设备。您需要重新登录才能继续使用系统。其他设备的会话可能在30分钟内逐步失效。
      </div>
      <div class="btn-container">
        <button class="btn btn-cancel" @click="handleClose">取消</button>
        <button class="btn btn-danger" @click="confirmLogout">
          {{ isLoggingOut ? '处理中...' : '确认注销' }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<script>
import { defineComponent, ref, computed, watch } from 'vue'
import Modal from '@/components/common/Modal.vue'
import { useUserStore } from '@/store/user'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'

export default defineComponent({
  name: 'LogoutAllDevicesModal',
  components: {
    Modal
  },
  props: {
    visible: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:visible', 'logout-complete', 'logout-cancelled'],
  setup(props, { emit }) {
    const router = useRouter()
    const userStore = useUserStore()
    const isLoggingOut = ref(false)
    
    // 使用计算属性处理双向绑定
    const isVisible = computed({
      get: () => props.visible,
      set: (value) => emit('update:visible', value)
    })
    
    // 确认注销所有设备
    const confirmLogout = async () => {
      isLoggingOut.value = true
      
      try {
        await userStore.logoutAllDevices()
        ElMessage.success('已成功注销所有设备')
        emit('logout-complete')
        
        // 关闭弹窗并返回首页
        handleClose()
        router.push('/')
      } catch (error) {
        console.error('注销所有设备失败:', error)
        ElMessage.error('注销所有设备时发生错误')
      } finally {
        isLoggingOut.value = false
      }
    }
    
    // 关闭弹窗
    const handleClose = () => {
      isVisible.value = false
      emit('logout-cancelled')
    }
    
    return {
      isVisible,
      isLoggingOut,
      confirmLogout,
      handleClose
    }
  }
})
</script>

<style scoped>
.logout-devices-container {
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #fff;
}

.warning-icon {
  margin-bottom: 15px;
}

.logout-title {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 15px;
  text-align: center;
}

.logout-description {
  font-size: 14px;
  color: #aaa;
  text-align: center;
  margin-bottom: 25px;
  line-height: 1.5;
}

.btn-container {
  display: flex;
  justify-content: center;
  gap: 15px;
  width: 100%;
}

.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  font-weight: bold;
  cursor: pointer;
  min-width: 100px;
  height: 36px;
}

.btn-cancel {
  background-color: #3f3f3f;
  color: #fff;
}

.btn-danger {
  background-color: #f44336;
  color: #fff;
}

.btn-danger:hover {
  background-color: #d32f2f;
}

.btn-cancel:hover {
  background-color: #505050;
}

.btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style> 