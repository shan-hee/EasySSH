/**
 * 命令检测器工具
 * 用于检测和分析文本中的命令
 */

/**
 * 检测文本中的命令
 * @param {string} text 要检测的文本
 * @returns {Array} 检测到的命令列表
 */
export function detectCommands(text) {
  if (!text || typeof text !== 'string') {
    return []
  }

  const commands = []
  
  // 检测代码块中的命令
  const codeBlockCommands = detectCodeBlockCommands(text)
  commands.push(...codeBlockCommands)
  
  // 检测行内命令
  const inlineCommands = detectInlineCommands(text)
  commands.push(...inlineCommands)
  
  // 去重并排序
  return deduplicateCommands(commands)
}

/**
 * 检测代码块中的命令
 * @param {string} text 文本内容
 * @returns {Array} 命令列表
 */
function detectCodeBlockCommands(text) {
  const commands = []
  const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g
  
  let match
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const language = (match[1] || 'shell').toLowerCase()
    const code = match[2].trim()
    
    if (isShellLanguage(language)) {
      const blockCommands = parseShellCommands(code)
      commands.push(...blockCommands.map(cmd => ({
        ...cmd,
        source: 'codeblock',
        language,
        startIndex: match.index,
        endIndex: match.index + match[0].length
      })))
    }
  }
  
  return commands
}

/**
 * 检测行内命令
 * @param {string} text 文本内容
 * @returns {Array} 命令列表
 */
function detectInlineCommands(text) {
  const commands = []
  
  // 匹配行内代码 `command`
  const inlineCodeRegex = /`([^`\n]+)`/g
  
  let match
  while ((match = inlineCodeRegex.exec(text)) !== null) {
    const code = match[1].trim()
    
    if (looksLikeCommand(code)) {
      commands.push({
        command: code,
        type: 'inline',
        source: 'inline',
        language: 'shell',
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        confidence: calculateCommandConfidence(code)
      })
    }
  }
  
  return commands
}

/**
 * 解析Shell命令
 * @param {string} code Shell代码
 * @returns {Array} 命令列表
 */
function parseShellCommands(code) {
  const commands = []
  const lines = code.split('\n')
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    
    // 跳过空行和注释
    if (!line || line.startsWith('#') || line.startsWith('//')) {
      continue
    }
    
    // 跳过明显的输出行
    if (isOutputLine(line)) {
      continue
    }
    
    // 处理多行命令（以 \ 结尾）
    let fullCommand = line
    let j = i
    while (fullCommand.endsWith('\\') && j + 1 < lines.length) {
      j++
      fullCommand = fullCommand.slice(0, -1) + ' ' + lines[j].trim()
    }
    i = j // 跳过已处理的行
    
    // 分割管道命令
    const pipeCommands = fullCommand.split('|').map(cmd => cmd.trim())
    
    for (const cmd of pipeCommands) {
      if (cmd && looksLikeCommand(cmd)) {
        commands.push({
          command: cleanCommand(cmd),
          type: 'shell',
          source: 'codeblock',
          language: 'shell',
          lineNumber: i + 1,
          confidence: calculateCommandConfidence(cmd)
        })
      }
    }
  }
  
  return commands
}

/**
 * 判断是否为Shell语言
 * @param {string} language 语言标识
 * @returns {boolean} 是否为Shell语言
 */
function isShellLanguage(language) {
  const shellLanguages = [
    'shell', 'bash', 'sh', 'zsh', 'fish',
    'powershell', 'cmd', 'bat', 'terminal'
  ]
  return shellLanguages.includes(language.toLowerCase())
}

/**
 * 判断是否看起来像命令
 * @param {string} text 文本
 * @returns {boolean} 是否像命令
 */
function looksLikeCommand(text) {
  if (!text || text.length < 2) return false
  
  const cleaned = text.trim()
  
  // 常见命令模式
  const commandPatterns = [
    /^[a-zA-Z][a-zA-Z0-9_-]*(\s|$)/, // 以字母开头的命令
    /^\.\/[a-zA-Z0-9_.-]+/, // 相对路径执行
    /^\/[a-zA-Z0-9_/.-]+/, // 绝对路径执行
    /^\w+\s+[a-zA-Z0-9_.-]+/, // 命令 + 参数
  ]
  
  // 检查是否匹配命令模式
  for (const pattern of commandPatterns) {
    if (pattern.test(cleaned)) {
      return true
    }
  }
  
  // 检查是否包含常见命令
  const commonCommands = [
    'ls', 'cd', 'pwd', 'mkdir', 'rmdir', 'rm', 'cp', 'mv',
    'cat', 'less', 'more', 'head', 'tail', 'grep', 'find',
    'chmod', 'chown', 'ps', 'kill', 'top', 'htop',
    'git', 'npm', 'yarn', 'pip', 'docker', 'kubectl',
    'curl', 'wget', 'ssh', 'scp', 'rsync'
  ]
  
  const firstWord = cleaned.split(/\s+/)[0].toLowerCase()
  return commonCommands.includes(firstWord)
}

/**
 * 判断是否为输出行
 * @param {string} line 行内容
 * @returns {boolean} 是否为输出行
 */
function isOutputLine(line) {
  // 常见的提示符模式
  const promptPatterns = [
    /^[\$>%#]\s/, // $ > % # 提示符
    /^\w+@\w+:.*\$\s/, // user@host:path$ 提示符
    /^\[.*\]\s*[\$>%#]\s/, // [info] $ 提示符
  ]
  
  for (const pattern of promptPatterns) {
    if (pattern.test(line)) {
      return false // 这些实际上是命令行提示符，不是输出
    }
  }
  
  // 输出特征
  const outputPatterns = [
    /^[A-Z][a-z]+:/, // Error: Warning: Info: 等
    /^\s+/, // 缩进的行通常是输出
    /^-{3,}/, // 分隔线
    /^\d+\.\d+/, // 版本号
    /^total\s+\d+/, // ls -l 的 total 行
  ]
  
  for (const pattern of outputPatterns) {
    if (pattern.test(line)) {
      return true
    }
  }
  
  return false
}

/**
 * 清理命令
 * @param {string} command 原始命令
 * @returns {string} 清理后的命令
 */
function cleanCommand(command) {
  if (!command) return ''
  
  let cleaned = command.trim()
  
  // 移除提示符
  cleaned = cleaned.replace(/^[\$>%#]\s*/, '')
  cleaned = cleaned.replace(/^\w+@\w+:.*\$\s*/, '')
  cleaned = cleaned.replace(/^\[.*\]\s*[\$>%#]\s*/, '')
  
  // 移除行尾注释
  cleaned = cleaned.replace(/\s*#.*$/, '')
  
  // 标准化空格
  cleaned = cleaned.replace(/\s+/g, ' ')
  
  return cleaned
}

/**
 * 计算命令置信度
 * @param {string} command 命令
 * @returns {number} 置信度 (0-1)
 */
function calculateCommandConfidence(command) {
  if (!command) return 0
  
  let confidence = 0.5 // 基础置信度
  
  const cleaned = cleanCommand(command)
  const words = cleaned.split(/\s+/)
  const firstWord = words[0].toLowerCase()
  
  // 常见命令加分
  const commonCommands = [
    'ls', 'cd', 'pwd', 'mkdir', 'rm', 'cp', 'mv',
    'cat', 'grep', 'find', 'git', 'npm', 'docker'
  ]
  
  if (commonCommands.includes(firstWord)) {
    confidence += 0.3
  }
  
  // 有参数加分
  if (words.length > 1) {
    confidence += 0.1
  }
  
  // 有选项加分
  if (cleaned.includes(' -')) {
    confidence += 0.1
  }
  
  // 路径特征加分
  if (/[\/\\]/.test(cleaned)) {
    confidence += 0.1
  }
  
  // 过长的命令减分
  if (cleaned.length > 100) {
    confidence -= 0.2
  }
  
  // 包含特殊字符减分
  if (/[<>|&;]/.test(cleaned)) {
    confidence += 0.1 // 实际上这些是Shell特征，应该加分
  }
  
  return Math.max(0, Math.min(1, confidence))
}

/**
 * 去重命令
 * @param {Array} commands 命令列表
 * @returns {Array} 去重后的命令列表
 */
function deduplicateCommands(commands) {
  const seen = new Set()
  const unique = []
  
  for (const cmd of commands) {
    const key = `${cmd.command}:${cmd.source}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(cmd)
    }
  }
  
  // 按置信度排序
  return unique.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
}

