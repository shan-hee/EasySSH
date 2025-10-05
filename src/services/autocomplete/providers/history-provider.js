import storageService from '@/services/storage';
import scriptLibraryService from '@/services/scriptLibrary';

const STORE_KEY = 'personalization.autocomplete.v1';

export default class HistoryProvider {
  constructor() {
    this.id = 'history';
    this.priority = 2;
  }

  supports(_context, _options) {
    return true;
  }

  suggest(context, options) {
    const input = (context?.input || '').trim().toLowerCase();
    if (!input) return [];

    const max = Math.max(2, Math.min(8, options?.maxSuggestions || 8));

    // 读取个性化仓库（只读）
    const cache = storageService.getItem(STORE_KEY, { items: {}, lru: [] }) || { items: {} };
    const items = cache.items || {};

    // 评分：优先 selects，其次 exposures，最近选择时间加权
    const scored = [];
    for (const key of Object.keys(items)) {
      const it = items[key] || {};
      let text = '';
      let type = 'commands';
      let category = 'commands';
      let desc = '';

      if (key.startsWith('phrase:')) {
        text = key.substring('phrase:'.length);
        desc = '常用短句';
      } else if (key.startsWith('script:')) {
        const idStr = key.substring('script:'.length);
        const id = Number(idStr);
        const script = scriptLibraryService.getScriptById(id, 'public') || scriptLibraryService.getScriptById(id, 'user');
        if (script && script.command) {
          text = script.command;
          type = 'script';
          category = 'script';
          desc = script.name || '脚本';
        }
      } else if (key.startsWith('script-text:')) {
        text = key.substring('script-text:'.length);
        type = 'script';
        category = 'script';
        desc = '脚本';
      } else if (key.startsWith('opt:')) {
        text = key.substring('opt:'.length);
        type = 'options';
        category = 'options';
        desc = '选项';
      } else {
        continue;
      }

      if (!text) continue;
      const tLow = text.toLowerCase();
      if (!(tLow.startsWith(input) || tLow.includes(input))) continue;

      const selects = it.selects || 0;
      const exposures = it.exposures || 0;
      const last = it.lastSelectedAt || 0;
      const score = selects * 10 + exposures * 1 + (last ? last / 1e10 : 0);
      scored.push({ key, text, type, category, description: desc, score });
    }

    scored.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
    return scored.slice(0, max);
  }
}

