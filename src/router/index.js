import { createRouter, createWebHashHistory } from 'vue-router'

// 直接导入Dashboard组件
import Dashboard from '../views/Dashboard.vue'

// 其他组件保持懒加载
const Home = () => import('../views/Home.vue')
const ConnectionDetail = () => import('../views/connections/ConnectionDetail.vue')
const NewConnection = () => import('../views/connections/NewConnection.vue')
const Terminal = () => import('../views/terminal/Terminal.vue')
const Settings = () => import('../views/settings/Settings.vue')
const NotFound = () => import('../views/errors/NotFound.vue')

// 定义路由
const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: Dashboard,
    meta: {
      title: 'EasySSH',
      requiresAuth: true
    }
  },
  {
    path: '/home',
    name: 'Home',
    component: Home,
    meta: {
      title: 'EasySSH',
      requiresAuth: false
    }
  },
  {
    path: '/login',
    redirect: '/home',  // 登录页面重定向到首页，首页会显示登录面板
    meta: {
      title: 'EasySSH',
      requiresAuth: false
    }
  },
  {
    path: '/connections',
    redirect: '/connections/new', // 重定向到新的连接页面
    meta: {
      title: 'EasySSH'
    }
  },
  {
    path: '/connections/:id',
    name: 'ConnectionDetail',
    component: ConnectionDetail,
    meta: {
      title: 'EasySSH',
      requiresAuth: true
    },
    props: true
  },
  {
    path: '/connections/new',
    name: 'NewConnection',
    component: NewConnection,
    meta: {
      title: 'EasySSH',
      requiresAuth: false // 保持不需要认证，允许通过标签添加按钮创建
    }
  },
  {
    path: '/terminal',
    name: 'TerminalMain',
    component: Terminal,
    meta: {
      title: 'EasySSH',
      requiresAuth: false
    }
  },
  {
    path: '/terminal/:id',
    name: 'Terminal',
    component: Terminal,
    props: true,
    meta: {
      title: 'EasySSH',
      requiresAuth: false // 临时关闭认证要求
    }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: Settings,
    meta: {
      title: 'EasySSH',
      requiresAuth: false // 临时关闭认证要求
    }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

// 创建路由实例
const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    // 始终滚动到顶部
    return { top: 0 }
  }
})

// 导入用户状态管理
import { useUserStore } from '../store/user'

// 简化路由守卫，确保页面始终能正常加载
router.beforeEach((to, from, next) => {
  // 设置页面标题
  document.title = to.meta.title || 'EasySSH - 高效服务器管理工具'
  
  // 处理登录面板
  const headerElement = document.querySelector('.app-header');
  
  // 检查认证需求
  if (to.meta.requiresAuth) {
    const userStore = useUserStore()
    if (!userStore.isLoggedIn) {
      // 用户未登录，显示登录面板
      if (headerElement) {
        const showLoginEvent = new CustomEvent('show-login-panel');
        headerElement.dispatchEvent(showLoginEvent);
      }
      
      // 取消导航，保持在当前页面
      next(false)
      return
    } else if (headerElement) {
      // 已登录用户访问受保护页面，关闭登录面板
      const closeEvent = new CustomEvent('close-login-panel');
      headerElement.dispatchEvent(closeEvent);
    }
  } else if (headerElement) {
    // 访问不需要认证的页面，关闭登录面板
    const closeEvent = new CustomEvent('close-login-panel');
    headerElement.dispatchEvent(closeEvent);
  }
  
  // 如果已登录用户访问非认证页面，正常导航
  next()
})

// 路由错误处理
router.onError(error => {
  console.error('路由错误:', error)
  // 可以在这里添加更高级的错误处理逻辑，如上报错误或显示错误通知
})

export default router 