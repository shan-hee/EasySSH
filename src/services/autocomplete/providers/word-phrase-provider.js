import wordCompletionService from '@/services/word-completion';

export default class WordPhraseProvider {
  constructor() {
    this.id = 'word-phrase';
    this.priority = 10;
  }

  supports(_context, options) {
    return options.enableWordCompletion !== false;
  }

  suggest(context, options) {
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

