/**
 * 动画效果工具模块
 * 用于处理页面中的动画效果
 */

import { uiConfig } from '../core/config.js';

/**
 * 设置元素渐入动画
 * @param {HTMLElement|NodeList|Array} elements 要添加动画的元素或元素集合
 * @param {Object} options 动画选项
 */
export function fadeIn(elements, options = {}) {
  const defaultOptions = {
    delay: 0,           // 初始延迟
    duration: 500,      // 动画持续时间
    stagger: 100,       // 元素间隔时间
    easing: 'ease',     // 缓动函数
    from: {             // 起始状态
      opacity: 0,
      y: 20
    },
    to: {               // 结束状态
      opacity: 1,
      y: 0
    }
  };
  
  const animOptions = { ...defaultOptions, ...options };
  const elems = elements.length ? Array.from(elements) : [elements];
  
  elems.forEach((el, index) => {
    if (!el || !el.style) return;
    
    const delay = animOptions.delay + (index * animOptions.stagger);
    
    el.style.opacity = animOptions.from.opacity;
    el.style.transform = `translateY(${animOptions.from.y}px)`;
    el.style.transition = `opacity ${animOptions.duration}ms ${animOptions.easing}, transform ${animOptions.duration}ms ${animOptions.easing}`;
    
    setTimeout(() => {
      el.style.opacity = animOptions.to.opacity;
      el.style.transform = `translateY(${animOptions.to.y}px)`;
    }, delay);
  });
}

/**
 * 设置元素渐出动画
 * @param {HTMLElement|NodeList|Array} elements 要添加动画的元素或元素集合
 * @param {Object} options 动画选项
 * @param {Function} callback 动画完成后的回调函数
 */
export function fadeOut(elements, options = {}, callback) {
  const defaultOptions = {
    delay: 0,
    duration: 300,
    stagger: 50,
    easing: 'ease',
    from: {
      opacity: 1,
      y: 0
    },
    to: {
      opacity: 0,
      y: 10
    }
  };
  
  const animOptions = { ...defaultOptions, ...options };
  const elems = elements.length ? Array.from(elements) : [elements];
  
  elems.forEach((el, index) => {
    if (!el || !el.style) return;
    
    const delay = animOptions.delay + (index * animOptions.stagger);
    
    el.style.opacity = animOptions.from.opacity;
    el.style.transform = `translateY(${animOptions.from.y}px)`;
    el.style.transition = `opacity ${animOptions.duration}ms ${animOptions.easing}, transform ${animOptions.duration}ms ${animOptions.easing}`;
    
    setTimeout(() => {
      el.style.opacity = animOptions.to.opacity;
      el.style.transform = `translateY(${animOptions.to.y}px)`;
      
      // 如果是最后一个元素，在动画完成后调用回调函数
      if (index === elems.length - 1 && typeof callback === 'function') {
        setTimeout(callback, animOptions.duration);
      }
    }, delay);
  });
}

/**
 * 添加脉冲动画效果
 * @param {HTMLElement} element 要添加动画的元素
 * @param {Object} options 动画选项
 * @returns {Function} 移除动画的函数
 */
export function addPulseEffect(element, options = {}) {
  if (!element) return () => {};
  
  const defaultOptions = {
    scale: 1.05,
    duration: 1000,
    easing: 'ease-in-out',
    infinite: true
  };
  
  const animOptions = { ...defaultOptions, ...options };
  const className = 'pulse-animation';
  
  // 创建一个样式元素
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes ${className} {
      0% {
        transform: scale(1);
      }
      50% {
        transform: scale(${animOptions.scale});
      }
      100% {
        transform: scale(1);
      }
    }
    
    .${className} {
      animation: ${className} ${animOptions.duration}ms ${animOptions.easing} ${animOptions.infinite ? 'infinite' : '1'};
    }
  `;
  
  document.head.appendChild(style);
  element.classList.add(className);
  
  // 返回一个移除动画的函数
  return () => {
    element.classList.remove(className);
    document.head.removeChild(style);
  };
}

/**
 * 设置页面内容加载动画
 */
export function setupPageTransitions() {
  // SPA应用中应当使用Vue Router，不应直接劫持链接点击
  // 下面的代码被注释以避免与Vue路由冲突
  /*
  // 监听所有内部链接点击
  document.querySelectorAll('a[href^="/"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      
      // 排除外部链接和锚点链接
      if (href.startsWith('/') && !href.startsWith('//') && !href.includes('#')) {
        e.preventDefault();
        
        // 页面退出动画
        const content = document.querySelector('.content');
        fadeOut(content, {
          duration: 300,
          to: { opacity: 0, y: 20 }
        }, () => {
          // 模拟页面加载延迟
          setTimeout(() => {
            // 实际应用中这里应该是路由导航
            window.location.href = href;
          }, 100);
        });
      }
    });
  });
  */
  
  // 页面加载时的进入动画
  window.addEventListener('load', () => {
    // 为主要内容元素添加进入动画
    const content = document.querySelector('.content');
    if (content) {
      fadeIn(content);
    }
  });
}

/**
 * 设置应用的所有动画效果
 */
export function setupAnimations() {
  // 设置页面转场动画
  setupPageTransitions();
  
  // 对特性卡片应用动画
  const featureCards = document.querySelectorAll('.feature-card');
  fadeIn(featureCards, {
    delay: 300,
    stagger: 150
  });
  
  // 对连接卡片应用动画
  const connectionCards = document.querySelectorAll('.connection-card');
  fadeIn(connectionCards, {
    delay: 500,
    stagger: 100
  });
  
  // 对菜单项应用动画
  const menuItems = document.querySelectorAll('.menu__item');
  fadeIn(menuItems, {
    delay: 200,
    stagger: 50,
    from: { opacity: 0, y: 0 },
    to: { opacity: 1, y: 0 }
  });
  
  console.log('动画效果初始化完成');
}

export default {
  fadeIn,
  fadeOut,
  addPulseEffect,
  setupPageTransitions,
  setupAnimations
};
