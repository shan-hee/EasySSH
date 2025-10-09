/**
 * FigProvider（最小可用版）
 * - 若存在本地 fig 精简 JSON，可按 tokens 提供命令/选项/子命令
 * - 若未引入 fig 数据，回退到 linux-commands.json 提供基本命令/选项
 */

import log from '@/services/log';
import linuxCommands from '@/assets/data/linux-commands.json';
import figData from '../fig-data-loader';
import type {
  AutocompleteContext,
  ProviderOptions,
  SuggestionItem
} from '../provider-registry';

export default class FigProvider {
  id: string;
  priority: number;
  constructor() {
    this.id = 'fig-lite';
    this.priority = 1; // 排在前面，优先命令/选项
  }

  supports(_context: AutocompleteContext, _options: ProviderOptions): boolean {
    return true;
  }

  // 解析 tokens（简单版）
  _parse(commandLine: string = ''): string[] {
    const tokens = (commandLine || '').trim().length
      ? (commandLine || '').trim().split(/\s+/)
      : [];
    return tokens;
  }

  // 在 linux-commands.json 中查找命令定义
  _findCmdDef(name?: string): any | null {
    try {
      const low = (name || '').toLowerCase();
      return linuxCommands.find((c: any) => c.name && c.name.toLowerCase() === low) || null;
    } catch (_) {
      return null;
    }
  }

  suggest(context: AutocompleteContext, options: ProviderOptions): SuggestionItem[] {
    const input = (context?.input || '').trim();
    if (!input) return [];

    const tokens = this._parse(context?.commandLine || '');
    const idx = typeof context?.wordPosition === 'number' ? (context.wordPosition as number) : (tokens.length ? tokens.length - 1 : 0);
    const atStart = idx === 0;
    const limit = Math.max(2, Math.min(8, options?.maxSuggestions || 8));

    const out: SuggestionItem[] = [];
    try {
      const key = input.toLowerCase();
      const head = (tokens[0] || '').toLowerCase();

      // 优先使用 fig 精简数据；不存在时回退 linux-commands
      const figIndex = figData.listCommands();

      // 1) 顶级命令建议
      if (atStart && !input.startsWith('-')) {
        const source = Array.from(new Set([...(figIndex || []), ...linuxCommands.map((c: any) => c.name)]));
        for (const nameRaw of source) {
          const name = String(nameRaw);
          const nameLow = name.toLowerCase();
          if (nameLow.startsWith(key) || nameLow.includes(key)) {
            // 描述：若有 fig spec 则取 spec.description，否则回退 linux-commands.desc
            const spec = figData.getSpec(nameLow);
            const lc = linuxCommands.find((c: any) => c.name.toLowerCase() === nameLow);
            const desc = spec?.description || lc?.desc || '命令';
            out.push({
              id: `fig_cmd_${name}`,
              text: name,
              description: desc,
              type: 'commands',
              category: 'commands',
              score: nameLow.startsWith(key) ? 220 : 110
            });
            if (out.length >= limit) break;
          }
        }
      }

      // 2) 子命令/选项建议（支持二级子命令）
      if (head) {
        const spec = figData.getSpec(head);
        // 子命令（当前不是以 - 开头的 token）
        if (spec && !input.startsWith('-')) {
          if (idx === 1) {
            const subs = Array.isArray((spec as any).subcommands) ? (spec as any).subcommands : [];
            for (const sc of subs as any[]) {
              const name = typeof sc === 'string' ? sc : sc?.name;
              if (!name) continue;
              const nameLow = name.toLowerCase();
              if (nameLow.startsWith(key) || nameLow.includes(key)) {
                out.push({
                  id: `fig_sub_${head}_${name}`,
                  text: name,
                  description: (typeof sc === 'object' ? (sc as any)?.description : '') || '子命令',
                  type: 'commands',
                  category: 'commands',
                  score: nameLow.startsWith(key) ? 200 : 100
                });
                if (out.length >= limit) break;
              }
            }
          } else if (idx === 2) {
            const sub1 = (Array.isArray((spec as any).subcommands) ? (spec as any).subcommands : []).find((sc: any) => (typeof sc === 'object' ? ((sc as any).name || '') : String(sc)).toLowerCase() === (tokens[1] || '').toLowerCase());
            const subs2 = (sub1 && Array.isArray((sub1 as any).subcommands)) ? (sub1 as any).subcommands : [];
            for (const sc of subs2 as any[]) {
              const name = typeof sc === 'string' ? sc : sc?.name;
              if (!name) continue;
              const nameLow = name.toLowerCase();
              if (nameLow.startsWith(key) || nameLow.includes(key)) {
                out.push({
                  id: `fig_sub2_${head}_${tokens[1]}_${name}`,
                  text: name,
                  description: (typeof sc === 'object' ? (sc as any)?.description : '') || '子命令',
                  type: 'commands',
                  category: 'commands',
                  score: nameLow.startsWith(key) ? 195 : 98
                });
                if (out.length >= limit) break;
              }
            }
          }
        }

        // 选项（当前输入以 - 开头）
        if (input.startsWith('-')) {
          const sub1 = (spec && Array.isArray((spec as any).subcommands))
            ? (spec as any).subcommands.find((sc: any) => (typeof sc === 'object' ? ((sc as any).name || '') : String(sc)).toLowerCase() === (tokens[1] || '').toLowerCase())
            : null;
          const sub2 = (sub1 && Array.isArray((sub1 as any).subcommands))
            ? (sub1 as any).subcommands.find((sc: any) => (typeof sc === 'object' ? ((sc as any).name || '') : String(sc)).toLowerCase() === (tokens[2] || '').toLowerCase())
            : null;
          const opts = (sub2 && Array.isArray((sub2 as any).options))
            ? (sub2 as any).options
            : (sub1 && Array.isArray((sub1 as any).options))
              ? (sub1 as any).options
              : (spec && Array.isArray((spec as any).options))
                ? (spec as any).options
                : (this._findCmdDef(head)?.options || []);
          for (const opt of opts as any[]) {
            const optName = Array.isArray((opt as any)?.names) ? (opt as any).names[0] : ((opt as any)?.name || String(opt));
            const optStr = String(optName);
            const matches = optStr.startsWith(input) || optStr.includes(input);
            if (!matches) continue;
            const desc = (typeof opt === 'object' ? (opt as any).description : '') || '选项';
            out.push({
              id: `fig_opt_${head}_${optStr}`,
              text: optStr,
              description: desc,
              type: 'options',
              category: 'options',
              score: optStr.startsWith(input) ? 190 : 95
            });
            if (out.length >= limit) break;
          }
        }
      }
    } catch (e) {
      log.debug('FigProvider 生成建议失败', e);
    }

    return out;
  }
}
