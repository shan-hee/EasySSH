import scriptLibraryService from '@/services/scriptLibrary';

export default class ScriptLibraryProvider {
  constructor() {
    this.id = 'script-library';
    this.priority = 5;
  }

  supports(_context, options) {
    return options.enableScriptCompletion !== false;
  }

  suggest(context, options) {
    const input = (context?.input || '').trim();
    if (!input) return [];

    const limit = Math.max(2, Math.min(8, options?.maxSuggestions || 8));
    try {
      // 同步接口，避免额外异步开销
      const list = scriptLibraryService.getSimpleCommandSuggestionsSync(input, limit);
      return list.map(s => ({
        ...s,
        type: 'script',
        category: 'script'
      }));
    } catch (_) {
      return [];
    }
  }
}

