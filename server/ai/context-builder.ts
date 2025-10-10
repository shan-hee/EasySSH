/**
 * 上下文构建器（TypeScript）
 * 负责处理终端输出，构建AI请求上下文，并进行敏感信息脱敏
 */

import crypto from 'node:crypto';
import logger from '../utils/logger';

class ContextBuilder {
  maxLines: number;
  maxBytes: number;
  strictRedaction: boolean;
  sensitivePatterns: any[];
  constructor(options: any = {}) {
    this.maxLines = options.maxLines || 200;
    this.maxBytes = options.maxBytes || 32 * 1024; // 32KB
    this.strictRedaction = options.strictRedaction !== false; // 默认启用严格脱敏

    // 敏感信息检测模式
    this.sensitivePatterns = this._initSensitivePatterns();

    logger.debug('上下文构建器已初始化', {
      maxLines: this.maxLines,
      maxBytes: this.maxBytes,
      strictRedaction: this.strictRedaction
    });
  }

  /**
   * 构建AI请求上下文
   * @param {string} terminalOutput 终端输出
   * @param {string} currentInput 当前输入
   * @param {Object} options 选项
   * @returns {Object} 处理后的上下文
   */
  buildContext(terminalOutput: string, currentInput: string, options: any = {}) {
    const startTime = Date.now();

    try {
      const context = {
        terminalOutput: this._processTerminalOutput(terminalOutput),
        currentInput: this._sanitizeInput(currentInput),
        metadata: this._extractMetadata(terminalOutput, options),
        timestamp: new Date().toISOString(),
        processingTime: 0
      };

      // 应用安全过滤器
      const secureContext = this._applySecurityFilters(context);

      secureContext.processingTime = Date.now() - startTime;

      logger.debug('上下文构建完成', {
        outputLength: secureContext.terminalOutput?.length || 0,
        inputLength: secureContext.currentInput?.length || 0,
        processingTime: secureContext.processingTime
      });

      return secureContext;

    } catch (error) {
      logger.error('上下文构建失败', { error: error.message });
      throw new Error(`上下文构建失败: ${error.message}`);
    }
  }

  /**
   * 处理终端输出
   * @param {string} output 原始终端输出
   * @returns {string} 处理后的输出
   */
  _processTerminalOutput(output: string) {
    if (!output || typeof output !== 'string') {
      return '';
    }

    // 按行分割并限制行数
    const lines = output.split('\n');
    const limitedLines = lines.slice(-this.maxLines);
    let processedOutput = limitedLines.join('\n');

    // 限制字节数
    if (Buffer.byteLength(processedOutput, 'utf8') > this.maxBytes) {
      processedOutput = this._truncateToBytes(processedOutput, this.maxBytes);
    }

    // 脱敏敏感信息
    return this._redactSensitiveInfo(processedOutput);
  }

  /**
   * 脱敏敏感信息
   * @param {string} text 原始文本
   * @returns {string} 脱敏后的文本
   */
  _redactSensitiveInfo(text: string) {
    if (!text) return text;

    let redacted = text;

    // 应用所有敏感信息模式
    this.sensitivePatterns.forEach((pattern, index) => {
      if (pattern.regex) {
        const replacement = pattern.replacement || this._getDefaultReplacement(pattern.type);
        redacted = redacted.replace(pattern.regex, replacement);
      }
    });

    return redacted;
  }

  /**
   * 初始化敏感信息检测模式
   * @returns {Array} 敏感信息模式数组
   */
  _initSensitivePatterns() {
    return [
      // AWS访问密钥
      {
        type: 'aws_key',
        regex: /(AKIA|ASIA)[0-9A-Z]{16}/g,
        replacement: '***AWS_ACCESS_KEY***'
      },
      // Bearer Token
      {
        type: 'bearer_token',
        regex: /Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/g,
        replacement: '***BEARER_TOKEN***'
      },
      // 私钥
      {
        type: 'private_key',
        regex: /-----BEGIN (?:RSA|EC|OPENSSH|DSA) PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g,
        replacement: '***PRIVATE_KEY***'
      },
      // JWT Token
      {
        type: 'jwt_token',
        regex: /eyJ[A-Za-z0-9\-_]*\.[A-Za-z0-9\-_]*\.[A-Za-z0-9\-_]*/g,
        replacement: '***JWT_TOKEN***'
      },
      // 邮箱地址
      {
        type: 'email',
        regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        replacement: '***EMAIL***'
      },
      // 密码字段
      {
        type: 'password',
        regex: /password[=:\s]+[^\s\n]+/gi,
        replacement: 'password=***PASSWORD***'
      },
      // API密钥模式
      {
        type: 'api_key',
        regex: /(?:api[_-]?key|apikey)[=:\s]+[a-zA-Z0-9\-_]{20,}/gi,
        replacement: 'api_key=***API_KEY***'
      },
      // 数据库连接字符串
      {
        type: 'db_connection',
        regex: /(?:mysql|postgresql|mongodb):\/\/[^\s\n]+/gi,
        replacement: '***DATABASE_URL***'
      }
    ];
  }

