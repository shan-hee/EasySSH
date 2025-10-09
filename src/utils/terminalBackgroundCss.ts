// 统一的终端背景 CSS 变量应用工具
// 将背景设置映射为 CSS 变量，供布局与终端视图使用

export type TerminalBackgroundConfig = {
  enabled: boolean;
  url: string;
  opacity: number; // 0-1
  mode: 'cover' | 'contain' | 'fill' | 'none' | 'repeat';
};

/**
 * 规范化背景设置
 * @param {Object} bg 背景设置 { enabled, url, opacity, mode }
 */
function normalizeBg(bg?: Partial<TerminalBackgroundConfig> | null): TerminalBackgroundConfig {
  const out: Partial<TerminalBackgroundConfig> = { ...(bg || {}) };
  const enabled = !!out.enabled;
  const url = typeof out.url === 'string' ? out.url.trim() : '';
  const op = Number(out.opacity);
  const opacity = Number.isFinite(op) ? Math.min(1, Math.max(0, op)) : 0.5;
  const modeRaw = String(out.mode || 'cover').toLowerCase();
  const allowed: TerminalBackgroundConfig['mode'][] = ['cover', 'contain', 'fill', 'none', 'repeat'];
  const mode = (allowed.includes(modeRaw as any) ? (modeRaw as any) : 'cover') as TerminalBackgroundConfig['mode'];
  return { enabled, url, opacity, mode };
}

/**
 * 将背景设置应用为 CSS 变量
 * @param {Object} bg 背景设置
 */
export function applyTerminalBackgroundCss(bg?: Partial<TerminalBackgroundConfig> | null): void {
  const cfg = normalizeBg(bg);
  const root = document.documentElement;

  // 不做过渡与交叉淡出：直接切换或清除
  if (!cfg.enabled || !cfg.url) {
    clearTerminalBackgroundCss();
    return;
  }

  let backgroundSize = 'cover';
  switch (cfg.mode) {
    case 'contain':
      backgroundSize = 'contain';
      break;
    case 'fill':
      backgroundSize = '100% 100%';
      break;
    case 'none':
    case 'repeat':
      backgroundSize = 'auto';
      break;
    default:
      backgroundSize = 'cover';
  }

  const backgroundRepeat = cfg.mode === 'repeat' ? 'repeat' : 'no-repeat';

  const newImage = `url(${cfg.url})`;
  root.style.setProperty('--terminal-bg-image', newImage);
  root.style.setProperty('--terminal-bg-opacity', String(cfg.opacity));
  root.style.setProperty('--terminal-bg-size', backgroundSize);
  root.style.setProperty('--terminal-bg-repeat', backgroundRepeat);
}

/** 清除背景相关 CSS 变量 */
export function clearTerminalBackgroundCss(): void {
  const root = document.documentElement;
  root.style.removeProperty('--terminal-bg-image');
  root.style.removeProperty('--terminal-bg-opacity');
  root.style.removeProperty('--terminal-bg-size');
  root.style.removeProperty('--terminal-bg-repeat');
}

export default {
  applyTerminalBackgroundCss,
  clearTerminalBackgroundCss
};