/**
 * 获取命令类型
 * @param {string} command 命令
 * @returns {string} 命令类型
 */
export function getCommandType(command) {
  if (!command) return 'unknown'
  
  const firstWord = command.trim().split(/\s+/)[0].toLowerCase()
  
  const commandTypes = {
    // 文件操作
    'ls': 'file', 'dir': 'file', 'cat': 'file', 'less': 'file', 'more': 'file',
    'head': 'file', 'tail': 'file', 'find': 'file', 'locate': 'file',
    'cp': 'file', 'mv': 'file', 'rm': 'file', 'mkdir': 'file', 'rmdir': 'file',
    'chmod': 'file', 'chown': 'file', 'ln': 'file',
    
    // 系统操作
    'ps': 'system', 'top': 'system', 'htop': 'system', 'kill': 'system',
    'killall': 'system', 'jobs': 'system', 'bg': 'system', 'fg': 'system',
    'nohup': 'system', 'screen': 'system', 'tmux': 'system',
    
    // 网络操作
    'curl': 'network', 'wget': 'network', 'ping': 'network', 'ssh': 'network',
    'scp': 'network', 'rsync': 'network', 'netstat': 'network',
    
    // 开发工具
    'git': 'development', 'npm': 'development', 'yarn': 'development',
    'pip': 'development', 'composer': 'development', 'maven': 'development',
    'gradle': 'development', 'make': 'development',
    
    // 容器化
    'docker': 'container', 'kubectl': 'container', 'helm': 'container',
    'podman': 'container',
    
    // 导航
    'cd': 'navigation', 'pwd': 'navigation', 'pushd': 'navigation', 'popd': 'navigation'
  }
  
  return commandTypes[firstWord] || 'general'
}

export default {
  detectCommands,
  getCommandType,
  looksLikeCommand: looksLikeCommand,
  cleanCommand,
  calculateCommandConfidence
}
