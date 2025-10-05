/**
 * 自动补全 Provider 注册中心
 * - 以“外挂”形式组织多来源建议（Fig、脚本库、短句/词库等）
 * - 统一 supports/suggest 接口
 * - 聚合、去重后交由 terminal-autocomplete 继续打分与个性化重排
 */

import { autocompleteConfig } from '@/config/app-config';
import log from '@/services/log';
import WordPhraseProvider from './providers/word-phrase-provider';
import ScriptLibraryProvider from './providers/script-library-provider';
import FigProvider from './providers/fig-provider';
import HistoryProvider from './providers/history-provider';

// 内置 Providers（懒加载，避免循环依赖）
let _defaultProvidersBuilt = false;
const _providers = [];

function register(provider) {
  if (!provider || typeof provider.suggest !== 'function') return;
  _providers.push(provider);
}

function buildDefaultProviders() {
  if (_defaultProvidersBuilt) return;
  _defaultProvidersBuilt = true;
  try {
    // 注册顺序：Fig（命令/选项）> 历史（学习/常用）> 脚本库（整行命令）> 基础词库/短句
    register(new FigProvider());
    register(new HistoryProvider());
    register(new ScriptLibraryProvider());
    register(new WordPhraseProvider());
  } catch (e) {
    // 在极端环境下，容错继续；后续 collect 时仅无 providers
    log.warn('构建默认补全 Providers 失败', e);
  }
}

function ensureInitialized() {
  buildDefaultProviders();
}

/**
 * 聚合收集建议
 * @param {Object} context 统一上下文（来自 terminal-autocomplete）
 * @param {Object} options 可选项（如最大数量/开关）
 * @returns {Array} 建议集合
 */
async function collectAsync(context, options = {}) {
  ensureInitialized();
  const opts = {
    maxSuggestions: autocompleteConfig.maxSuggestions || 8,
    enableWordCompletion: autocompleteConfig.enableWordCompletion !== false,
    enableScriptCompletion: autocompleteConfig.enableScriptCompletion !== false,
    ...options
  };

  const all = [];
  for (const p of _providers) {
    try {
      if (typeof p.supports === 'function' && !p.supports(context, opts)) continue;
      // 允许提供同步或异步 suggest
      const result = await Promise.resolve(p.suggest(context, opts));
      if (Array.isArray(result) && result.length) all.push(...result);
    } catch (e) {
      // 单个 provider 错误不影响总体
      log.debug(`Provider 失败: ${p?.id || 'unknown'}`, e);
    }
  }
  return all;
}

// 同步快速版（大多 Provider 为同步）
function collect(context, options = {}) {
  ensureInitialized();
  const opts = {
    maxSuggestions: autocompleteConfig.maxSuggestions || 8,
    enableWordCompletion: autocompleteConfig.enableWordCompletion !== false,
    enableScriptCompletion: autocompleteConfig.enableScriptCompletion !== false,
    ...options
  };

  const all = [];
  for (const p of _providers) {
    try {
      if (typeof p.supports === 'function' && !p.supports(context, opts)) continue;
      const result = p.suggest(context, opts);
      if (Array.isArray(result) && result.length) all.push(...result);
    } catch (e) {
      log.debug(`Provider 失败: ${p?.id || 'unknown'}`, e);
    }
  }
  return all;
}

export default {
  register,
  ensureInitialized,
  collect,
  collectAsync
};
