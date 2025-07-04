/**
 * 终端服务模块，负责创建和管理终端实例
 */
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
// LigaturesAddon 已移除 - 连字功能可选，避免导入问题
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import settingsService from './settings'
import log from './log'
import clipboard from './clipboard'

class TerminalService {
  constructor() {
    // 是否初始化
    this.isInitialized = false
    
    // 终端实例映射 Map<string, TerminalInstance>
    this.terminals = new Map()
    
    // 终端主题配置
    this.themes = {
      vscode: {
        foreground: '#CCCCCC',
        background: '#1E1E1E',
        cursor: '#FFFFFF',
        selectionBackground: '#264F78',
        black: '#000000',
        red: '#CD3131',
        green: '#0DBC79',
        yellow: '#E5E510',
        blue: '#2472C8',
        magenta: '#BC3FBC',
        cyan: '#11A8CD',
        white: '#E5E5E5',
        brightBlack: '#666666',
        brightRed: '#F14C4C',
        brightGreen: '#23D18B',
        brightYellow: '#F5F543',
        brightBlue: '#3B8EEA',
        brightMagenta: '#D670D6',
        brightCyan: '#29B8DB',
        brightWhite: '#FFFFFF'
      },
      dark: {
        foreground: '#F8F8F2',
        background: '#121212',
        cursor: '#F8F8F0',
        selectionBackground: '#49483E',
        black: '#272822',
        red: '#F92672',
        green: '#A6E22E',
        yellow: '#F4BF75',
        blue: '#66D9EF',
        magenta: '#AE81FF',
        cyan: '#A1EFE4',
        white: '#F8F8F2',
        brightBlack: '#75715E',
        brightRed: '#F92672',
        brightGreen: '#A6E22E',
        brightYellow: '#F4BF75',
        brightBlue: '#66D9EF',
        brightMagenta: '#AE81FF',
        brightCyan: '#A1EFE4',
        brightWhite: '#F9F8F5'
      },
      light: {
        foreground: '#000000',
        background: '#FFFFFF',
        cursor: '#000000',
        selectionBackground: '#ACCEF7',
        black: '#000000',
        red: '#C91B00',
        green: '#00C200',
        yellow: '#C7C400',
        blue: '#0225C7',
        magenta: '#CA30C7',
        cyan: '#00C5C7',
        white: '#C7C7C7',
        brightBlack: '#686868',
        brightRed: '#FF6E67',
        brightGreen: '#5FF967',
        brightYellow: '#FEFB67',
        brightBlue: '#6871FF',
        brightMagenta: '#FF77FF',
        brightCyan: '#5FFDFF',
        brightWhite: '#FFFFFF'
      },
      dracula: {
        foreground: '#F8F8F2',
        background: '#282A36',
        cursor: '#F8F8F2',
        selectionBackground: '#44475A',
        black: '#21222C',
        red: '#FF5555',
        green: '#50FA7B',
        yellow: '#F1FA8C',
        blue: '#BD93F9',
        magenta: '#FF79C6',
        cyan: '#8BE9FD',
        white: '#F8F8F2',
        brightBlack: '#6272A4',
        brightRed: '#FF6E6E',
        brightGreen: '#69FF94',
        brightYellow: '#FFFFA5',
        brightBlue: '#D6ACFF',
        brightMagenta: '#FF92DF',
        brightCyan: '#A4FFFF',
        brightWhite: '#FFFFFF'
      }
    }
    
    // 默认终端选项
    this.defaultOptions = {
      fontSize: 16,
      fontFamily: "'JetBrains Mono'",
      theme: this.themes.dark,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 1000,
      allowTransparency: true,
      rendererType: 'canvas',
      convertEol: true,
      disableStdin: false,
      drawBoldTextInBrightColors: true,
      copyOnSelect: false,
      rightClickSelectsWord: false,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5,
      screenReaderMode: false,
      macOptionIsMeta: false
    }
    
    // 活动终端ID (当前焦点终端)
    this.activeTerminalId = ref(null)
    
    // 终端事件侦听器
    this.eventListeners = {}
  }
  
  /**
   * 初始化终端服务
   * @returns {Promise<boolean>} - 是否初始化成功
   */
  async init() {
    try {
      if (this.isInitialized) {
        return Promise.resolve(true)
      }

      // 从设置服务加载终端配置
      try {
        const terminalSettings = settingsService.getTerminalOptions()
        if (terminalSettings) {
          this.defaultOptions = {
            ...this.defaultOptions,
            ...terminalSettings
          }
        }
      } catch (error) {
        log.warn('获取终端设置失败，使用默认选项', error)
      }

      this.isInitialized = true
      return Promise.resolve(true)
    } catch (error) {
      log.error('终端服务初始化失败', error)
      return Promise.resolve(false)
    }
  }
  
