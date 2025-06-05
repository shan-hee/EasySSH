/**
 * 脚本库服务
 * 管理脚本数据，提供搜索和过滤功能
 */
import { ref } from 'vue'

class ScriptLibraryService {
  constructor() {
    // 脚本数据
    this.scripts = ref([
      {
        id: 1,
        name: '系统信息收集脚本',
        description: '收集服务器系统信息，包括CPU、内存、磁盘使用情况等。',
        author: '管理员',
        tags: ['系统', '监控', '信息收集'],
        updatedAt: new Date('2023-12-01'),
        isFavorite: true,
        command: 'free -h && df -h && cat /proc/cpuinfo | grep "model name" | head -1',
        keywords: ['系统', '信息', '内存', '磁盘', 'cpu', 'free', 'df']
      },
      {
        id: 2,
        name: '网络连接检测',
        description: '检测服务器与指定目标的网络连接状态。',
        author: '网络管理员',
        tags: ['网络', '诊断', '连接测试'],
        updatedAt: new Date('2023-11-15'),
        isFavorite: false,
        command: 'ping -c 4 google.com && traceroute baidu.com',
        keywords: ['网络', '连接', '检测', 'ping', 'traceroute']
      },
      {
        id: 3,
        name: '数据库备份脚本',
        description: '自动备份MySQL/PostgreSQL数据库并上传到指定位置。',
        author: '数据库管理员',
        tags: ['数据库', '备份', 'MySQL', 'PostgreSQL'],
        updatedAt: new Date('2023-10-28'),
        isFavorite: true,
        command: 'mysqldump -u root -p mydb > /backup/mydb_$(date +%Y%m%d).sql && gzip /backup/mydb_$(date +%Y%m%d).sql',
        keywords: ['数据库', '备份', 'mysql', 'mysqldump', '压缩']
      },
      {
        id: 4,
        name: '进程监控',
        description: '查看系统进程状态和资源使用情况。',
        author: '系统管理员',
        tags: ['进程', '监控', '系统'],
        updatedAt: new Date('2023-12-05'),
        isFavorite: false,
        command: 'ps aux | head -20 && top -n 1',
        keywords: ['进程', '监控', 'ps', 'top', '资源']
      },
      {
        id: 5,
        name: '日志查看',
        description: '查看系统日志和应用日志。',
        author: '运维工程师',
        tags: ['日志', '查看', '系统'],
        updatedAt: new Date('2023-12-03'),
        isFavorite: true,
        command: 'tail -f /var/log/syslog',
        keywords: ['日志', '查看', 'tail', 'log', 'syslog']
      },
      {
        id: 6,
        name: '文件查找',
        description: '在系统中查找指定文件。',
        author: '系统管理员',
        tags: ['文件', '查找', '搜索'],
        updatedAt: new Date('2023-11-28'),
        isFavorite: false,
        command: 'find / -name "*.log" -type f 2>/dev/null | head -10',
        keywords: ['文件', '查找', 'find', '搜索']
      },
      {
        id: 7,
        name: '服务状态检查',
        description: '检查系统服务运行状态。',
        author: '运维工程师',
        tags: ['服务', '状态', '检查'],
        updatedAt: new Date('2023-12-02'),
        isFavorite: true,
        command: 'systemctl status nginx && systemctl status mysql',
        keywords: ['服务', '状态', 'systemctl', 'nginx', 'mysql']
      },
      {
        id: 8,
        name: '磁盘清理',
        description: '清理系统临时文件和缓存。',
        author: '系统管理员',
        tags: ['磁盘', '清理', '维护'],
        updatedAt: new Date('2023-11-30'),
        isFavorite: false,
        command: 'sudo apt-get clean && sudo rm -rf /tmp/* && sudo journalctl --vacuum-time=7d',
        keywords: ['磁盘', '清理', 'clean', 'tmp', '缓存']
      }
    ])
    
    // 搜索历史
    this.searchHistory = ref([])
    
    // 常用命令
    this.frequentCommands = ref([])
  }

