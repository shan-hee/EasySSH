/**
 * 单词补全服务
 * 提供常用单词、命令和参数的自动补全功能
 */

import log from './log';
import { autocompleteConfig } from '../config/app-config';

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

      // AI助手命令（已废弃，不再提供补全）
      ai: [],

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
      return this.computeWordSuggestions(input.trim(), limit, context);
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
