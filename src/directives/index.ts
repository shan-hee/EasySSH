/**
 * 全局自定义指令集合
 */
import type { ObjectDirective, DirectiveBinding } from 'vue';
import clipboardService from '../services/clipboard';
import log from '@/services/log';

// v-focus：自动聚焦指令
const focus: ObjectDirective<HTMLElement> = {
  mounted(el) {
    el.focus();
  }
};

// v-click-outside：点击元素外部
const clickOutside: ObjectDirective<HTMLElement, (e: MouseEvent) => void> = {
  beforeMount(el: HTMLElement & { _clickOutsideHandler?: (e: MouseEvent) => void }, binding: DirectiveBinding<(e: MouseEvent) => void>) {
    el._clickOutsideHandler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !(el === target || el.contains(target as Node))) {
        if (typeof binding.value === 'function') binding.value(event);
      }
    };
    document.addEventListener('click', el._clickOutsideHandler);
  },
  unmounted(el: HTMLElement & { _clickOutsideHandler?: (e: MouseEvent) => void }) {
    if (el._clickOutsideHandler) document.removeEventListener('click', el._clickOutsideHandler);
    delete el._clickOutsideHandler;
  }
};

// v-copy：点击复制内容 - 使用统一的剪贴板服务
const copy: ObjectDirective<HTMLElement, string | (() => string)> = {
  beforeMount(el: HTMLElement & { _copyHandler?: () => void }, binding: DirectiveBinding<string | (() => string)>) {
    el._copyHandler = async () => {
      try {
        const value = typeof binding.value === 'function' ? (binding.value as () => string)() : (binding.value as string);
        const success = await clipboardService.copyToClipboard(value);
        if (success) {
          el.dispatchEvent(new CustomEvent('copy-success'));
        } else {
          throw new Error('复制失败');
        }
      } catch (err) {
        el.dispatchEvent(new CustomEvent('copy-error', { detail: err }));
        log.error('复制失败', err);
      }
    };
    el.addEventListener('click', el._copyHandler);
  },
  unmounted(el: HTMLElement & { _copyHandler?: () => void }) {
    if (el._copyHandler) el.removeEventListener('click', el._copyHandler);
    delete el._copyHandler;
  }
};

export default { focus, clickOutside, copy };