  /**
   * 获取所有脚本
   */
  getAllScripts() {
    return this.scripts.value
  }

  /**
   * 根据查询字符串搜索脚本
   * @param {string} query - 搜索查询
   * @param {Object} options - 搜索选项
   */
  searchScripts(query, options = {}) {
    if (!query || query.trim() === '') {
      return this.scripts.value
    }

    const searchQuery = query.toLowerCase().trim()
    const {
      matchName = true,
      matchDescription = true,
      matchCommand = true,
      matchKeywords = true,
      matchTags = true,
      fuzzyMatch = true
    } = options

    return this.scripts.value.filter(script => {
      // 精确匹配
      if (matchName && script.name.toLowerCase().includes(searchQuery)) {
        return true
      }
      
      if (matchDescription && script.description.toLowerCase().includes(searchQuery)) {
        return true
      }
      
      if (matchCommand && script.command.toLowerCase().includes(searchQuery)) {
        return true
      }
      
      if (matchKeywords && script.keywords && 
          script.keywords.some(keyword => keyword.toLowerCase().includes(searchQuery))) {
        return true
      }
      
      if (matchTags && script.tags && 
          script.tags.some(tag => tag.toLowerCase().includes(searchQuery))) {
        return true
      }

      // 模糊匹配
      if (fuzzyMatch) {
        const searchTerms = searchQuery.split(/\s+/)
        return searchTerms.every(term => {
          return (matchName && script.name.toLowerCase().includes(term)) ||
                 (matchDescription && script.description.toLowerCase().includes(term)) ||
                 (matchCommand && script.command.toLowerCase().includes(term)) ||
                 (matchKeywords && script.keywords && 
                  script.keywords.some(keyword => keyword.toLowerCase().includes(term))) ||
                 (matchTags && script.tags && 
                  script.tags.some(tag => tag.toLowerCase().includes(term)))
        })
      }

      return false
    })
  }