  /**
   * 获取默认替换文本
   * @param {string} type 敏感信息类型
   * @returns {string} 替换文本
   */
  _getDefaultReplacement(type: string) {
    const replacements: Record<string, string> = {
      aws_key: '***AWS_ACCESS_KEY***',
      bearer_token: '***BEARER_TOKEN***',
      private_key: '***PRIVATE_KEY***',
      jwt_token: '***JWT_TOKEN***',
      email: '***EMAIL***',
      password: '***PASSWORD***',
      api_key: '***API_KEY***',
      db_connection: '***DATABASE_URL***'
    };
    return (replacements as any)[type] || '***REDACTED***';
  }

  /**
   * 提取元数据
   * @param {string} output 终端输出
   * @param {Object} options 选项
   * @returns {Object} 元数据
   */
  _extractMetadata(output: string, options: any = {}) {
    const metadata = {
      osHint: options.osHint || this._detectOS(output),
      shellHint: options.shellHint || this._detectShell(output),
      errorDetected: this._detectError(output),
      commandType: this._detectCommandType(output),
      riskLevel: 'low'
    };

    // 检测风险级别
    metadata.riskLevel = this._assessRiskLevel(output);

    return metadata;
  }

  /**
   * 检测操作系统
   * @param {string} output 终端输出
   * @returns {string} 操作系统类型
   */
  _detectOS(output: string) {
    if (!output) return 'unknown';

    const osPatterns = [
      { pattern: /Linux|Ubuntu|CentOS|Debian|RedHat|RHEL/i, os: 'linux' },
      { pattern: /Darwin|macOS|Mac OS/i, os: 'darwin' },
      { pattern: /Windows|MINGW|MSYS/i, os: 'windows' }
    ];

    for (const { pattern, os } of osPatterns) {
      if (pattern.test(output)) {
        return os;
      }
    }

    return 'unknown';
  }

  /**
   * 检测Shell类型
   * @param {string} output 终端输出
   * @returns {string} Shell类型
   */
  _detectShell(output: string) {
    if (!output) return 'unknown';

    const shellPatterns = [
      { pattern: /bash|\/bin\/bash/i, shell: 'bash' },
      { pattern: /zsh|\/bin\/zsh/i, shell: 'zsh' },
      { pattern: /fish|\/bin\/fish/i, shell: 'fish' },
      { pattern: /powershell|pwsh/i, shell: 'powershell' },
      { pattern: /cmd\.exe|command prompt/i, shell: 'cmd' }
    ];

    for (const { pattern, shell } of shellPatterns) {
      if (pattern.test(output)) {
        return shell;
      }
    }

    // 根据提示符推断
    if (output.includes('$ ')) return 'bash';
    if (output.includes('% ')) return 'zsh';
    if (output.includes('> ')) return 'cmd';

    return 'unknown';
  }

  /**
   * 检测错误
   * @param {string} output 终端输出
   * @returns {boolean} 是否检测到错误
   */
  _detectError(output: string) {
    if (!output) return false;

    const errorPatterns = [
      /error|failed|failure/i,
      /not found|command not found/i,
      /permission denied|access denied/i,
      /no such file or directory/i,
      /connection refused|connection failed/i,
      /timeout|timed out/i,
      /invalid|illegal/i,
      /cannot|can't|unable to/i
    ];

    return errorPatterns.some(pattern => pattern.test(output));
  }

