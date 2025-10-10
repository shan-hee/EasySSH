/**
 * 辅助功能服务（精简 TypeScript 版）
 * - 提供字体大小调节、对比度/动效偏好开关等基础能力
 */
import EventEmitter from './EventEmitter';

export const ContrastLevel = {
  NORMAL: 'normal',
  HIGH: 'high',
  VERY_HIGH: 'very-high'
} as const;

export const AnimationLevel = {
  FULL: 'full',
  REDUCED: 'reduced',
  NONE: 'none'
} as const;

export const FontSizeLevel = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large',
  EXTRA_LARGE: 'extra-large'
} as const;

const FONT_SIZE_MAP: Record<string, number> = {
  [FontSizeLevel.SMALL]: 14,
  [FontSizeLevel.MEDIUM]: 16,
  [FontSizeLevel.LARGE]: 18,
  [FontSizeLevel.EXTRA_LARGE]: 20
};

type A11yConfig = {
  fontSize: keyof typeof FontSizeLevel | string;
  highContrast: boolean;
  contrastLevel: keyof typeof ContrastLevel | string;
  reduceMotion: boolean;
  animationLevel: keyof typeof AnimationLevel | string;
};

class AccessibilityService extends EventEmitter {
  private static instanceRef: AccessibilityService | null = null;
  private config: A11yConfig = {
    fontSize: FontSizeLevel.MEDIUM,
    highContrast: false,
    contrastLevel: ContrastLevel.NORMAL,
    reduceMotion: false,
    animationLevel: AnimationLevel.FULL
  };

  static getInstance(): AccessibilityService {
    if (!AccessibilityService.instanceRef) {
      AccessibilityService.instanceRef = new AccessibilityService();
    }
    return AccessibilityService.instanceRef;
  }

  async init(): Promise<void> {
    // 应用初始设置
    this.applyToDOM();
  }

  getConfig(): Readonly<A11yConfig> {
    return this.config;
  }

  setHighContrast(enabled: boolean): void {
    this.config.highContrast = !!enabled;
    this.config.contrastLevel = enabled ? ContrastLevel.HIGH : ContrastLevel.NORMAL;
    this.applyToDOM();
    this.emit('a11y:contrast-changed', this.config.contrastLevel);
  }

  setReduceMotion(enabled: boolean): void {
    this.config.reduceMotion = !!enabled;
    this.config.animationLevel = enabled ? AnimationLevel.REDUCED : AnimationLevel.FULL;
    this.applyToDOM();
    this.emit('a11y:motion-changed', this.config.animationLevel);
  }

  increaseFontSize(): void {
    const order = [
      FontSizeLevel.SMALL,
      FontSizeLevel.MEDIUM,
      FontSizeLevel.LARGE,
      FontSizeLevel.EXTRA_LARGE
    ];
    const idx = Math.max(0, order.indexOf(this.config.fontSize as any));
    const next = order[Math.min(idx + 1, order.length - 1)];
    this.config.fontSize = next;
    this.applyToDOM();
    this.emit('a11y:font-changed', next);
  }

  decreaseFontSize(): void {
    const order = [
      FontSizeLevel.SMALL,
      FontSizeLevel.MEDIUM,
      FontSizeLevel.LARGE,
      FontSizeLevel.EXTRA_LARGE
    ];
    const idx = Math.max(0, order.indexOf(this.config.fontSize as any));
    const prev = order[Math.max(idx - 1, 0)];
    this.config.fontSize = prev;
    this.applyToDOM();
    this.emit('a11y:font-changed', prev);
  }

  private applyToDOM(): void {
    try {
      const root = document.documentElement;
      // 字体
      const size = FONT_SIZE_MAP[this.config.fontSize] || FONT_SIZE_MAP[FontSizeLevel.MEDIUM];
      root.style.setProperty('--a11y-root-font-size', `${size}px`);
      root.style.fontSize = `${size}px`;

      // 对比度
      root.classList.toggle('a11y-high-contrast', this.config.highContrast);
      root.setAttribute('data-contrast', String(this.config.contrastLevel));

      // 动效
      root.classList.toggle('a11y-reduce-motion', this.config.reduceMotion);
      root.setAttribute('data-animation', String(this.config.animationLevel));
    } catch (_) {
      // SSR 或无 DOM 环境下跳过
    }
  }
}

export default AccessibilityService.getInstance();
export { AccessibilityService };