  /**
   * 获取命令建议
   * @param {string} input - 用户输入
   * @param {number} limit - 返回结果数量限制
   */
  getCommandSuggestions(input, limit = 10) {
    if (!input || input.trim() === '') {
      // 返回常用命令或最近使用的命令
      return this.getFrequentCommands().slice(0, limit)
    }

    const suggestions = this.searchScripts(input, {
      matchCommand: true,
      matchName: true,
      matchKeywords: true,
      fuzzyMatch: true
    })

    // 按相关性排序
    const scored = suggestions.map(script => ({
      ...script,
      score: this.calculateRelevanceScore(script, input)
    }))

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * 获取简化的命令建议（用于终端自动完成）
   * @param {string} input - 用户输入
   * @param {number} limit - 返回结果数量限制
   */
  getSimpleCommandSuggestions(input, limit = 8) {
    const suggestions = this.getCommandSuggestions(input, limit)

    return suggestions.map(script => ({
      id: script.id,
      text: this.extractMainCommand(script.command),
      description: script.name,
      fullCommand: script.command,
      score: script.score
    }))
  }

  /**
   * 提取命令的主要部分（第一个命令）
   * @param {string} command - 完整命令
   */
  extractMainCommand(command) {
    if (!command) return ''

    // 处理管道命令，取第一个命令
    const firstPart = command.split('|')[0].trim()

    // 处理复合命令，取第一个命令
    const firstCommand = firstPart.split('&&')[0].trim()

    // 提取命令名称（去掉参数）
    const commandParts = firstCommand.split(/\s+/)
    return commandParts[0] || command
  }

  /**
   * 计算相关性分数
   * @param {Object} script - 脚本对象
   * @param {string} input - 用户输入
   */
  calculateRelevanceScore(script, input) {
    const query = input.toLowerCase()
    let score = 0

    // 命令开头匹配得分最高
    if (script.command.toLowerCase().startsWith(query)) {
      score += 100
    }

    // 名称匹配
    if (script.name.toLowerCase().includes(query)) {
      score += 50
    }

    // 关键词匹配
    if (script.keywords) {
      script.keywords.forEach(keyword => {
        if (keyword.toLowerCase().includes(query)) {
          score += 30
        }
      })
    }

    // 标签匹配
    if (script.tags) {
      script.tags.forEach(tag => {
        if (tag.toLowerCase().includes(query)) {
          score += 20
        }
      })
    }

    // 命令包含匹配
    if (script.command.toLowerCase().includes(query)) {
      score += 10
    }

    // 收藏的脚本额外加分
    if (script.isFavorite) {
      score += 5
    }

    return score
  }

  /**
   * 获取常用命令
   */
  getFrequentCommands() {
    // 返回收藏的脚本作为常用命令
    return this.scripts.value.filter(script => script.isFavorite)
  }

  /**
   * 添加到搜索历史
   * @param {string} query - 搜索查询
   */
  addToSearchHistory(query) {
    if (!query || query.trim() === '') return

    const trimmedQuery = query.trim()
    
    // 移除重复项
    this.searchHistory.value = this.searchHistory.value.filter(item => item !== trimmedQuery)
    
    // 添加到开头
    this.searchHistory.value.unshift(trimmedQuery)
    
    // 限制历史记录数量
    if (this.searchHistory.value.length > 20) {
      this.searchHistory.value = this.searchHistory.value.slice(0, 20)
    }
  }

  /**
   * 获取搜索历史
   */
  getSearchHistory() {
    return this.searchHistory.value
  }

  /**
   * 根据ID获取脚本
   * @param {number} id - 脚本ID
   */
  getScriptById(id) {
    return this.scripts.value.find(script => script.id === id)
  }

  /**
   * 添加新脚本
   * @param {Object} scriptData - 脚本数据
   */
  addScript(scriptData) {
    const newScript = {
      id: Math.max(...this.scripts.value.map(s => s.id)) + 1,
      ...scriptData,
      updatedAt: new Date(),
      keywords: this.generateKeywords(scriptData)
    }

    this.scripts.value.push(newScript)
    return newScript
  }

  /**
   * 更新脚本
   * @param {number} id - 脚本ID
   * @param {Object} updates - 更新数据
   */
  updateScript(id, updates) {
    const index = this.scripts.value.findIndex(script => script.id === id)
    if (index !== -1) {
      this.scripts.value[index] = {
        ...this.scripts.value[index],
        ...updates,
        updatedAt: new Date(),
        keywords: this.generateKeywords({ ...this.scripts.value[index], ...updates })
      }
      return this.scripts.value[index]
    }
    return null
  }

  /**
   * 删除脚本
   * @param {number} id - 脚本ID
   */
  deleteScript(id) {
    const index = this.scripts.value.findIndex(script => script.id === id)
    if (index !== -1) {
      const deleted = this.scripts.value.splice(index, 1)[0]
      return deleted
    }
    return null
  }

  /**
   * 生成关键词
   * @param {Object} scriptData - 脚本数据
   */
  generateKeywords(scriptData) {
    const keywords = new Set()

    // 从名称提取关键词
    if (scriptData.name) {
      scriptData.name.split(/\s+/).forEach(word => {
        if (word.length > 1) {
          keywords.add(word.toLowerCase())
        }
      })
    }

    // 从描述提取关键词
    if (scriptData.description) {
      scriptData.description.split(/\s+/).forEach(word => {
        if (word.length > 2) {
          keywords.add(word.toLowerCase())
        }
      })
    }

    // 从命令提取关键词
    if (scriptData.command) {
      const commandWords = scriptData.command.match(/\b[a-zA-Z]+\b/g) || []
      commandWords.forEach(word => {
        if (word.length > 1) {
          keywords.add(word.toLowerCase())
        }
      })
    }

    // 添加标签
    if (scriptData.tags) {
      scriptData.tags.forEach(tag => {
        keywords.add(tag.toLowerCase())
      })
    }

    return Array.from(keywords)
  }
}

// 创建单例实例
const scriptLibraryService = new ScriptLibraryService()

export default scriptLibraryService
