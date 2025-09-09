/**
 * 语言环境检测服务
 * 用于检测SSH服务器和客户端的语言环境，提供多语言兼容性支持
 */

// import { log } from '../../utils/logger.js'
const log = {
  debug: console.log,
  error: console.error,
  info: console.info,
  warn: console.warn
};

class LanguageDetector {
  constructor() {
    this.serverLanguage = 'unknown';
    this.clientLanguage = this.detectClientLanguage();
    this.supportedLanguages = ['zh-cn', 'en-us', 'ja-jp', 'ko-kr'];
    this.unicodeSupport = false;
  }

  /**
   * 检测客户端语言环境
   * @returns {string} 语言代码
   */
  detectClientLanguage() {
    try {
      const browserLang = navigator.language || navigator.userLanguage || 'en-US';
      return browserLang.toLowerCase();
    } catch (error) {
      log.error('检测客户端语言失败', error);
      return 'en-us';
    }
  }

  /**
   * 检测服务器语言环境
   * @param {string} terminalOutput 终端输出
   * @returns {Object} 检测结果
   */
  detectServerLanguage(terminalOutput) {
    try {
      const result = {
        language: 'unknown',
        encoding: 'unknown',
        unicodeSupport: false,
        confidence: 0
      };

      // 检测语言环境变量
      const envPatterns = {
        'zh-cn': [/LC_ALL=.*zh_CN/i, /LANG=.*zh_CN/i, /LC_CTYPE=.*zh_CN/i],
        'en-us': [/LC_ALL=.*en_US/i, /LANG=.*en_US/i, /LC_CTYPE=.*en_US/i, /LANG=C$/m],
        'ja-jp': [/LC_ALL=.*ja_JP/i, /LANG=.*ja_JP/i],
        'ko-kr': [/LC_ALL=.*ko_KR/i, /LANG=.*ko_KR/i]
      };

      // 检测字符内容
      const charPatterns = {
        'zh-cn': /[\u4e00-\u9fff]/,
        'ja-jp': /[\u3040-\u309f\u30a0-\u30ff]/,
        'ko-kr': /[\uac00-\ud7af]/
      };

      // 检测编码
      const encodingPatterns = {
        'utf-8': /UTF-?8/i,
        gbk: /GBK/i,
        gb2312: /GB2312/i,
        ascii: /ASCII/i
      };

      // 环境变量检测
      for (const [lang, patterns] of Object.entries(envPatterns)) {
        for (const pattern of patterns) {
          if (pattern.test(terminalOutput)) {
            result.language = lang;
            result.confidence = Math.max(result.confidence, 0.8);
            break;
          }
        }
      }

      // 字符内容检测（优先级高于环境变量）
      for (const [lang, pattern] of Object.entries(charPatterns)) {
        if (pattern.test(terminalOutput)) {
          result.language = lang;
          result.unicodeSupport = true;
          result.confidence = 0.95; // 字符检测置信度更高
          break;
        }
      }

      // 编码检测
      for (const [encoding, pattern] of Object.entries(encodingPatterns)) {
        if (pattern.test(terminalOutput)) {
          result.encoding = encoding;
          if (encoding === 'utf-8') {
            result.unicodeSupport = true;
          }
          break;
        }
      }

      // Unicode支持检测
      if (!result.unicodeSupport) {
        result.unicodeSupport = /[\u0080-\uffff]/.test(terminalOutput);
      }

      // 如果没有检测到具体语言，但支持Unicode，默认为英语
      if (result.language === 'unknown' && result.unicodeSupport) {
        result.language = 'en-us';
        result.confidence = 0.5;
      }

      // 如果不支持Unicode，标记为ASCII模式
      if (!result.unicodeSupport) {
        result.language = 'ascii';
        result.confidence = 0.7;
      }

      this.serverLanguage = result.language;
      this.unicodeSupport = result.unicodeSupport;

      log.debug('服务器语言检测结果', result);
      return result;
    } catch (error) {
      log.error('检测服务器语言失败', error);
      return {
        language: 'ascii',
        encoding: 'unknown',
        unicodeSupport: false,
        confidence: 0.3
      };
    }
  }

  /**
   * 检查是否需要ASCII兼容模式
   * @returns {boolean} 是否需要ASCII模式
   */
  shouldUseAsciiMode() {
    // 服务器不支持Unicode，且客户端使用非ASCII语言
    return !this.unicodeSupport && !this.clientLanguage.startsWith('en');
  }

  /**
   * 获取AI交互的推荐语言
   * @returns {string} 推荐语言
   */
  getRecommendedAILanguage() {
    if (this.shouldUseAsciiMode()) {
      return 'en-us'; // ASCII模式下使用英语
    }

    // 如果服务器支持客户端语言，使用客户端语言
    if (this.serverLanguage === this.clientLanguage.substring(0, 5)) {
      return this.clientLanguage;
    }

    // 如果服务器支持Unicode，使用客户端语言
    if (this.unicodeSupport) {
      return this.clientLanguage;
    }

    // 默认使用英语
    return 'en-us';
  }

  /**
   * 获取语言环境状态
   * @returns {Object} 状态信息
   */
  getStatus() {
    return {
      serverLanguage: this.serverLanguage,
      clientLanguage: this.clientLanguage,
      unicodeSupport: this.unicodeSupport,
      shouldUseAsciiMode: this.shouldUseAsciiMode(),
      recommendedAILanguage: this.getRecommendedAILanguage()
    };
  }

  /**
   * 文本ASCII兼容转换
   * @param {string} text 原始文本
   * @returns {string} ASCII兼容文本
   */
  toAsciiCompatible(text) {
    if (!this.shouldUseAsciiMode()) {
      return text;
    }

    try {
      // 基础中文转拼音映射
      const chineseMap = {
        // 常用词汇
        如何: 'How to',
        什么: 'What',
        为什么: 'Why',
        怎么: 'How',
        哪里: 'Where',
        什么时候: 'When',

        // 技术词汇
        错误: 'Error',
        修复: 'Fix',
        生成: 'Generate',
        脚本: 'Script',
        系统: 'System',
        内存: 'Memory',
        性能: 'Performance',
        网络: 'Network',
        文件: 'File',
        目录: 'Directory',
        权限: 'Permission',
        用户: 'User',
        进程: 'Process',
        服务: 'Service',

        // 操作词汇
        查看: 'View',
        显示: 'Show',
        列出: 'List',
        创建: 'Create',
        删除: 'Delete',
        复制: 'Copy',
        移动: 'Move',
        编辑: 'Edit',
        安装: 'Install',
        卸载: 'Uninstall',
        启动: 'Start',
        停止: 'Stop',
        重启: 'Restart'
      };

      let result = text;

      // 替换常用中文词汇
      for (const [chinese, english] of Object.entries(chineseMap)) {
        result = result.replace(new RegExp(chinese, 'g'), english);
      }

      // 移除剩余的非ASCII字符，用问号替代
      result = result.replace(/[^\x00-\x7F]/g, '?');

      return result;
    } catch (error) {
      log.error('ASCII转换失败', error);
      return text.replace(/[^\x00-\x7F]/g, '?');
    }
  }
}

// 创建全局实例
const languageDetector = new LanguageDetector();

export default languageDetector;
export { LanguageDetector };
