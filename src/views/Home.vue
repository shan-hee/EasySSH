<template>
  <div class="home-container">
    <div class="hero-section">
      <div class="hero-content">
        <h1 class="title">EasySSH</h1>
        <p class="subtitle">现代化的SSH客户端，让远程服务器管理更简单</p>
        <div class="action-buttons">
          <button class="btn btn-primary" @click="getStarted">
            开始使用 <span class="icon">→</span>
          </button>
          <button class="btn btn-secondary" @click="learnMore">
            了解更多 <span class="icon">i</span>
          </button>
        </div>
      </div>
    </div>

    <div class="features-section">
      <h2 class="section-title">强大功能，简单操作</h2>

      <div class="feature-grid">
        <div class="feature-card" v-for="feature in features" :key="feature.title">
          <div class="feature-icon">
            <span class="icon">{{ feature.icon }}</span>
          </div>
          <h3>{{ feature.title }}</h3>
          <p>{{ feature.description }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

export default {
  name: 'HomePage',
  setup() {
    const router = useRouter()
    const currentYear = computed(() => new Date().getFullYear())

    const features = ref([
      {
        icon: '🔒',
        title: '安全连接',
        description: '支持多种加密协议，确保数据传输安全可靠，保障远程连接的私密性与完整性'
      },
      {
        icon: '⚡',
        title: '高性能',
        description: '极速响应，支持多会话并行管理，低延迟连接确保命令实时执行，提升工作效率'
      },
      {
        icon: '🛠️',
        title: '丰富功能',
        description: '支持文件传输、端口转发、会话保存、命令记录等多种专业功能，满足各类远程管理需求'
      },
      {
        icon: '🖥️',
        title: '集中管理',
        description: '轻松管理多台服务器，分组组织，快速搜索，让服务器管理更加系统化、条理化'
      },
      {
        icon: '📝',
        title: '命令管理',
        description: '保存常用命令，快速执行历史命令，大幅提高工作效率和操作准确性'
      },
      {
        icon: '🔄',
        title: '跨平台支持',
        description: '支持Windows、macOS和Linux，提供一致的使用体验，随时随地管理您的服务器'
      }
    ])

    // 导航方法
    const getStarted = () => {
      router.push('/dashboard')
    }

    const learnMore = () => {
      // 滚动到功能区
      document.querySelector('.features-section').scrollIntoView({
        behavior: 'smooth'
      })
    }

    return {
      currentYear,
      features,
      getStarted,
      learnMore
    }
  }
}
</script>

<style>
.home-container {
  width: 100%;
  min-height: 100vh;
}

.hero-section {
  min-height: 80vh;
  padding: 2rem;
  background: linear-gradient(135deg, #c2e0ff, #a2d2ff);
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
}

.hero-content {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
}

.title {
  font-size: 3.5rem;
  margin: 0.5rem 0;
  color: #0066cc;
}

.subtitle {
  font-size: 1.5rem;
  margin-bottom: 2rem;
  color: #333;
  max-width: 80%;
  margin-left: auto;
  margin-right: auto;
}

.action-buttons {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-top: 2rem;
  flex-wrap: wrap;
}

.btn {
  padding: 12px 24px;
  font-size: 16px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  border: none;
  transition: all 0.3s ease;
}

.btn-primary {
  background-color: #1890ff;
  color: white;
}

.btn-primary:hover {
  background-color: #096dd9;
}

.btn-secondary {
  background-color: white;
  color: #333;
  border: 1px solid #ddd;
}

.btn-secondary:hover {
  background-color: #f5f5f5;
}

.icon {
  margin-left: 5px;
}

.features-section {
  padding: 4rem 2rem;
  background-color: white;
}

.section-title {
  text-align: center;
  margin-bottom: 3rem;
  font-size: 2rem;
  color: #333;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 2rem;
  margin: 0 auto;
  max-width: 1200px;
}

.feature-card {
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  padding: 2rem;
  text-align: center;
  transition: transform 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-5px);
}

.feature-icon {
  font-size: 2.5rem;
  margin-bottom: 1rem;
  color: #1890ff;
}

.feature-card h3 {
  margin-bottom: 1rem;
  color: #333;
}

.feature-card p {
  color: #666;
  line-height: 1.6;
}
</style>