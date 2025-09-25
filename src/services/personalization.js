/**
 * 个性化偏好服务（本地学习版）
 * - 记录补全曝光/选择事件
 * - 基于平滑CTR、时间衰减和上下文偏好，计算加权系数
 * - 对建议做重排/加权，提升常用项排序
 */

import storageService from './storage';
import log from './log';
import { useUserStore } from '@/store/user';

const STORAGE_KEY = 'personalization.autocomplete.v1';
const SETTINGS_KEY = 'personalization.settings.v1';

const DEFAULT_SETTINGS = {
  enabled: true, // 是否启用个性化
  localOnly: true, // 仅本地学习，不上报
  maxItems: 2000, // 最大条目数（LRU清理）
  topKExposures: 8, // 只记录前K条曝光，降噪
  decayDays: 14, // 时间衰减窗口
  alpha: 1, // CTR平滑参数（贝叶斯先验）
  beta: 3,
  minExposuresForBoost: 4, // 曝光阈值，避免早期过拟合
  clampMin: 0.8, // 权重下限
  clampMax: 1.6, // 权重上限
  epsilon: 0.05 // 轻微探索比例
};

function now() {
  return Date.now();
}

function days(ms) {
  return ms / (24 * 60 * 60 * 1000);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

class PersonalizationService {
  constructor() {
    this._cache = null;
    this._settings = null;
    this._userStore = null;
  }

  get userStore() {
    if (!this._userStore) this._userStore = useUserStore();
    return this._userStore;
  }

  _load() {
    if (!this._cache) {
      this._cache = storageService.getItem(STORAGE_KEY, {
        items: {}, // key -> { exposures, selects, lastSelectedAt, ctx: { hostKey -> { exposures, selects, lastSelectedAt } } }
        lru: [] // 保存键的简单LRU列表
      });
    }
    if (!this._settings) {
      this._settings = {
        ...DEFAULT_SETTINGS,
        ...(storageService.getItem(SETTINGS_KEY, {}) || {})
      };
    }
  }

  _save() {
    try {
      storageService.setItem(STORAGE_KEY, this._cache);
    } catch (e) {
      log.warn('保存个性化数据失败', e);
    }
  }

  _saveSettings() {
    try {
      storageService.setItem(SETTINGS_KEY, this._settings);
    } catch (e) {
      log.warn('保存个性化设置失败', e);
    }
  }

  enable(v = true) {
    this._load();
    this._settings.enabled = !!v;
    this._saveSettings();
  }

  isEnabled() {
    this._load();
    return !!this._settings.enabled;
  }

  clearAll() {
    this._cache = { items: {}, lru: [] };
    this._save();
  }

  _touchLRU(key) {
    const lru = this._cache.lru;
    const i = lru.indexOf(key);
    if (i >= 0) lru.splice(i, 1);
    lru.push(key);
    // LRU裁剪
    while (lru.length > this._settings.maxItems) {
      const k = lru.shift();
      delete this._cache.items[k];
    }
  }

  _getItem(key) {
    const { items } = this._cache;
    if (!items[key]) {
      items[key] = { exposures: 0, selects: 0, lastSelectedAt: 0, ctx: {} };
    }
    return items[key];
  }

  _makeKey(suggestion) {
    try {
      const type = suggestion.type || suggestion.category || 'word';
      if (type === 'script') {
        if (suggestion.id != null) return `script:${suggestion.id}`;
        if (suggestion.fullCommand) return `script-text:${suggestion.fullCommand}`;
      }
      if (type === 'commands') return `phrase:${suggestion.text}`;
      if (type === 'options') return `opt:${suggestion.text}`;
      return `word:${suggestion.text}`;
    } catch (_) {
      return `word:${String(suggestion?.text || '')}`;
    }
  }

  _makeHostKey(ctx) {
    const host = ctx?.host || '';
    const user = ctx?.username || '';
    return host || user ? `${user}@${host}` : '';
  }

  onShow(suggestions, ctx = {}) {
    try {
      this._load();
      if (!this.isEnabled()) return;
      // 未登录也允许本地学习，但若项目策略需要可限制为登录态
      const topK = Math.max(1, this._settings.topKExposures || 8);
      const hostKey = this._makeHostKey(ctx);

      for (let i = 0; i < suggestions.length && i < topK; i++) {
        const s = suggestions[i];
        const key = this._makeKey(s);
        const item = this._getItem(key);
        item.exposures += 1;
        if (hostKey) {
          if (!item.ctx[hostKey]) item.ctx[hostKey] = { exposures: 0, selects: 0, lastSelectedAt: 0 };
          item.ctx[hostKey].exposures += 1;
        }
        this._touchLRU(key);
      }
      this._save();
    } catch (e) {
      // 忽略采集错误
    }
  }

  onSelect(suggestion, ctx = {}) {
    try {
      this._load();
      if (!this.isEnabled()) return;
      const key = this._makeKey(suggestion);
      const item = this._getItem(key);
      item.selects += 1;
      item.lastSelectedAt = now();
      const hostKey = this._makeHostKey(ctx);
      if (hostKey) {
        if (!item.ctx[hostKey]) item.ctx[hostKey] = { exposures: 0, selects: 0, lastSelectedAt: 0 };
        item.ctx[hostKey].selects += 1;
        item.ctx[hostKey].lastSelectedAt = now();
      }
      this._touchLRU(key);
      this._save();
    } catch (e) {
      // 忽略采集错误
    }
  }

  // 可扩展：实际执行记录（当前并不强制）
  onExecute(_suggestion, _ctx = {}) {
    // 预留
  }

  // 计算提升系数（返回乘法权重）
  getBoost(suggestion, ctx = {}) {
    try {
      this._load();
      if (!this.isEnabled()) return 1;

      const key = this._makeKey(suggestion);
      const item = this._cache.items[key];
      if (!item) return 1;

      const { alpha, beta, minExposuresForBoost, decayDays, clampMin, clampMax } = this._settings;

      const exposures = item.exposures || 0;
      const selects = item.selects || 0;
      const ctr = (selects + alpha) / (exposures + alpha + beta);

      // 时间衰减（按最后一次选择时间）
      const last = item.lastSelectedAt || 0;
      const dec = last ? Math.exp(-days(now() - last) / Math.max(1, decayDays)) : 0.9; // 未被选择过给一个轻权重

      // 上下文亲和力（host维度）
      const hostKey = this._makeHostKey(ctx);
      let ctxAffinity = 1;
      if (hostKey && item.ctx && item.ctx[hostKey]) {
        const c = item.ctx[hostKey];
        const cCtr = (c.selects + alpha) / (c.exposures + alpha + beta);
        // 相对全局CTR的比值，限制范围
        const ratio = ctr > 0 ? cCtr / ctr : 1;
        ctxAffinity = clamp(ratio, 0.8, 1.3);
      }

      // 曝光不足时，降低权重避免早期过拟合
      const readiness = exposures >= Math.max(1, minExposuresForBoost) ? 1 : 0.9;

      // 组合权重：以1为基准，叠加贡献
      let boost = 1 + 0.6 * ctr + 0.2 * dec + 0.2 * (ctxAffinity - 1);
      boost *= readiness;
      boost = clamp(boost, clampMin, clampMax);
      return boost;
    } catch (e) {
      return 1;
    }
  }

  // 对已排序建议做二次重排（稳定排序，温和调序）
  rerank(suggestions, ctx = {}, input = '') {
    try {
      this._load();
      if (!this.isEnabled()) return suggestions;
      if (!Array.isArray(suggestions) || suggestions.length <= 1) return suggestions;

      const eps = this._settings.epsilon || 0.05;
      const seed = (input || '').length + suggestions.length;
      const rand = () => {
        // 简单可重现伪随机（依赖输入长度+长度），无需高质量
        const x = Math.sin(seed + Math.random()) * 10000;
        return x - Math.floor(x);
      };

      // 计算个性化加权分
      const scored = suggestions.map((s, i) => {
        const b = this.getBoost(s, ctx);
        // 温和探索：以小概率对靠近分数的项引入轻微扰动
        const explore = rand() < eps ? (rand() - 0.5) * 0.05 : 0;
        const pScore = (s.finalScore != null ? s.finalScore : s.score || 0) * b * (1 + explore);
        return { s, i, pScore };
      });

      // 稳定排序：保留第一名稳定，其余按 pScore 排序，分差极小则维持原序
      const head = scored[0];
      const tail = scored.slice(1).sort((a, b) => {
        const d = b.pScore - a.pScore;
        if (Math.abs(d) < 1e-6) return a.i - b.i;
        return d;
      });

      return [head, ...tail].map(x => x.s);
    } catch (e) {
      return suggestions;
    }
  }
}

const personalizationService = new PersonalizationService();
export default personalizationService;

