import scriptLibraryService from '@/services/scriptLibrary';
import type {
  AutocompleteContext,
  ProviderOptions,
  SuggestionItem
} from '../provider-registry';

export default class ScriptLibraryProvider {
  id: string;
  priority: number;
  constructor() {
    this.id = 'script-library';
    this.priority = 5;
  }

  supports(_context: AutocompleteContext, options: ProviderOptions): boolean {
    return options.enableScriptCompletion !== false;
  }

  suggest(context: AutocompleteContext, options: ProviderOptions): SuggestionItem[] {
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
