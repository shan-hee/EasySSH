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
        <div v-for="feature in features" :key="feature.title" class="feature-card">
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
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';

export default {
  name: 'HomePage',
  setup() {
    const router = useRouter();
    const currentYear = computed(() => new Date().getFullYear());

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
        description:
          '支持文件传输、端口转发、会话保存、命令记录等多种专业功能，满足各类远程管理需求'
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
    ]);

    // 导航方法
    const getStarted = () => {
      router.push('/dashboard');
    };

    const learnMore = () => {
      // 滚动到功能区
      document.querySelector('.features-section').scrollIntoView({
        behavior: 'smooth'
      });
    };

    return {
      currentYear,
      features,
      getStarted,
      learnMore
    };
  }
};
</script>

<style scoped>
.home-container {
  width: 100%;
  min-height: 100vh;
}

.hero-section {
  min-height: 80vh;
  padding: var(--spacing-2xl);
  background: linear-gradient(135deg, var(--color-primary-lighter), var(--color-primary-light));
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
}

.hero-content {
  max-width: 800px;
  margin: 0 auto;
  padding: var(--spacing-2xl);
}

.title {
  font-size: 3.5rem;
  margin: 0.5rem 0;
  color: var(--color-primary);
}

.subtitle {
  font-size: var(--font-size-lg);
  margin-bottom: var(--spacing-2xl);
  color: var(--color-text-primary);
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
  background-color: var(--color-primary);
  color: var(--color-bg-container);
}

.btn-primary:hover {
  background-color: var(--color-primary-hover);
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
  color: var(--color-text-primary);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 2rem;
  margin: 0 auto;
  max-width: 1200px;
}

.feature-card {
  background-color: var(--color-bg-container);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-base);
  padding: var(--spacing-2xl);
  text-align: center;
  transition: transform var(--transition-base) ease;
}

.feature-card:hover {
  transform: translateY(-5px);
}

.feature-icon {
  font-size: 2.5rem;
  margin-bottom: var(--spacing-md);
  color: var(--color-primary);
}

.feature-card h3 {
  margin-bottom: var(--spacing-md);
  color: var(--color-text-primary);
}

.feature-card p {
  color: var(--color-text-secondary);
  line-height: 1.6;
}

@media (max-width: 1024px) {
  .hero-section {
    padding: var(--spacing-xl) var(--spacing-lg);
  }

  .hero-content {
    padding: var(--spacing-xl) var(--spacing-lg);
  }
}

@media (max-width: 768px) {
  .hero-section {
    min-height: 60vh;
    padding: var(--spacing-xl) var(--spacing-md);
  }

  .hero-content {
    padding: var(--spacing-xl) var(--spacing-md);
  }

  .title {
    font-size: 2.5rem;
  }

  .subtitle {
    font-size: var(--font-size-base);
    max-width: 100%;
  }

  .action-buttons {
    flex-direction: column;
    align-items: stretch;
  }

  .action-buttons .btn {
    width: 100%;
  }

  .features-section {
    padding: var(--spacing-xl) var(--spacing-md);
  }

  .feature-grid {
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--spacing-lg);
  }
}

@media (max-width: 480px) {
  .hero-section {
    padding: var(--spacing-lg) var(--spacing-sm);
  }

  .hero-content {
    padding: var(--spacing-lg) var(--spacing-sm);
  }

  .title {
    font-size: 2rem;
  }

  .subtitle {
    font-size: var(--font-size-sm);
  }

  .features-section {
    padding: var(--spacing-lg) var(--spacing-sm);
  }

  .feature-grid {
    grid-template-columns: 1fr;
    gap: var(--spacing-md);
  }

  .feature-card {
    padding: var(--spacing-lg);
  }
}
</style>
