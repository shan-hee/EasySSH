import wordCompletionService from '@/services/word-completion';
import type {
  AutocompleteContext,
  ProviderOptions,
  SuggestionItem
} from '../provider-registry';

export default class WordPhraseProvider {
  id: string;
  priority: number;
  constructor() {
    this.id = 'word-phrase';
    this.priority = 10;
  }

  supports(_context: AutocompleteContext, options: ProviderOptions): boolean {
    return options.enableWordCompletion !== false;
  }

  suggest(context: AutocompleteContext, options: ProviderOptions): SuggestionItem[] {
    const input = (context?.input || '').trim();
    if (!input) return [];

    const limit = Math.max(2, Math.min(8, options?.maxSuggestions || 8));
    try {
      return wordCompletionService.getWordSuggestions(input, limit, {
        commandLine: context?.commandLine || '',
        position: context?.wordPosition || 0
      });
    } catch (_) {
      return [];
    }
  }
}