  /**
   * 初始化SSH终端并连接监控服务
   * @param {String} sshSessionId SSH会话ID
   * @param {String} host 主机地址
   */
  initTerminal(sshSessionId, host) {
    // 检查监控服务是否已连接到目标主机
    if (window.monitoringAPI) {
      const status = window.monitoringAPI.getStatus()
      if (status.connected && status.targetHost === host) {
        return
      }
    }

    // 异步连接监控服务
    import('./monitoring.js').then(({ default: monitoringService }) => {
      monitoringService.connect(sshSessionId, host).catch(() => {});
    }).catch(() => {});
  }
  
  /**
   * 创建新终端实例
   * @param {string} id - 终端ID
   * @param {HTMLElement} container - 终端容器元素
   * @param {Object} options - 终端选项
   * @returns {Promise<Object>} - 终端实例
   */
  async createTerminal(id, container, options = {}) {
    if (!id || !container) {
      log.error('创建终端失败：缺少必需参数')
      return null
    }
    
    try {
      // 如果ID已存在，先销毁旧实例
      if (this.terminals.has(id)) {
        this.destroyTerminal(id)
      }
      
      // 合并选项
      const termOptions = { ...this.defaultOptions, ...options }
      
      // 添加性能优化选项
      termOptions.allowProposedApi = true // 允许使用提议的API
      termOptions.minimumContrastRatio = 1 // 减少对比度计算
      termOptions.fastScrollSensitivity = 5 // 提高滚动速度
      termOptions.scrollSensitivity = 1 // 设置滚动灵敏度
      termOptions.tabStopWidth = 8 // 标准Tab宽度
      
      // 优化大数据量渲染性能
      termOptions.windowsMode = false // 禁用Windows模式改善性能
      if (!termOptions.hasOwnProperty('logLevel')) {
        termOptions.logLevel = 'off' // 关闭xterm内部日志
      }
      
      // 启用ANSI解析器优化
      termOptions.customGlyphs = true // 使用自定义字形渲染
      
      // 创建xterm实例
      const terminal = new Terminal(termOptions)
      
      // 添加插件，收集插件引用以便后续管理
      const addons = {
        fit: null,
        webLinks: null,
        search: null,
        webgl: null,
        unicode11: null,
        ligatures: null
      }
      
      // 添加FitAddon
      try {
        const fitAddon = new FitAddon()
        terminal.loadAddon(fitAddon)
        addons.fit = fitAddon
      } catch (e) {
        log.warn(`终端 ${id} 加载FitAddon失败:`, e)
      }
      
      // 添加WebLinksAddon
      try {
        const webLinksAddon = new WebLinksAddon()
        terminal.loadAddon(webLinksAddon)
        addons.webLinks = webLinksAddon
      } catch (e) {
        log.warn(`终端 ${id} 加载WebLinksAddon失败:`, e)
      }
      
      // 添加SearchAddon
      try {
        const searchAddon = new SearchAddon()
        terminal.loadAddon(searchAddon)
        addons.search = searchAddon
      } catch (e) {
        log.warn(`终端 ${id} 加载SearchAddon失败:`, e)
      }
      
      // 添加WebGL渲染插件 (优先使用WebGL渲染)
      try {
        const webglAddon = new WebglAddon()
        // 使用try-catch以防WebGL不可用
        try {
        terminal.loadAddon(webglAddon)
        addons.webgl = webglAddon
          
          // 设置额外的渲染器选项
          if (webglAddon.onContextLoss) {
            webglAddon.onContextLoss(e => {
              log.warn(`终端 ${id} WebGL上下文丢失，尝试恢复`, e)
              // 尝试创建新的WebGL渲染器
              try {
                const newWebglAddon = new WebglAddon()
                terminal.loadAddon(newWebglAddon)
                addons.webgl = newWebglAddon
                log.info(`终端 ${id} WebGL渲染器已恢复`)
              } catch (err) {
                log.error(`终端 ${id} WebGL渲染器恢复失败`, err)
              }
            })
          }
        } catch (innerErr) {
          log.warn(`终端 ${id} WebGL渲染初始化失败，回退到canvas渲染`, innerErr)
        }
      } catch (e) {
        log.warn(`终端 ${id} 加载WebglAddon失败:`, e)
      }
      
      // 添加Unicode11Addon (可选)
      try {
        const unicode11Addon = new Unicode11Addon()
        terminal.loadAddon(unicode11Addon)
        terminal.unicode.activeVersion = '11'
        addons.unicode11 = unicode11Addon
      } catch (e) {
        log.warn('Unicode11插件加载失败', e)
      }
      
      // LigaturesAddon 已移除 - 由于包导入问题，暂时移除连字功能
      // 连字功能是可选的，不影响终端的核心功能
      // 如果需要连字支持，可以考虑使用其他方案或等待包修复
      
      // 记录终端创建的性能指标
      const createStartTime = performance.now()
      
      // 打开终端
      terminal.open(container)
      
      // 记录打开终端的时间
      const openTime = performance.now() - createStartTime
      if (openTime > 50) { // 如果打开时间超过50ms，记录性能问题
        log.info(`终端 ${id} 打开耗时较长: ${openTime.toFixed(2)}ms`)
      }
      
      // 适应容器大小
      setTimeout(() => {
        try {
          if (addons.fit) {
            const fitStartTime = performance.now()
            addons.fit.fit()
            const fitTime = performance.now() - fitStartTime
            if (fitTime > 20) { // 如果适配时间超过20ms，记录性能问题
              log.debug(`终端 ${id} 大小适配耗时: ${fitTime.toFixed(2)}ms`)
            }
          }
        } catch (e) {
          log.warn('终端大小适应失败', e)
        }
      }, 0)
      
      // 设置活动终端
      this.activeTerminalId.value = id
      
      // 设置终端事件
      this._setupTerminalEvents(terminal, id)
      
      // 性能监控 - 定期检查终端性能（降低频率到2分钟）
      const performanceMonitor = setInterval(() => {
        if (!this.terminals.has(id)) {
          clearInterval(performanceMonitor)
          return
        }

        // 检查终端尺寸是否过大
        try {
          const dims = terminal._core?._renderService?.dimensions
          if (dims?.css?.canvas &&
              (dims.css.canvas.width > 2000 || dims.css.canvas.height > 2000)) {
            log.warn(`终端 ${id} 尺寸过大，可能影响性能`)
          }
        } catch (e) {
          // 静默忽略错误
        }
      }, 120000) // 每2分钟检查一次
      
      // 创建终端实例对象
      const terminalInstance = {
        id,
        terminal,
        addons,  // 存储所有插件引用
        container,
        buffer: '',
        performanceMonitor, // 存储性能监视器引用以便清理
        searchOptions: {
          caseSensitive: false,
          wholeWord: false,
          regex: false,
          incremental: true
        },
        // 添加性能计数器
        performanceStats: {
          writeCount: 0,
          totalWriteTime: 0,
          lastWriteTime: 0,
          maxWriteTime: 0,
          largeUpdates: 0
        }
      }
      
      // 重写终端write方法以进行性能跟踪
      const originalWrite = terminal.write.bind(terminal)
      terminal.write = (data) => {
        const writeStart = performance.now()
        const result = originalWrite(data)
        const writeTime = performance.now() - writeStart

        // 更新性能统计
        terminalInstance.performanceStats.writeCount++
        terminalInstance.performanceStats.totalWriteTime += writeTime
        terminalInstance.performanceStats.lastWriteTime = writeTime

        if (writeTime > terminalInstance.performanceStats.maxWriteTime) {
          terminalInstance.performanceStats.maxWriteTime = writeTime
        }

        // 检测严重的性能问题（提高阈值，减少日志）
        if (writeTime > 100 && data.length > 5000) {
          terminalInstance.performanceStats.largeUpdates++
          if (terminalInstance.performanceStats.largeUpdates % 20 === 1) {
            log.warn(`终端 ${id} 性能警告: ${writeTime.toFixed(2)}ms`)
          }
        }

        return result
      }
      
      // 存储终端实例
      this.terminals.set(id, terminalInstance)

      return terminalInstance
    } catch (error) {
      log.error(`创建终端 ${id} 失败`, error)
      ElMessage.error('创建终端失败')
      return null
    }
  }
  