  /**
   * 检测命令类型
   * @param {string} output 终端输出
   * @returns {string} 命令类型
   */
  _detectCommandType(output: string) {
    if (!output) return 'unknown';

    const commandPatterns = [
      { pattern: /docker|container/i, type: 'docker' },
      { pattern: /git|github|gitlab/i, type: 'git' },
      { pattern: /npm|yarn|node/i, type: 'nodejs' },
      { pattern: /python|pip|conda/i, type: 'python' },
      { pattern: /mysql|postgresql|database/i, type: 'database' },
      { pattern: /ssh|scp|rsync/i, type: 'network' },
      { pattern: /systemctl|service|daemon/i, type: 'system' }
    ];

    for (const { pattern, type } of commandPatterns) {
      if (pattern.test(output)) {
        return type;
      }
    }

    return 'general';
  }

  /**
   * 评估风险级别
   * @param {string} output 终端输出
   * @returns {string} 风险级别
   */
  _assessRiskLevel(output: string) {
    if (!output) return 'low';

    const highRiskPatterns = [
      /rm\s+-rf\s+\/(?!home|tmp|var\/tmp)/,
      /mkfs\s+/,
      /dd\s+if=.*of=\/dev\/[sh]d/,
      /shutdown\s+(-h|-r)/,
      /reboot/,
      /init\s+[06]/,
      /:(){ :|:& };:/ // fork bomb
    ];

    const mediumRiskPatterns = [
      /sudo\s+/,
      /chmod\s+777/,
      /chown\s+/,
      /iptables/,
      /firewall/
    ];

    if (highRiskPatterns.some(pattern => pattern.test(output))) {
      return 'high';
    }

    if (mediumRiskPatterns.some(pattern => pattern.test(output))) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * 截断文本到指定字节数
   * @param {string} text 原始文本
   * @param {number} maxBytes 最大字节数
   * @returns {string} 截断后的文本
   */
  _truncateToBytes(text: string, maxBytes: number) {
    const buffer = Buffer.from(text, 'utf8');
    if (buffer.length <= maxBytes) {
      return text;
    }

    // 截断并移除可能的不完整字符
    const truncated = buffer.slice(0, maxBytes).toString('utf8');
    return truncated.replace(/\uFFFD/g, ''); // 移除替换字符
  }

  /**
   * 清理输入
   * @param {string} input 用户输入
   * @returns {string} 清理后的输入
   */
  _sanitizeInput(input: any) {
    if (!input || typeof input !== 'string') {
      return '';
    }
    return this._redactSensitiveInfo(input.trim());
  }

  /**
   * 应用安全过滤器
   * @param {Object} context 上下文对象
   * @returns {Object} 过滤后的上下文
   */
  _applySecurityFilters(context: any) {
    const filtered = { ...context };

    // 严格模式下的额外检查
    if (this.strictRedaction) {
      // 检查是否包含高风险内容
      const hasHighRisk = context.metadata?.riskLevel === 'high';

      if (hasHighRisk) {
        filtered.securityWarning = 'High-risk command detected';
        logger.warn('检测到高风险命令', {
          riskLevel: context.metadata.riskLevel
        });
      }

      // 如果检测到私钥或敏感凭据，可以选择完全拒绝处理
      const hasCriticalSecrets = this._hasCriticalSecrets(context.terminalOutput);
      if (hasCriticalSecrets) {
        filtered.terminalOutput = '***CONTENT_BLOCKED_DUE_TO_SENSITIVE_DATA***';
        filtered.securityWarning = 'Content blocked due to sensitive data';
        logger.warn('由于敏感数据阻止内容传输');
      }
    }

    return filtered;
  }

  /**
   * 检查是否包含关键敏感信息
   * @param {string} text 文本内容
   * @returns {boolean} 是否包含关键敏感信息
   */
  _hasCriticalSecrets(text: any) {
    if (!text) return false;

    const criticalPatterns = [
      /-----BEGIN (?:RSA|EC|OPENSSH|DSA) PRIVATE KEY-----/,
      /(AKIA|ASIA)[0-9A-Z]{16}/,
      /password[=:\s]+[^\s\n]{8,}/i
    ];

    return criticalPatterns.some(pattern => pattern.test(text));
  }

  /**
   * 生成上下文哈希（用于缓存）
   * @param {Object} context 上下文对象
   * @returns {string} 哈希值
   */
  generateContextHash(context: any) {
    const hashContent = JSON.stringify({
      terminalOutput: context.terminalOutput?.substring(0, 1000), // 只取前1000字符
      currentInput: context.currentInput,
      osHint: context.metadata?.osHint,
      shellHint: context.metadata?.shellHint
    });

    return crypto.createHash('md5').update(hashContent).digest('hex');
  }
}

module.exports = ContextBuilder;
