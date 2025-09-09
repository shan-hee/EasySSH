/**
 * 全局自定义指令集合
 */

// v-focus：自动聚焦指令
const focus = {
  mounted: el => {
    el.focus();
  }
};

// v-click-outside：点击元素外部
const clickOutside = {
  beforeMount: (el, binding) => {
    el._clickOutsideHandler = event => {
      if (!(el === event.target || el.contains(event.target))) {
        binding.value(event);
      }
    };
    document.addEventListener('click', el._clickOutsideHandler);
  },
  unmounted: el => {
    document.removeEventListener('click', el._clickOutsideHandler);
    delete el._clickOutsideHandler;
  }
};

// v-copy：点击复制内容 - 使用统一的剪贴板服务
const copy = {
  beforeMount: (el, binding) => {
    el._copyHandler = async () => {
      try {
        const value = typeof binding.value === 'function' ? binding.value() : binding.value;

        // 使用统一的剪贴板服务
        const { default: clipboardService } = await import('../services/clipboard.js');
        const success = await clipboardService.copyToClipboard(value);

        if (success) {
          // 触发自定义事件
          el.dispatchEvent(new CustomEvent('copy-success'));
        } else {
          throw new Error('复制失败');
        }
      } catch (err) {
        // 触发自定义事件
        el.dispatchEvent(new CustomEvent('copy-error', { detail: err }));
        console.error('复制失败:', err);
      }
    };
    el.addEventListener('click', el._copyHandler);
  },
  unmounted: el => {
    el.removeEventListener('click', el._copyHandler);
    delete el._copyHandler;
  }
};

// 导出所有指令
export default {
  focus,
  clickOutside,
  copy
};
