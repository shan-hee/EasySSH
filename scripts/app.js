/**
 * 应用主入口文件
 * 将所有模块整合到一起，启动应用
 */

import { initApp } from './core/init.js';
import App from './components/App.js';
import { initUXServices } from './services/ux/index.js';

// 记录应用启动时间
const startTime = performance.now();

// 延迟加载非关键组件
function lazyLoadComponents() {
  // 使用requestIdleCallback在浏览器空闲时预加载资源
  // 如果浏览器不支持，则降级使用setTimeout
  const idleCallback = window.requestIdleCallback || 
    ((cb) => setTimeout(cb, 1));
  
  idleCallback(() => {
    console.log('预加载非关键资源');
    
    // 预加载可能即将使用的模块
    const componentPromises = [
      import('./components/ConnectionList.js'),
      import('./components/ServerModal.js')
    ];
    
    // 预加载样式和字体资源
    prefetchResources([
      '/assets/fonts/roboto.woff2',
      '/styles/themes/dark.css'
    ]);
  });
}

// 预获取资源
function prefetchResources(urls) {
  urls.forEach(url => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    document.head.appendChild(link);
  });
}

// 资源懒加载观察器
function setupLazyLoading() {
  // 如果浏览器支持交叉观察器API
  if ('IntersectionObserver' in window) {
    const lazyImageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const lazyImage = entry.target;
          if (lazyImage.dataset.src) {
            lazyImage.src = lazyImage.dataset.src;
            lazyImage.removeAttribute('data-src');
            lazyImageObserver.unobserve(lazyImage);
          }
        }
      });
    });

    // 观察所有具有data-src属性的图片
    document.querySelectorAll('img[data-src]').forEach(img => {
      lazyImageObserver.observe(img);
    });
  }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  // 初始化用户体验服务
  initUXServices();
  
  // 初始化核心功能
  initApp();
  
  // 记录应用初始化时间
  const initTime = performance.now() - startTime;
  console.log(`应用初始化完成，耗时: ${initTime.toFixed(2)}ms`);
  
  // 设置懒加载
  setupLazyLoading();
  
  // 在DOM内容加载后，使用requestAnimationFrame确保在下一帧开始前执行
  window.requestAnimationFrame(() => {
    // 给浏览器时间渲染首屏，然后再加载非关键资源
    setTimeout(() => {
      lazyLoadComponents();
    }, 0);
  });
});

// 监听页面加载完成事件
window.addEventListener('load', () => {
  // 删除对动画模块的加载以避免与Vue路由冲突
  // setTimeout(() => {
  //   import('./utils/animations.js').then(module => {
  //     module.setupPageTransitions();
  //   });
  // }, 1000);
  
  // 记录性能指标
  if (performance.getEntriesByType) {
    const perfEntries = performance.getEntriesByType("navigation");
    if (perfEntries.length > 0) {
      const timing = perfEntries[0];
      const pageLoadTime = timing.loadEventEnd - timing.navigationStart;
      console.log(`页面完全加载时间: ${pageLoadTime.toFixed(2)}ms`);
      
      // 此处可添加性能数据上报
    }
  }
});

// 创建Vue应用实例
const app = Vue.createApp(App);
app.mount('#app');

// 导出应用实例
export default app;