  /**
   * 设置终端事件
   * @param {Terminal} terminal - xterm终端实例
   * @param {string} id - 终端ID
   * @private
   */
  _setupTerminalEvents(terminal, id) {
    // 处理数据事件
    terminal.onData(data => {
      this._emitEvent('data', { id, data })
    })
    
    // 处理标题变更事件
    terminal.onTitleChange(title => {
      this._emitEvent('title', { id, title })
    })
    
    // 处理选择事件
    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection()
      
      // 获取当前的终端设置
      const terminalOptions = settingsService.getTerminalOptions()
      
      if (selection && terminalOptions.copyOnSelect) {
        clipboard.copyText(selection, { silent: true })
      }
      
      this._emitEvent('selection', { id, selection })
    })
    
    // 处理光标移动事件
    terminal.onCursorMove(() => {
      const cursorPosition = {
        x: terminal.buffer.active.cursorX,
        y: terminal.buffer.active.cursorY
      }
      this._emitEvent('cursor', { id, position: cursorPosition })
    })
    
    // 处理按键事件
    terminal.onKey(({ key, domEvent }) => {
      this._emitEvent('key', { id, key, domEvent })
    })
    
    // 处理滚动事件
    terminal.onScroll(scrollPosition => {
      this._emitEvent('scroll', { id, scrollPosition })
    })
    
    // 处理终端获得焦点事件
    terminal.onFocus(() => {
      this.activeTerminalId.value = id
      this._emitEvent('focus', { id })
    })
    
    // 处理终端失去焦点事件
    terminal.onBlur(() => {
      this._emitEvent('blur', { id })
    })
    
    // 处理右键点击事件
    const element = terminal.element
    if (element) {
      element.addEventListener('contextmenu', (event) => {
        // 获取当前的终端设置
        const terminalOptions = settingsService.getTerminalOptions()
        
        if (terminalOptions.rightClickSelectsWord) {
          event.preventDefault()
          
          // 获取粘贴板内容并写入终端
          clipboard.readText().then(text => {
            if (text) {
              terminal.paste(text)
            }
          }).catch(error => {
            log.error('从粘贴板获取文本失败', error)
          })
        }
      })
    }
  }
  
  /**
   * 发送事件
   * @param {string} eventName - 事件名称
   * @param {Object} data - 事件数据
   * @private
   */
  _emitEvent(eventName, data) {
    if (!this.eventListeners[eventName]) {
      return
    }
    
    this.eventListeners[eventName].forEach(listener => {
      try {
        listener(data)
      } catch (error) {
        log.error(`执行事件监听器 ${eventName} 失败`, error)
      }
    })
  }
  
  /**
   * 添加事件监听器
   * @param {string} eventName - 事件名称
   * @param {Function} listener - 监听器函数
   */
  on(eventName, listener) {
    if (!this.eventListeners[eventName]) {
      this.eventListeners[eventName] = []
    }
    
    this.eventListeners[eventName].push(listener)
  }
  
  /**
   * 移除事件监听器
   * @param {string} eventName - 事件名称
   * @param {Function} listener - 监听器函数
   */
  off(eventName, listener) {
    if (!this.eventListeners[eventName]) {
      return
    }
    
    if (!listener) {
      // 移除所有该事件的监听器
      this.eventListeners[eventName] = []
      return
    }
    
    const index = this.eventListeners[eventName].indexOf(listener)
    if (index !== -1) {
      this.eventListeners[eventName].splice(index, 1)
    }
  }
  
  /**
   * 获取终端实例
   * @param {string} id - 终端ID
   * @returns {Object|null} - 终端实例或null
   */
  getTerminal(id) {
    return this.terminals.get(id) || null
  }
  
  /**
   * 获取当前活动终端
   * @returns {Object|null} - 活动终端实例或null
   */
  getActiveTerminal() {
    if (!this.activeTerminalId.value) {
      return null
    }
    
    return this.getTerminal(this.activeTerminalId.value)
  }
  
  /**
   * 向终端写入数据
   * @param {string} id - 终端ID
   * @param {string} data - 要写入的数据
   */
  write(id, data) {
    const term = this.getTerminal(id)
    if (!term) return
    
    term.terminal.write(data)
  }
  
  /**
   * 清空终端
   * @param {string} id - 终端ID
   */
  clear(id) {
    const term = this.getTerminal(id)
    if (!term) return
    
    term.terminal.clear()
  }
  
  /**
   * 适应终端大小
   * @param {string} id - 终端ID
   */
  fit(id) {
    const term = this.getTerminal(id)
    if (!term || !term.addons.fit) return
    
    try {
      term.addons.fit.fit()
    } catch (error) {
      log.error(`终端 ${id} 适应大小失败`, error)
    }
  }
  
  /**
   * 销毁终端实例
   * @param {string} id - 终端ID
   */
  destroyTerminal(id) {
    const term = this.getTerminal(id)
    if (!term) {
      log.warn(`尝试销毁不存在的终端: ${id}`)
      return
    }
    
    log.debug(`销毁终端 ${id}`)

    try {
      // 清理性能监视器
      if (term.performanceMonitor) {
        clearInterval(term.performanceMonitor)
        term.performanceMonitor = null
      }
      
      // 恢复原始的write方法
      if (term.terminal && term.terminal.write && term.terminal._core) {
        try {
          // 尝试恢复原始的write方法
          const originalWriteMethod = Terminal.prototype.write
          if (originalWriteMethod && typeof originalWriteMethod === 'function') {
            term.terminal.write = originalWriteMethod.bind(term.terminal)
          }
        } catch (e) {
          // 忽略方法恢复错误
        }
      }
      
      // 从存储中移除
      this.terminals.delete(id)
      
      // 安全地销毁终端实例
      if (term.terminal) {
        try {
          log.debug(`开始安全销毁终端 ${id} 实例`);

          // 创建安全的内部销毁函数
          const safeDestroyTerminalAndAddons = () => {
            // 1. 首先确保清理 addons 对象中的所有引用
            if (term.addons) {
              log.debug(`销毁终端 ${id} 的 ${Object.keys(term.addons).length} 个插件`);

              // 创建插件列表副本
              const addonEntries = Object.entries(term.addons).filter(([_, addon]) => !!addon);
              
              // 清空原引用集合，防止后续重复销毁
              for (const key in term.addons) {
                term.addons[key] = null;
              }
              
              // 逐个尝试销毁插件
              for (const [name, addon] of addonEntries) {
                try {
                  if (addon && typeof addon === 'object' && typeof addon.dispose === 'function') {
                    // 包装dispose方法以安全处理可能的错误
                    const originalDispose = addon.dispose;
                    addon.dispose = function() {
                      try {
                        return originalDispose.apply(this, arguments);
                      } catch (e) {
                        // 特别处理"addon has not been loaded"错误
                        if (e.message && e.message.includes("addon that has not been loaded")) {
                          log.debug(`忽略插件 ${name} 未加载错误`);
                        } else {
                          log.warn(`终端 ${id} 销毁插件 ${name} 时出错: ${e.message}`);
                        }
                      }
                    };
                    addon.dispose();
                    log.debug(`终端 ${id} 的插件 ${name} 已销毁`);
                  }
                } catch (e) {
                  log.warn(`终端 ${id} 安全包装插件 ${name} 时出错: ${e.message}`);
                }
              }
            }
            
            // 2. 检查并清理核心插件管理器
            try {
              if (term.terminal._core) {
                // 处理可能不存在的_addonManager
                if (term.terminal._core._addonManager) {
                  if (Array.isArray(term.terminal._core._addonManager._addons)) {
                    // 创建副本并清空原数组
                    const registeredAddons = [...term.terminal._core._addonManager._addons].filter(addon => !!addon);
                    term.terminal._core._addonManager._addons = [];
                    
                    // 覆盖注册方法，防止dispose后再注册
                    if (typeof term.terminal._core._addonManager.registerAddon === 'function') {
                      term.terminal._core._addonManager.registerAddon = function(addon) {
                        log.warn(`忽略终端销毁过程中的插件注册尝试`);
                        return addon;
                      };
                    }
                    
                    // 安全地销毁每个已注册的插件
                    for (const addon of registeredAddons) {
                      try {
                        // 覆盖插件的dispose方法，防止抛出异常
                        if (typeof addon.dispose === 'function') {
                          const originalDispose = addon.dispose;
                          addon.dispose = function() {
                            try {
                              return originalDispose.apply(this, arguments);
                            } catch (e) {
                              // 特别处理"addon has not been loaded"错误
                              if (e.message && e.message.includes("addon that has not been loaded")) {
                                log.debug(`忽略核心插件未加载错误`);
                              } else {
                                log.warn(`安全忽略插件销毁错误: ${e.message}`);
                              }
                            }
                          };
                          addon.dispose();
                        }
                      } catch (addonError) {
                        log.warn(`安全处理核心插件时出错: ${addonError.message}`);
                      }
                    }
                  } else {
                    log.debug(`终端 ${id} 的核心插件管理器没有有效的_addons数组`);
                  }
                } else {
                  log.debug(`终端 ${id} 没有_addonManager属性`);
                }
                
                // 清理可能的事件监听器
                try {
                  if (term.terminal._core._events) {
                    log.debug(`清理终端 ${id} 的事件监听器`);
                    for (const eventName in term.terminal._core._events) {
                      term.terminal._core._events[eventName] = null;
                    }
                  }
                } catch (eventsError) {
                  log.warn(`清理终端 ${id} 事件监听器失败: ${eventsError.message}`);
                }

                log.debug(`终端 ${id} 的核心插件管理器已清理`);
              }
            } catch (coreManagerError) {
              log.warn(`终端 ${id} 清理核心插件管理器失败: ${coreManagerError.message}`);
            }
            
            // 3. 安全地销毁终端实例
            try {
              if (typeof term.terminal.dispose === 'function') {
                // 修改dispose方法防止其抛出异常
                const originalDispose = term.terminal.dispose;
                term.terminal.dispose = function() {
                  try {
                    return originalDispose.apply(this, arguments);
                  } catch (e) {
                    // 特别处理"addon has not been loaded"错误
                    if (e.message && e.message.includes("addon that has not been loaded")) {
                      log.debug(`忽略终端实例销毁时的插件未加载错误`);
                    } else {
                      log.warn(`安全忽略终端实例销毁错误: ${e.message}`);
                    }
                  }
                };
                term.terminal.dispose();
                log.debug(`终端 ${id} 实例已销毁`);
              } else {
                log.warn(`终端 ${id} 实例缺少dispose方法`);
              }
            } catch (disposeError) {
              log.warn(`终端 ${id} 实例最终销毁尝试失败: ${disposeError.message}`);
            }
          };
          
          // 执行安全销毁
          safeDestroyTerminalAndAddons();
          
          // 帮助垃圾回收
          setTimeout(() => {
            // 在下一个事件循环周期中清空引用
            for (const key in term) {
              term[key] = null;
            }
            
            // 尝试触发垃圾回收
            if (typeof window.gc === 'function') {
              try {
                window.gc();
              } catch (e) {
                // 忽略
              }
            }
          }, 100);
          
        } catch (termError) {
          log.warn(`终端 ${id} 销毁过程中发生错误: ${termError.message}`);
        }
      }
      
      // 移除活动终端ID
      if (this.activeTerminalId.value === id) {
        this.activeTerminalId.value = null
      }

      log.debug(`销毁终端 ${id} 成功`)
    } catch (error) {
      log.error(`销毁终端 ${id} 失败`, error)
    }
  }
  
  /**
   * 在终端中搜索
   * @param {string} id - 终端ID
   * @param {string} query - 搜索关键字
   * @param {Object} options - 搜索选项
   * @param {boolean} options.caseSensitive - 是否区分大小写
   * @param {boolean} options.wholeWord - 是否全字匹配
   * @param {boolean} options.regex - 是否使用正则表达式
   * @param {boolean} options.incremental - 是否增量搜索
   * @returns {boolean} - 是否找到匹配
   */
  search(id, query, options = {}) {
    const term = this.getTerminal(id)
    if (!term || !term.addons || !term.addons.search) return false
    
    try {
      // 合并默认搜索选项
      const searchOptions = { ...term.searchOptions, ...options }
      term.searchOptions = searchOptions
      
      if (!query) return false
      
      // 执行搜索
      return term.addons.search.findNext(query, {
        caseSensitive: searchOptions.caseSensitive,
        wholeWord: searchOptions.wholeWord,
        regex: searchOptions.regex,
        incremental: searchOptions.incremental
      })
    } catch (error) {
      log.error(`终端 ${id} 搜索失败`, error)
      return false
    }
  }
  
  /**
   * 查找下一个匹配
   * @param {string} id - 终端ID
   * @returns {boolean} - 是否找到匹配
   */
  findNext(id) {
    const term = this.getTerminal(id)
    if (!term || !term.addons || !term.addons.search) return false
    
    try {
      return term.addons.search.findNext()
    } catch (error) {
      log.error(`终端 ${id} 查找下一个匹配失败`, error)
      return false
    }
  }
  
  /**
   * 查找上一个匹配
   * @param {string} id - 终端ID
   * @returns {boolean} - 是否找到匹配
   */
  findPrevious(id) {
    const term = this.getTerminal(id)
    if (!term || !term.addons || !term.addons.search) return false
    
    try {
      return term.addons.search.findPrevious()
    } catch (error) {
      log.error(`终端 ${id} 查找上一个匹配失败`, error)
      return false
    }
  }
}

export default new TerminalService() 