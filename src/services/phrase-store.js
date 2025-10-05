/**
 * 短句补全存储与学习服务（本地）
 * - 首次运行时注入一批默认短句
 * - 持久化用户学习到的短句（选中或实际执行）
 * - 提供去重合并后的短句列表
 */

import storageService from './storage';
import log from './log';

const STORAGE_KEYS = {
  INITED: 'autocomplete.phrases.inited',
  DEFAULTS: 'autocomplete.phrases.defaults.v1',
  USER: 'autocomplete.phrases.user.v1'
};

// 轻量默认短句（如已有更丰富内置，可在第一次 init 时合并进来）
const DEFAULT_PHRASES = [
  { text: 'ls -lah', description: '以详细、易读方式列出文件' },
  { text: 'du -sh', description: '以总计大小显示目录容量' },
  { text: 'df -h', description: '以人类可读方式显示磁盘空间' },
  { text: 'tail -f', description: '实时跟踪文件末尾输出' },
  { text: 'grep -rn', description: '递归搜索并显示行号' },
  { text: 'find . -name', description: '在当前目录按名称查找' },
  { text: 'tar -czvf', description: '创建 gzip 压缩包' },
  { text: 'tar -xzvf', description: '解压 gzip 压缩包' },
  { text: 'ssh -i', description: '使用私钥文件连接主机' },
  { text: 'rsync -avz', description: '压缩传输并保留属性' },
  { text: 'curl -I', description: '仅请求响应头' },
  { text: 'docker ps -a', description: '列出所有容器' },
  { text: 'docker logs -f', description: '实时查看容器日志' },
  { text: 'docker exec -it', description: '进入容器交互式终端' },
  { text: 'docker compose up -d', description: '后台启动 Compose 服务' }
];

class PhraseStoreService {
  constructor() {
    this._inited = false;
  }

  init() {
    if (this._inited) return;
    try {
      // 首次运行注入默认短句（若未初始化过）
      const inited = !!storageService.getItem(STORAGE_KEYS.INITED, false);
      if (!inited) {
        const existingDefaults = storageService.getItem(STORAGE_KEYS.DEFAULTS, []);
        const merged = this._mergePhrases(existingDefaults, DEFAULT_PHRASES);
        storageService.setItem(STORAGE_KEYS.DEFAULTS, merged);
        storageService.setItem(STORAGE_KEYS.INITED, true);
      }
      this._inited = true;
    } catch (e) {
      log.warn('短句存储初始化失败', e);
    }
  }

  _mergePhrases(base = [], extra = []) {
    const out = [];
    const seen = new Set();
    for (const p of [...base, ...extra]) {
      const key = (p?.text || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ text: key, description: p?.description || '常用短句', source: p?.source || 'default' });
    }
    return out;
  }

  getAll() {
    this.init();
    const defaults = storageService.getItem(STORAGE_KEYS.DEFAULTS, []);
    const user = storageService.getItem(STORAGE_KEYS.USER, []);
    // 用户短句优先，避免重复
    const seen = new Set();
    const merged = [];
    for (const p of [...user, ...defaults]) {
      const t = (p?.text || '').trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      merged.push({ text: t, description: p?.description || '常用短句', source: p?.source || 'default', uses: p?.uses || 0, lastUsedAt: p?.lastUsedAt || 0 });
    }
    return merged;
  }

  addPhrase(text, description = '常用短句') {
    try {
      const t = (text || '').trim();
      if (!t) return false;
      // 限制：必须至少包含一个空格（视为短句/组合），避免将单词当作短句
      if (!t.includes(' ')) return false;

      const user = storageService.getItem(STORAGE_KEYS.USER, []);
      const exists = user.find(p => p.text === t);
      if (exists) {
        exists.uses = (exists.uses || 0) + 1;
        exists.lastUsedAt = Date.now();
      } else {
        user.unshift({ text: t, description, source: 'learned', uses: 1, lastUsedAt: Date.now() });
        // 控制上限，避免无限增长
        if (user.length > 500) user.length = 500;
      }
      storageService.setItem(STORAGE_KEYS.USER, user);
      return true;
    } catch (e) {
      log.warn('添加短句失败', e);
      return false;
    }
  }

  maybeLearnFromCommand(command) {
    try {
      const raw = (command || '').trim();
      if (!raw) return false;
      // 忽略非常短或单词命令
      if (!raw.includes(' ')) return false;
      // 忽略明显的无意义输入
      if (raw.length < 3) return false;
      // 基础噪音屏蔽
      const blacklist = ['clear', 'reset'];
      if (blacklist.includes(raw)) return false;

      // 限制“短句”规模：词数不超过 8，字符不超过 120
      const tokens = raw.split(/\s+/);
      if (tokens.length > 8 || raw.length > 120) return false;

      // 描述：取首词命令名
      const desc = `${tokens[0]} 常用短句`;
      return this.addPhrase(raw, desc);
    } catch (e) {
      return false;
    }
  }
}

const phraseStore = new PhraseStoreService();
export default phraseStore;

