/**
 * fontLoader.js - 字体加载工具
 * 用于预加载终端字体
 */
import log from '../services/log';

// 字体加载状态
const fontState: { fontsLoaded: boolean; loadingPromise: Promise<boolean> | null } = {
  fontsLoaded: false,
  loadingPromise: null
};

/**
 * 预加载关键字体
 */
export const preloadFonts = (): Promise<boolean> => {
  // 如果已经在加载中，直接返回现有Promise
  if (fontState.loadingPromise) {
    return fontState.loadingPromise;
  }

  // 如果字体已标记为加载完成，直接返回成功
  if (fontState.fontsLoaded) {
    return Promise.resolve(true);
  }

  // 创建字体加载Promise
  fontState.loadingPromise = (async () => {
    try {
      const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      let usedNativeAPI = false;

      // 创建一个包含预加载字体的隐藏元素
      const preloadDiv = document.createElement('div');
      preloadDiv.style.fontFamily = '"JetBrains Mono", monospace';
      preloadDiv.style.position = 'absolute';
      preloadDiv.style.left = '-9999px';
      preloadDiv.style.fontSize = '16px';
      preloadDiv.style.visibility = 'hidden';
      preloadDiv.style.pointerEvents = 'none';
      preloadDiv.style.whiteSpace = 'pre';
      // 包含各种字符以确保字体完全加载，包括特殊字符
      preloadDiv.textContent =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()[]{}<>/?\\|~`\n\t';
      document.body.appendChild(preloadDiv);

      // 添加加粗字体的样本元素
      const boldDiv = document.createElement('div');
      boldDiv.style.fontFamily = '"JetBrains Mono", monospace';
      boldDiv.style.fontWeight = 'bold';
      boldDiv.style.position = 'absolute';
      boldDiv.style.left = '-9999px';
      boldDiv.style.fontSize = '16px';
      boldDiv.style.visibility = 'hidden';
      boldDiv.style.pointerEvents = 'none';
      boldDiv.textContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      document.body.appendChild(boldDiv);

      // 等待小延迟确保浏览器有时间解析字体
      await new Promise(resolve => setTimeout(resolve, 100));

      // 尝试使用CSS字体加载API
      if ((document as any).fonts && typeof (document as any).fonts.ready === 'object') {
        try {
          await (document as any).fonts.ready;
          usedNativeAPI = true;
        } catch (e) {
          log.warn('浏览器字体加载API失败，使用备用方法', e);
        }
      }

      // 额外延迟以确保渲染正确
      await new Promise(resolve => setTimeout(resolve, 100));

      // 标记字体为已加载状态
      fontState.fontsLoaded = true;

      // 触发自定义事件，通知应用字体已预加载
      try {
        const eventDetail = {
          success: true,
          fontFamily: 'JetBrains Mono',
          timestamp: Date.now()
        };

        window.dispatchEvent(
          new CustomEvent('fonts:loaded', {
            detail: eventDetail
          })
        );

        // 兼容终端专用事件
        window.dispatchEvent(
          new CustomEvent('terminal:fonts-loaded', {
            detail: eventDetail
          })
        );

        // 兼容旧版格式
        window.TERMINAL_FONTS_LOADED = true;

        // 事件触发成功
      } catch (e: any) {
        log.error(`触发字体加载事件出错: ${e?.message}`);
      }

      // 短暂延迟后移除预加载元素
      setTimeout(() => {
        try {
          if (preloadDiv.parentNode) {
            preloadDiv.parentNode.removeChild(preloadDiv);
          }
          if (boldDiv.parentNode) {
            boldDiv.parentNode.removeChild(boldDiv);
          }
        } catch (e) {
          // 忽略错误
        }
      }, 500);

      const end = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const durationMs = Math.round(end - start);
      log.info('字体预加载完成', { method: usedNativeAPI ? 'native' : 'fallback', durationMs });
      return true;
    } catch (error: any) {
      log.error(`预加载字体出错: ${error?.message}`);
      fontState.fontsLoaded = true; // 即使出错也标记为已加载，避免阻塞应用
      return false;
    }
  })();

  return fontState.loadingPromise;
};

/**
 * 检查字体是否已加载
 * @returns {boolean} - 字体是否已加载
 */
export const areFontsLoaded = (): boolean => fontState.fontsLoaded;

/**
 * 等待字体加载完成
 * @param {number} timeout - 超时时间，毫秒
 * @returns {Promise<boolean>} - 是否成功加载
 */
export const waitForFontsLoaded = async (timeout: number = 5000): Promise<boolean> => {
  if (fontState.fontsLoaded) {
    return true;
  }

  if (fontState.loadingPromise) {
    // 如果已经在加载，等待完成或超时
    return Promise.race<boolean>([
      fontState.loadingPromise,
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeout))
    ]);
  }

  // 启动加载过程
  return preloadFonts();
};

export default {
  preloadFonts,
  areFontsLoaded,
  waitForFontsLoaded
};
