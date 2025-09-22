/**
 * 单词补全服务
 * 提供常用单词、命令和参数的自动补全功能
 */

import log from './log';
import { autocompleteConfig } from '../config/app-config';
import linuxCommands from '../assets/data/linux-commands.json';

class WordCompletionService {
  constructor() {
    // 常用单词库
    this.wordLibrary = {
      // 基础命令（按字母顺序排列）
      commands: [
        'awk',
        'cat',
        'cd',
        'chmod',
        'chown',
        'chgrp',
        'clear',
        'cmp',
        'cp',
        'cut',
        'df',
        'diff',
        'du',
        'echo',
        'find',
        'file',
        'grep',
        'gunzip',
        'gzip',
        'head',
        'help',
        'history',
        'join',
        'less',
        'ln',
        'locate',
        'ls',
        'man',
        'mkdir',
        'more',
        'mv',
        'nano',
        'paste',
        'pwd',
        'rm',
        'rmdir',
        'sed',
        'sort',
        'split',
        'stat',
        'strings',
        'tail',
        'tar',
        'tee',
        'touch',
        'tr',
        'tree',
        'uniq',
        'unzip',
        'vim',
        'wc',
        'which',
        'whereis',
        'zip'
      ],

      // 文件路径
      files: [
        '/',
        '/bin',
        '/sbin',
        '/usr',
        '/usr/bin',
        '/usr/local',
        '/opt',
        '/etc',
        '/var',
        '/tmp',
        '/home',
        '/root',
        '/boot',
        '/lib',
        '/proc',
        '/sys',
        '/dev',
        '/var/log',
        '/etc/passwd',
        '/etc/hosts',
        '/etc/fstab',
        '/etc/crontab',
        '~/.bashrc',
        '~/.bash_profile',
        '~/.zshrc',
        '~/.vimrc',
        '~/.ssh/',
        '~/.gitconfig'
      ],

      // 系统管理
      system: [
        'ps',
        'top',
        'htop',
        'kill',
        'killall',
        'jobs',
        'fg',
        'bg',
        'nohup',
        'screen',
        'tmux',
        'pgrep',
        'pkill',
        'uname',
        'whoami',
        'id',
        'who',
        'w',
        'uptime',
        'date',
        'cal',
        'free',
        'lscpu',
        'lsblk',
        'lsusb',
        'lspci',
        'mount',
        'umount',
        'sudo',
        'su',
        'passwd',
        'useradd',
        'usermod',
        'userdel',
        'groupadd',
        'systemctl',
        'service',
        'crontab',
        'at',
        'fdisk',
        'fsck',
        'mkfs'
      ],

      // 网络工具
      network: [
        'ping',
        'wget',
        'curl',
        'ssh',
        'scp',
        'rsync',
        'netstat',
        'ss',
        'ifconfig',
        'ip',
        'dig',
        'nslookup',
        'telnet',
        'nc',
        'traceroute',
        'iptables',
        'ufw'
      ],

      // 开发工具
      development: [
        'git',
        'npm',
        'yarn',
        'node',
        'python',
        'pip',
        'java',
        'gcc',
        'make',
        'docker',
        'kubectl',
        'terraform',
        'ansible'
      ],

      // 常用选项
      options: [
        '-l',
        '-a',
        '-h',
        '--help',
        '-v',
        '--version',
        '-r',
        '-R',
        '--recursive',
        '-f',
        '--force',
        '-i',
        '--interactive',
        '-n',
        '--dry-run',
        '-q',
        '--quiet',
        '--verbose',
        '-d',
        '--debug',
        '-o',
        '--output',
        '-p',
        '--port',
        '-u',
        '--user',
        '-g',
        '--group',
        '-m',
        '--mode',
        '-t',
        '--type',
        '-s',
        '--size',
        '-c',
        '--count',
        '-e',
        '--extended-regexp',
        '-w',
        '--word-regexp',
        '-x',
        '--line-regexp',
        '--color'
      ],

      // 扩展名
      extensions: [
        '.txt',
        '.log',
        '.conf',
        '.config',
        '.json',
        '.xml',
        '.yaml',
        '.yml',
        '.sh',
        '.bash',
        '.py',
        '.js',
        '.html',
        '.css',
        '.md',
        '.sql',
        '.csv',
        '.tar',
        '.gz',
        '.zip',
        '.deb',
        '.rpm',
        '.bak',
        '.tmp'
      ]
    };

    // 配置
    this.config = autocompleteConfig;

    // 命令 → 常见选项 映射（用于上下文感知）
    this.commandOptions = new Map();

    // 短句（多词）补全库（可按需扩充）
    this.phraseLibrary = [
      { text: 'ls -lah', description: '以详细、易读方式列出文件' },
      { text: 'du -sh', description: '以总计大小显示目录容量' },
      { text: 'df -h', description: '以人类可读方式显示磁盘空间' },
      { text: 'tail -f', description: '实时跟踪文件末尾输出' },
      { text: 'grep -r', description: '递归搜索目录中文本' },
      { text: 'grep -rn', description: '递归搜索并显示行号' },
      { text: 'find . -name', description: '在当前目录按名称查找' },
      { text: 'tar -czvf', description: '创建 gzip 压缩包' },
      { text: 'tar -xzvf', description: '解压 gzip 压缩包' },
      { text: 'ssh -i', description: '使用私钥文件连接主机' },
      { text: 'scp -i', description: '使用私钥进行安全复制' },
      { text: 'rsync -avz', description: '压缩传输并保留属性' },
      { text: 'curl -I', description: '仅请求响应头' },
      { text: 'curl -L', description: '跟随重定向' },
      { text: 'wget -c', description: '断点续传下载' },
      { text: 'systemctl restart', description: '重启 systemd 服务' },
      { text: 'systemctl status', description: '查看 systemd 服务状态' },
      { text: 'journalctl -u', description: '查看指定服务日志' },
      { text: 'docker ps -a', description: '列出所有容器' },
      { text: 'docker images', description: '列出镜像' },
      { text: 'docker logs -f', description: '实时查看容器日志' },
      { text: 'docker exec -it', description: '进入容器交互式终端' },
      { text: 'docker build -t', description: '构建镜像并命名标签' },
      { text: 'docker run -d --name', description: '后台运行并命名容器' },
      { text: 'docker rm -f', description: '强制删除容器' },
      { text: 'docker rmi', description: '删除镜像' },
      { text: 'docker compose up -d', description: '后台启动 Compose 服务' },
      { text: 'docker compose logs -f', description: '实时查看 Compose 日志' },
      { text: 'docker system prune -f', description: '清理无用数据' },
      { text: 'kubectl get pods -A', description: '列出所有命名空间的 Pods' },
      { text: 'kubectl describe pod', description: '查看 Pod 详情' },
      { text: 'kubectl logs -f', description: '实时查看 Pod 日志' },
      { text: 'kubectl exec -it', description: '进入 Pod 容器交互式终端' },
      { text: 'kubectl apply -f', description: '应用 YAML 清单' },
      { text: 'kubectl delete -f', description: '删除 YAML 清单资源' },
      { text: 'kubectl config set-context', description: '切换/设置上下文' },
      { text: 'nginx -t && systemctl reload nginx', description: '测试配置并热加载' },
      { text: 'journalctl -u nginx -f', description: '实时查看 Nginx 日志' },
      { text: 'firewall-cmd --permanent --add-port=80/tcp', description: '开放 80 端口 (firewalld)' },
      { text: 'firewall-cmd --reload', description: '重载防火墙配置 (firewalld)' },
      { text: 'ufw allow 80/tcp', description: 'UFW 开放 80 端口' },
      { text: 'ufw status', description: '查看 UFW 状态' },
      { text: 'git checkout -b', description: '创建并切换到新分支' },
      { text: 'git pull', description: '拉取远程更新' },
      { text: 'git push', description: '推送提交到远程' }
    ];

    // 将精简 Linux 命令数据并入本地词库
    try {
      if (Array.isArray(linuxCommands)) {
        const names = new Set(this.wordLibrary.commands);
        linuxCommands.forEach(cmd => {
          if (cmd?.name && !names.has(cmd.name)) {
            this.wordLibrary.commands.push(cmd.name);
            names.add(cmd.name);
          }
          if (cmd?.name && Array.isArray(cmd.options)) {
            this.commandOptions.set(cmd.name, cmd.options);
          }
        });
      }
    } catch (e) {
      log.warn('合并 Linux 命令词库失败:', e);
    }
  }

