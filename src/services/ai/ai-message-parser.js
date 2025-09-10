/**
 * AI消息解析服务
 * 负责解析AI消息内容，提取代码块，格式化文本等
 */

/**
 * 解析AI消息内容
 * @param {string} content 原始消息内容
 * @returns {Object} 解析结果
 */
export function parseAIMessage(content) {
  if (!content || typeof content !== 'string') {
    return {
      hasCodeBlocks: false,
      formattedContent: '',
      parsedContent: []
    };
  }

  const hasCodeBlocks = /```[\s\S]*?```/.test(content);

  if (!hasCodeBlocks) {
    return {
      hasCodeBlocks: false,
      formattedContent: formatMarkdownText(content),
      parsedContent: []
    };
  }

  return {
    hasCodeBlocks: true,
    formattedContent: '',
    parsedContent: parseContentWithCodeBlocks(content)
  };
}

/**
 * 解析包含代码块的内容
 * @param {string} content 原始内容
 * @returns {Array} 解析后的内容部分数组
 */
function parseContentWithCodeBlocks(content) {
  const parts = [];
  const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;

  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // 添加代码块前的文本
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index).trim();
      if (textContent) {
        parts.push({
          type: 'text',
          content: formatMarkdownText(textContent)
        });
      }
    }

    // 添加代码块
    const language = match[1] || 'shell';
    const code = match[2].trim();

    if (code) {
      parts.push({
        type: 'code',
        language: language.toLowerCase(),
        content: code,
        isExecutable: isExecutableLanguage(language)
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // 添加最后的文本
  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex).trim();
    if (textContent) {
      parts.push({
        type: 'text',
        content: formatMarkdownText(textContent)
      });
    }
  }

  return parts;
}

/**
 * 格式化Markdown文本
 * @param {string} text 原始文本
 * @returns {string} 格式化后的HTML
 */
function formatMarkdownText(text) {
  if (!text) return '';

  let formatted = text;

  // 处理粗体 **text**
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // 处理斜体 *text*
  formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // 处理行内代码 `code`
  formatted = formatted.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // 处理链接 [text](url)
  formatted = formatted.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // 处理换行
  formatted = formatted.replace(/\n/g, '<br>');

  // 处理列表项
  formatted = formatted.replace(/^[\s]*[-*+]\s+(.+)$/gm, '<li>$1</li>');
  formatted = formatted.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // 处理有序列表
  formatted = formatted.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li>$1</li>');
  formatted = formatted.replace(/(<li>.*<\/li>)/s, '<ol>$1</ol>');

  return formatted;
}

/**
 * 检查语言是否可执行
 * @param {string} language 编程语言
 * @returns {boolean} 是否可执行
 */
function isExecutableLanguage(language) {
  const executableLanguages = [
    'shell',
    'bash',
    'sh',
    'zsh',
    'fish',
    'powershell',
    'cmd',
    'bat',
    'python',
    'py',
    'node',
    'nodejs',
    'javascript',
    'js',
    'ruby',
    'rb',
    'perl',
    'pl'
  ];

  return executableLanguages.includes(language.toLowerCase());
}

/**
 * 提取消息中的所有命令
 * @param {string} content 消息内容
 * @returns {Array} 命令列表
 */
export function extractCommands(content) {
  const commands = [];
  const codeBlockRegex = /```(?:shell|bash|sh|zsh|fish|powershell|cmd|bat)?\n?([\s\S]*?)```/g;

  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const code = match[1].trim();
    const lines = code.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();

      // 跳过注释和空行
      if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
        continue;
      }

      // 跳过明显的输出行（以$、>、%等开头的提示符）
      if (/^[$>%#]\s/.test(trimmedLine)) {
        continue;
      }

      commands.push({
        command: trimmedLine,
        language: 'shell',
        isExecutable: true
      });
    }
  }

  return commands;
}

/**
 * 清理命令文本
 * @param {string} command 原始命令
 * @returns {string} 清理后的命令
 */
export function cleanCommand(command) {
  if (!command) return '';

  let cleaned = command.trim();

  // 移除常见的提示符
  cleaned = cleaned.replace(/^[$>%#]\s*/, '');

  // 移除行尾的注释
  cleaned = cleaned.replace(/\s*#.*$/, '');

  // 移除多余的空格
  cleaned = cleaned.replace(/\s+/g, ' ');

  return cleaned;
}

/**
 * 验证命令是否安全
 * @param {string} command 命令
 * @returns {Object} 验证结果
 */
export function validateCommand(command) {
  if (!command) {
    return { isValid: false, reason: '命令为空' };
  }

  const cleaned = cleanCommand(command);

  // 危险命令列表
  const dangerousCommands = [
    'rm -rf /',
    'rm -rf *',
    'rm -rf ~',
    'dd if=/dev/zero',
    'mkfs',
    'format',
    'shutdown',
    'reboot',
    'halt',
    'chmod 777 /',
    'chown -R',
    'curl | sh',
    'wget | sh',
    'sudo rm',
    'sudo dd'
  ];

  // 检查是否包含危险命令
  for (const dangerous of dangerousCommands) {
    if (cleaned.toLowerCase().includes(dangerous.toLowerCase())) {
      return {
        isValid: false,
        reason: `包含危险命令: ${dangerous}`,
        severity: 'high'
      };
    }
  }

  // 检查是否包含潜在危险的模式
  const dangerousPatterns = [
    /rm\s+-rf\s+[/~]/, // rm -rf / 或 rm -rf ~
    /dd\s+if=\/dev\/zero/, // dd if=/dev/zero
    />\s*\/dev\/sd[a-z]/, // 写入磁盘设备
    /curl.*\|\s*sh/, // curl | sh
    /wget.*\|\s*sh/ // wget | sh
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(cleaned)) {
      return {
        isValid: false,
        reason: '包含潜在危险的操作',
        severity: 'medium'
      };
    }
  }

  return { isValid: true };
}

/**
 * 格式化命令用于显示
 * @param {string} command 命令
 * @param {Object} options 格式化选项
 * @returns {string} 格式化后的命令
 */
export function formatCommandForDisplay(command, options = {}) {
  const { highlightSyntax = false, showLineNumbers: _showLineNumbers = false, maxLength = 100 } = options;

  let formatted = cleanCommand(command);

  // 截断过长的命令
  if (formatted.length > maxLength) {
    formatted = `${formatted.substring(0, maxLength)}...`;
  }

  // 语法高亮（简单实现）
  if (highlightSyntax) {
    // 高亮命令名
    formatted = formatted.replace(/^(\w+)/, '<span class="command-name">$1</span>');

    // 高亮选项
    formatted = formatted.replace(/(\s-+\w+)/g, '<span class="command-option">$1</span>');

    // 高亮字符串
    formatted = formatted.replace(/(["'].*?["'])/g, '<span class="command-string">$1</span>');
  }

  return formatted;
}

export default {
  parseAIMessage,
  extractCommands,
  cleanCommand,
  validateCommand,
  formatCommandForDisplay
};