  /**
   * 获取单词补全建议
   * @param {string} input - 用户输入
   * @param {number} limit - 返回结果数量限制
   * @param {Object} context - 上下文信息
   * @returns {Array} 补全建议列表
   */
  getWordSuggestions(input, limit = 8, context = {}) {
    if (!input || input.trim().length === 0) {
      return [];
    }

    try {
      const wordSuggs = this.computeWordSuggestions(input.trim(), limit, context);
      const phraseSuggs = this.getPhraseSuggestions(input.trim(), Math.max(2, Math.floor(limit / 2)), context);

      // 合并后按分数排序，去重（按 text）
      const merged = [...wordSuggs, ...phraseSuggs];
      const uniq = [];
      const seen = new Set();
      for (const s of merged) {
        if (!seen.has(s.text)) {
          seen.add(s.text);
          uniq.push(s);
        }
      }

      uniq.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
      return uniq.slice(0, limit);
    } catch (error) {
      log.error('获取单词补全建议失败:', error);
      return [];
    }
  }

  /**
   * 计算单词补全建议
   * @param {string} input - 用户输入
   * @param {number} limit - 返回结果数量限制
   * @param {Object} context - 上下文信息
   * @returns {Array} 补全建议列表
   */
  computeWordSuggestions(input, limit, context) {
    const suggestions = [];
    const inputLower = input.toLowerCase();

    // 根据上下文确定搜索优先级
    const searchOrder = this.determineSearchOrder(input, context);

    for (const category of searchOrder) {
      if (suggestions.length >= limit) break;

      const categoryWords = this.wordLibrary[category] || [];
      const matches = this.findMatches(categoryWords, inputLower, limit - suggestions.length);

      // 添加类型标识
      const typedMatches = matches.map(word => ({
        id: `word_${category}_${word}`,
        text: word,
        description: this.getWordDescription(word, category),
        type: 'word',
        category,
        score: this.calculateWordScore(word, input, category, context)
      }));

      suggestions.push(...typedMatches);
    }

    // 按分数排序，分数相同时按字母顺序排序
    suggestions.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) < 0.001) {
        // 分数基本相同
        return a.text.localeCompare(b.text); // 字母顺序
      }
      return scoreDiff;
    });

    return suggestions.slice(0, limit);
  }

  /**
   * 获取短句（多词）补全建议
   * 基于整行上下文进行前缀/包含匹配，并优先命令相关短句
   */
  getPhraseSuggestions(input, limit = 4, context = {}) {
    if (!limit) return [];

    const suggestions = [];
    try {
      const cmdline = (context.commandLine || '').trim();
      const key = (cmdline || input).toLowerCase();
      if (!key) return [];

      // 生成候选集：内置短句 + 按当前命令扩展的常见选项短句
      const candidates = [...this.phraseLibrary];

      // 如果处于参数位置，则尝试基于首个命令补充“命令 + 常见选项”短句
      const firstToken = (cmdline || input).trim().split(/\s+/)[0] || '';
      if (firstToken && this.commandOptions.has(firstToken)) {
        const opts = this.commandOptions.get(firstToken).slice(0, 6);
        opts.forEach(opt => {
          const phrase = `${firstToken} ${opt}`;
          candidates.push({ text: phrase, description: '常用选项组合' });
        });
      }

      // 匹配与计分：前缀优先，其次包含；命令名称相符加权
      for (const item of candidates) {
        const t = item.text.toLowerCase();
        let score = 0;
        if (t.startsWith(key)) score += 120;
        else if (t.includes(key)) score += 60;

        // 语境加分：短句首词与当前首个命令匹配
        const phraseHead = item.text.split(/\s+/)[0].toLowerCase();
        if (firstToken && phraseHead === firstToken.toLowerCase()) score += 40;

        // 长度贴合度微调（更接近的多给分）
        const lenDiff = Math.abs(item.text.length - (cmdline || input).length);
        score += Math.max(0, 20 - Math.min(20, lenDiff));

        if (score > 0) {
          suggestions.push({
            id: `phrase_${item.text}`,
            text: item.text,
            description: item.description || '常用短句',
            type: 'commands', // 在排序中优先于普通 word
            category: 'commands',
            score
          });
        }
      }

      // 排序并裁剪
      suggestions.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
      return suggestions.slice(0, limit);
    } catch (e) {
      log.warn('获取短句补全建议失败:', e);
      return [];
    }
  }

  /**
   * 确定搜索顺序
   * @param {string} input - 用户输入
   * @param {Object} context - 上下文信息
   * @returns {Array} 搜索顺序数组
   */
  determineSearchOrder(input, context) {
    const { commandLine = '', position = 0 } = context;

    // 默认搜索顺序
    let searchOrder = [
      'commands',
      'options',
      'development',
      'network',
      'system',
      'files',
      'extensions'
    ];

    // 根据上下文调整顺序
    if (position === 0 || commandLine.trim() === input) {
      // 命令行开始，优先命令
      searchOrder = [
        'commands',
        'development',
        'system',
        'network',
        'options',
        'files',
        'extensions'
      ];
    } else if (input.startsWith('-')) {
      // 参数输入，优先选项
      searchOrder = [
        'options',
        'commands',
        'development',
        'system',
        'network',
        'files',
        'extensions'
      ];
    } else if (input.includes('.')) {
      // 包含点，可能是文件或扩展名
      searchOrder = [
        'files',
        'extensions',
        'commands',
        'options',
        'development',
        'network',
        'system'
      ];
    } else if (this.isInGitContext(commandLine)) {
      // Git 上下文
      searchOrder = [
        'development',
        'commands',
        'options',
        'files',
        'system',
        'network',
        'extensions'
      ];
    } else if (this.isInDockerContext(commandLine)) {
      // Docker 上下文
      searchOrder = [
        'development',
        'system',
        'commands',
        'options',
        'network',
        'files',
        'extensions'
      ];
    }

    return searchOrder;
  }

  /**
   * 查找匹配的单词
   * @param {Array} words - 单词列表
   * @param {string} input - 输入（小写）
   * @param {number} limit - 限制数量
   * @returns {Array} 匹配的单词
   */
  findMatches(words, input, limit) {
    const matches = [];

    // 精确前缀匹配
    for (const word of words) {
      if (matches.length >= limit) break;
      if (word.toLowerCase().startsWith(input)) {
        matches.push(word);
      }
    }

    // 如果精确匹配不够，进行模糊匹配
    if (matches.length < limit) {
      for (const word of words) {
        if (matches.length >= limit) break;
        if (!matches.includes(word) && word.toLowerCase().includes(input)) {
          matches.push(word);
        }
      }
    }

    return matches;
  }

  /**
   * 计算单词分数
   * @param {string} word - 单词
   * @param {string} input - 用户输入
   * @param {string} category - 类别
   * @param {Object} context - 上下文
   * @returns {number} 分数
   */
  calculateWordScore(word, input, category, context) {
    let score = 0;

    // 基础匹配分数
    if (word.toLowerCase().startsWith(input.toLowerCase())) {
      score += 100; // 前缀匹配高分
    } else if (word.toLowerCase().includes(input.toLowerCase())) {
      score += 50; // 包含匹配中等分
    }

    // 长度相似度加分
    const lengthDiff = Math.abs(word.length - input.length);
    score += Math.max(0, 20 - lengthDiff);

    // 类别权重
    const categoryWeights = {
      commands: 1.0,
      options: 0.9,
      development: 0.8,
      network: 0.7,
      system: 0.8,
      files: 0.6,
      extensions: 0.5
    };
    score *= categoryWeights[category] || 0.5;

    // 上下文加分
    if (context.commandLine) {
      if (this.isInGitContext(context.commandLine) && category === 'development') {
        score *= 1.5;
      }
      if (this.isInDockerContext(context.commandLine) && category === 'development') {
        score *= 1.3;
      }
    }

    return score;
  }

  /**
   * 获取单词描述
   * @param {string} word - 单词
   * @param {string} category - 类别
   * @returns {string} 描述
   */
  getWordDescription(word, category) {
    const descriptions = {
      commands: '系统命令',
      options: '命令选项',
      development: '开发工具',
      network: '网络相关',
      system: '系统管理',
      files: '文件路径',
      extensions: '文件扩展名'
    };
    return descriptions[category] || '常用单词';
  }

  /**
   * 检查是否在 Git 上下文中
   * @param {string} commandLine - 命令行
   * @returns {boolean}
   */
  isInGitContext(commandLine) {
    return /\bgit\b/.test(commandLine.toLowerCase());
  }

  /**
   * 检查是否在 Docker 上下文中
   * @param {string} commandLine - 命令行
   * @returns {boolean}
   */
  isInDockerContext(commandLine) {
    return /\bdocker\b|\bkubectl\b/.test(commandLine.toLowerCase());
  }

  /**
   * 添加自定义单词
   * @param {string} category - 类别
   * @param {Array} words - 单词列表
   */
  addCustomWords(category, words) {
    if (!this.wordLibrary[category]) {
      this.wordLibrary[category] = [];
    }
    this.wordLibrary[category].push(...words);
    log.info(`已添加 ${words.length} 个自定义单词到类别 ${category}`);
  }
}

// 创建单例实例
const wordCompletionService = new WordCompletionService();

export default wordCompletionService;
