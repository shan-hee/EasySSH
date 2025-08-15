/**
 * 终端服务模块，负责创建和管理终端实例
 */
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
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
      },
      material: {
        foreground: '#EEFFFF',
        background: '#263238',
        cursor: '#FFCC02',
        selectionBackground: '#546E7A',
        black: '#000000',
        red: '#F07178',
        green: '#C3E88D',
        yellow: '#FFCB6B',
        blue: '#82AAFF',
        magenta: '#C792EA',
        cyan: '#89DDFF',
        white: '#FFFFFF',
        brightBlack: '#546E7A',
        brightRed: '#FF5370',
        brightGreen: '#C3E88D',
        brightYellow: '#FFD54F',
        brightBlue: '#729FCF',
        brightMagenta: '#AD7FA8',
        brightCyan: '#34E2E2',
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
      rendererType: 'webgl', // 首选WebGL渲染器
      fallbackRenderer: 'canvas', // 备用Canvas渲染器
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
          log.debug(`终端服务加载配置: 渲染器=${terminalSettings.rendererType || 'webgl'}`);
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

      // 记录渲染器配置
      log.debug(`终端 ${id} 渲染器: ${termOptions.rendererType}`);

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

      // 渲染器优化配置
      if (termOptions.rendererType === 'webgl') {
        termOptions.allowTransparency = false // 禁用透明度以提升WebGL性能
        termOptions.drawBoldTextInBrightColors = false // 减少颜色计算

        // WebGL渲染器字体优化
        termOptions.fontWeight = 'normal' // 确保字体权重一致
        termOptions.fontWeightBold = 'bold' // 粗体字体权重
        termOptions.letterSpacing = 0 // 字符间距
        termOptions.lineHeight = 1.0 // 行高

        // WebGL特定的字体渲染优化
        termOptions.smoothScrollDuration = 0 // 禁用平滑滚动以提升性能
        termOptions.windowsMode = false // 禁用Windows模式
      } else if (termOptions.rendererType === 'canvas') {
        // Canvas渲染器字体优化
        termOptions.letterSpacing = 0 // 保持字符间距一致
        termOptions.lineHeight = 1.0 // 保持行高一致
        termOptions.smoothScrollDuration = 120 // Canvas可以使用适度的平滑滚动
      }

      termOptions.scrollback = Math.min(termOptions.scrollback || 3000, 5000) // 限制滚动缓冲区大小
      
      // 创建xterm实例
      const terminal = new Terminal(termOptions)
      
      // 添加插件，收集插件引用以便后续管理
      const addons = {
        fit: null,
        webLinks: null,
        search: null,
        webgl: null,
        canvas: null,
        unicode11: null,
        ligatures: null
      }
      
      // 添加FitAddon - 增强兼容性检查
      try {
        const fitAddon = new FitAddon()
        this._loadAddonSafely(terminal, fitAddon, 'fit', id)
        addons.fit = fitAddon
      } catch (e) {
        log.warn(`终端 ${id} 加载FitAddon失败:`, e)
      }

      // 添加WebLinksAddon - 增强兼容性检查
      try {
        const webLinksAddon = new WebLinksAddon()
        this._loadAddonSafely(terminal, webLinksAddon, 'webLinks', id)
        addons.webLinks = webLinksAddon
      } catch (e) {
        log.warn(`终端 ${id} 加载WebLinksAddon失败:`, e)
      }

      // 添加SearchAddon - 增强兼容性检查
      try {
        const searchAddon = new SearchAddon()
        this._loadAddonSafely(terminal, searchAddon, 'search', id)
        addons.search = searchAddon
      } catch (e) {
        log.warn(`终端 ${id} 加载SearchAddon失败:`, e)
      }
      
      // 智能渲染器选择：首选WebGL，备用Canvas，移除DOM
      let renderingMode = 'dom'; // 默认DOM渲染器

      // 开始渲染器选择

      try {
        // 首先尝试WebGL渲染器
        if (termOptions.rendererType === 'webgl') {
          // 检查WebGL支持
          const canvas = document.createElement('canvas');
          const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

          if (gl) {
            try {
              const webglAddon = new WebglAddon();
              terminal.loadAddon(webglAddon);
              addons.webgl = webglAddon;
              renderingMode = 'webgl';

              log.info(`终端 ${id} WebGL渲染器已启用`);

              // 设置WebGL上下文丢失处理
              if (webglAddon.onContextLoss) {
                webglAddon.onContextLoss(e => {
                  log.warn(`终端 ${id} WebGL上下文丢失，降级到Canvas渲染`, e);

                  // WebGL失败时加载Canvas渲染器
                  try {
                    const canvasAddon = new CanvasAddon();
                    terminal.loadAddon(canvasAddon);
                    addons.canvas = canvasAddon;
                    renderingMode = 'canvas';
                    log.info(`终端 ${id} 已切换到Canvas渲染器`);
                  } catch (canvasErr) {
                    log.warn(`终端 ${id} Canvas渲染器加载失败，使用DOM渲染`, canvasErr);
                    renderingMode = 'dom';
                  }
                });
              }

              // 增强WebGL性能监控
              if (webglAddon.onRender) {
                this._setupWebGLPerformanceMonitoring(webglAddon, terminal, id, addons);
              }

            } catch (webglErr) {
              log.warn(`终端 ${id} WebGL渲染器加载失败，尝试Canvas渲染`, webglErr);
              // 降级到Canvas渲染器
              try {
                const canvasAddon = new CanvasAddon();
                terminal.loadAddon(canvasAddon);
                addons.canvas = canvasAddon;
                renderingMode = 'canvas';
                log.info(`终端 ${id} Canvas渲染器已启用（WebGL降级）`);
              } catch (canvasErr) {
                log.warn(`终端 ${id} Canvas渲染器也加载失败，使用DOM渲染`, canvasErr);
                renderingMode = 'dom';
              }
            }
          } else {
            log.info(`终端 ${id} 浏览器不支持WebGL，尝试Canvas渲染`);
            // 降级到Canvas渲染器
            try {
              const canvasAddon = new CanvasAddon();
              terminal.loadAddon(canvasAddon);
              addons.canvas = canvasAddon;
              renderingMode = 'canvas';
              log.info(`终端 ${id} Canvas渲染器已启用（WebGL不支持）`);
            } catch (canvasErr) {
              log.warn(`终端 ${id} Canvas渲染器加载失败，使用DOM渲染`, canvasErr);
              renderingMode = 'dom';
            }
          }
        } else {
          // 直接使用Canvas渲染器
          try {
            const canvasAddon = new CanvasAddon();
            terminal.loadAddon(canvasAddon);
            addons.canvas = canvasAddon;
            renderingMode = 'canvas';
            log.info(`终端 ${id} Canvas渲染器已启用（配置选择）`);
          } catch (canvasErr) {
            log.warn(`终端 ${id} Canvas渲染器加载失败，使用DOM渲染`, canvasErr);
            renderingMode = 'dom';
          }
        }
      } catch (e) {
        log.warn(`终端 ${id} 渲染器初始化失败，使用DOM渲染:`, e);
        renderingMode = 'dom';
      }

      // 记录最终使用的渲染器类型
      const rendererName = renderingMode === 'webgl' ? 'WebGL' :
                          renderingMode === 'canvas' ? 'Canvas' : 'DOM';
      log.info(`终端 ${id} 使用${rendererName}渲染器`);

      // 存储渲染器信息到终端实例
      termOptions._actualRenderer = renderingMode;
      
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

      // 等待字体加载完成后再打开终端，确保渲染一致性
      this._waitForFontsAndOpen(terminal, container, termOptions, id).then(() => {
        // 字体加载完成，终端已打开
        log.debug(`终端 ${id} 字体加载完成并已打开`);
      }).catch(error => {
        log.warn(`终端 ${id} 字体加载失败，使用默认字体:`, error);
      });

      // 记录打开终端的时间
      const openTime = performance.now() - createStartTime
      if (openTime > 50) { // 如果打开时间超过50ms，记录性能问题
        log.info(`终端 ${id} 打开耗时较长: ${openTime.toFixed(2)}ms`)
      }

      // 设置终端事件（在插件加载完成后立即设置）
      this._setupTerminalEvents(terminal, id)

      // 启用bracketed paste模式 - 防止粘贴时的意外换行
      try {
        terminal.write('\x1b[?2004h'); // 启用bracketed paste
        // bracketed paste模式已启用
      } catch (e) {
        log.warn(`终端 ${id} 启用bracketed paste失败:`, e);
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
    try {
      // 兼容性检查：支持不同版本的xterm.js事件API
      const eventTarget = terminal._core || terminal;

      if (!eventTarget) {
        log.error(`终端 ${id} 事件目标对象不存在，无法设置事件`);
        return;
      }

      // 存储事件监听器引用，便于清理
      const eventListeners = [];

      // 处理数据事件 - 兼容多种API
      const setupDataEvent = () => {
        if (typeof eventTarget.onData === 'function') {
          const listener = eventTarget.onData(data => {
            this._emitEvent('data', { id, data })
          });
          eventListeners.push({ type: 'data', listener });
        } else if (typeof terminal.onData === 'function') {
          const listener = terminal.onData(data => {
            this._emitEvent('data', { id, data })
          });
          eventListeners.push({ type: 'data', listener });
        }
      };

      // 处理标题变更事件 - 兼容多种API
      const setupTitleEvent = () => {
        if (typeof eventTarget.onTitleChange === 'function') {
          const listener = eventTarget.onTitleChange(title => {
            this._emitEvent('title', { id, title })
          });
          eventListeners.push({ type: 'title', listener });
        } else if (typeof terminal.onTitleChange === 'function') {
          const listener = terminal.onTitleChange(title => {
            this._emitEvent('title', { id, title })
          });
          eventListeners.push({ type: 'title', listener });
        }
      };

      // 处理选择事件 - 增强兼容性
      const setupSelectionEvent = () => {
        const selectionHandler = () => {
          try {
            const selection = terminal.getSelection();

            // 获取当前的终端设置
            const terminalOptions = settingsService.getTerminalOptions();

            if (selection && terminalOptions.copyOnSelect) {
              clipboard.copyText(selection, { silent: true });
            }

            this._emitEvent('selection', { id, selection });
          } catch (error) {
            log.warn(`终端 ${id} 选择事件处理失败:`, error);
          }
        };

        if (typeof eventTarget.onSelectionChange === 'function') {
          const listener = eventTarget.onSelectionChange(selectionHandler);
          eventListeners.push({ type: 'selection', listener });
        } else if (typeof terminal.onSelectionChange === 'function') {
          const listener = terminal.onSelectionChange(selectionHandler);
          eventListeners.push({ type: 'selection', listener });
        }
      };

      // 处理光标移动事件 - 增强错误处理
      const setupCursorEvent = () => {
        const cursorHandler = () => {
          try {
            const cursorPosition = {
              x: terminal.buffer?.active?.cursorX || 0,
              y: terminal.buffer?.active?.cursorY || 0
            };
            this._emitEvent('cursor', { id, position: cursorPosition });
          } catch (error) {
            log.warn(`终端 ${id} 光标事件处理失败:`, error);
          }
        };

        if (typeof eventTarget.onCursorMove === 'function') {
          const listener = eventTarget.onCursorMove(cursorHandler);
          eventListeners.push({ type: 'cursor', listener });
        } else if (typeof terminal.onCursorMove === 'function') {
          const listener = terminal.onCursorMove(cursorHandler);
          eventListeners.push({ type: 'cursor', listener });
        }
      };

      // 处理按键事件 - 增强WebGL/Canvas兼容性
      const setupKeyEvent = () => {
        const keyHandler = ({ key, domEvent }) => {
          try {
            // 在WebGL/Canvas渲染器下，确保事件正确传播
            this._emitEvent('key', { id, key, domEvent });
          } catch (error) {
            log.warn(`终端 ${id} 按键事件处理失败:`, error);
          }
        };

        if (typeof eventTarget.onKey === 'function') {
          const listener = eventTarget.onKey(keyHandler);
          eventListeners.push({ type: 'key', listener });
        } else if (typeof terminal.onKey === 'function') {
          const listener = terminal.onKey(keyHandler);
          eventListeners.push({ type: 'key', listener });
        }
      };

      // 处理滚动事件 - 兼容不同渲染器
      const setupScrollEvent = () => {
        const scrollHandler = (scrollPosition) => {
          try {
            this._emitEvent('scroll', { id, scrollPosition });
          } catch (error) {
            log.warn(`终端 ${id} 滚动事件处理失败:`, error);
          }
        };

        if (typeof eventTarget.onScroll === 'function') {
          const listener = eventTarget.onScroll(scrollHandler);
          eventListeners.push({ type: 'scroll', listener });
        } else if (typeof terminal.onScroll === 'function') {
          const listener = terminal.onScroll(scrollHandler);
          eventListeners.push({ type: 'scroll', listener });
        }
      };

      // 处理焦点事件 - 增强稳定性
      const setupFocusEvents = () => {
        const focusHandler = () => {
          try {
            this.activeTerminalId.value = id;
            this._emitEvent('focus', { id });
          } catch (error) {
            log.warn(`终端 ${id} 焦点事件处理失败:`, error);
          }
        };

        const blurHandler = () => {
          try {
            this._emitEvent('blur', { id });
          } catch (error) {
            log.warn(`终端 ${id} 失焦事件处理失败:`, error);
          }
        };

        if (typeof eventTarget.onFocus === 'function') {
          const listener = eventTarget.onFocus(focusHandler);
          eventListeners.push({ type: 'focus', listener });
        } else if (typeof terminal.onFocus === 'function') {
          const listener = terminal.onFocus(focusHandler);
          eventListeners.push({ type: 'focus', listener });
        }

        if (typeof eventTarget.onBlur === 'function') {
          const listener = eventTarget.onBlur(blurHandler);
          eventListeners.push({ type: 'blur', listener });
        } else if (typeof terminal.onBlur === 'function') {
          const listener = terminal.onBlur(blurHandler);
          eventListeners.push({ type: 'blur', listener });
        }
      };

      // 执行所有事件设置
      setupDataEvent();
      setupTitleEvent();
      setupSelectionEvent();
      setupCursorEvent();
      setupKeyEvent();
      setupScrollEvent();
      setupFocusEvents();

      // 存储事件监听器引用到终端实例，便于清理
      if (!terminal._eventListeners) {
        terminal._eventListeners = [];
      }
      terminal._eventListeners.push(...eventListeners);

      log.debug(`终端 ${id} 事件设置完成，共注册 ${eventListeners.length} 个监听器`);

    } catch (error) {
      log.error(`设置终端 ${id} 事件时出错`, error);
    }

    // 处理右键点击事件 - 增强WebGL/Canvas渲染器兼容性
    const setupContextMenuEvent = () => {
      // 尝试多种方式获取终端元素
      let element = terminal.element;

      // 如果直接获取失败，尝试其他方式
      if (!element && terminal._core && terminal._core._screenElement) {
        element = terminal._core._screenElement;
      }

      // 如果还是没有，尝试查找DOM中的终端元素
      if (!element) {
        // 延迟查找，等待DOM渲染完成
        setTimeout(() => {
          const terminalContainer = document.querySelector(`[data-terminal-id="${id}"]`);
          if (terminalContainer) {
            const xtermElement = terminalContainer.querySelector('.xterm');
            if (xtermElement) {
              setupContextMenuOnElement(xtermElement);
            }
          }
        }, 100);
        return;
      }

      setupContextMenuOnElement(element);
    };

    const setupContextMenuOnElement = (element) => {
      if (!element) return;

      const contextMenuHandler = (event) => {
        try {
          // 获取当前的终端设置
          const terminalOptions = settingsService.getTerminalOptions();

          if (terminalOptions.rightClickSelectsWord) {
            event.preventDefault();
            event.stopPropagation();

            // 获取粘贴板内容并写入终端
            clipboard.readText().then(text => {
              if (text && terminal && typeof terminal.paste === 'function') {
                terminal.paste(text);
              }
            }).catch(error => {
              log.warn(`终端 ${id} 从粘贴板获取文本失败:`, error);
            });
          }
        } catch (error) {
          log.warn(`终端 ${id} 右键菜单事件处理失败:`, error);
        }
      };

      element.addEventListener('contextmenu', contextMenuHandler);

      // 存储事件监听器引用
      if (!terminal._eventListeners) {
        terminal._eventListeners = [];
      }
      terminal._eventListeners.push({
        type: 'contextmenu',
        element,
        handler: contextMenuHandler
      });
    };

    setupContextMenuEvent();
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

    log.info(`销毁终端实例: ${id}`)

    try {
      // 清理性能监视器
      if (term.performanceMonitor) {
        clearInterval(term.performanceMonitor)
        term.performanceMonitor = null
      }

      // 清理事件监听器 - 防止内存泄漏
      if (term.terminal && term.terminal._eventListeners) {
        const listenerCount = term.terminal._eventListeners.length;

        term.terminal._eventListeners.forEach(({ type, element, handler, listener }) => {
          try {
            if (element && handler) {
              // DOM事件监听器
              element.removeEventListener(type, handler);
            } else if (listener && typeof listener.dispose === 'function') {
              // xterm.js事件监听器
              listener.dispose();
            }
          } catch (error) {
            log.debug(`清理终端 ${id} 事件监听器 ${type} 失败:`, error);
          }
        });

        term.terminal._eventListeners = [];
        if (listenerCount > 0) {
          log.debug(`已清理 ${listenerCount} 个事件监听器`);
        }
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
          log.info(`检测到终端对象，执行通用销毁流程`);

          // 创建安全的内部销毁函数
          const safeDestroyTerminalAndAddons = () => {
            // 0. 首先停止终端的所有异步操作
            try {
              // 停止终端的焦点处理
              if (term.terminal.element) {
                term.terminal.element.blur();
              }
              // 停止终端的渲染循环
              if (term.terminal._core && term.terminal._core._renderService) {
                term.terminal._core._renderService._isPaused = true;
              }
            } catch (stopError) {
              log.debug(`停止终端异步操作时出错: ${stopError.message}`);
            }

            // 1. 然后清理 addons 对象中的所有引用
            if (term.addons) {
              const addonCount = Object.keys(term.addons).length;

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
                    // 特殊处理WebGL插件，确保停止所有渲染循环
                    if (name === 'webgl' && addon._core) {
                      try {
                        // 停止光标闪烁动画
                        if (addon._core._cursorBlinkStateManager) {
                          addon._core._cursorBlinkStateManager.pause();
                        }
                        // 停止渲染循环
                        if (addon._core._renderService) {
                          addon._core._renderService._isPaused = true;
                        }
                        // 清理WebGL上下文
                        if (addon._core._gl) {
                          const gl = addon._core._gl;
                          gl.getExtension('WEBGL_lose_context')?.loseContext();
                        }
                      } catch (webglError) {
                        log.debug(`WebGL插件特殊清理失败: ${webglError.message}`);
                      }
                    }

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
                  }
                } catch (e) {
                  log.debug(`插件 ${name} 销毁时出错: ${e.message}`);
                }
              }

              if (addonCount > 0) {
                log.debug(`已销毁 ${addonCount} 个插件`);
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
                    for (const eventName in term.terminal._core._events) {
                      term.terminal._core._events[eventName] = null;
                    }
                  }
                } catch (eventsError) {
                  log.debug(`清理事件监听器失败: ${eventsError.message}`);
                }
              }
            } catch (coreManagerError) {
              log.debug(`清理核心插件管理器失败: ${coreManagerError.message}`);
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
                      log.debug(`忽略插件未加载错误`);
                    } else {
                      log.debug(`忽略终端销毁错误: ${e.message}`);
                    }
                  }
                };
                term.terminal.dispose();
                log.info(`调用终端dispose方法`);
              } else {
                log.debug(`终端实例缺少dispose方法`);
              }
            } catch (disposeError) {
              log.debug(`终端实例销毁失败: ${disposeError.message}`);
            }
          };
          
          // 执行安全销毁 - 使用微任务确保异步操作完成
          setTimeout(() => {
            safeDestroyTerminalAndAddons();
          }, 0);
          
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
          log.debug(`终端销毁过程中发生错误: ${termError.message}`);
        }
      }

      // 移除活动终端ID
      if (this.activeTerminalId.value === id) {
        this.activeTerminalId.value = null
      }

      log.info(`终端实例已尝试销毁: ${id}`)
    } catch (error) {
      log.error(`销毁终端 ${id} 失败`, error)
    }
  }
  
  /**
   * 等待字体加载完成并打开终端
   * @param {Terminal} terminal - 终端实例
   * @param {HTMLElement} container - 容器元素
   * @param {Object} termOptions - 终端选项
   * @param {string} id - 终端ID
   * @private
   */
  async _waitForFontsAndOpen(terminal, container, termOptions, id) {
    try {
      // 检查字体是否已加载
      const fontFamily = termOptions.fontFamily || "'JetBrains Mono'";
      const fontSize = termOptions.fontSize || 16;

      // 等待字体加载
      await this._waitForFontLoad(fontFamily, fontSize);

      // 字体加载完成，打开终端
      terminal.open(container);

      // 根据渲染器类型应用特定的字体优化
      this._applyRendererSpecificFontOptimizations(terminal, termOptions, id);

    } catch (error) {
      log.warn(`终端 ${id} 字体加载超时，直接打开终端:`, error);
      // 即使字体加载失败，也要打开终端
      terminal.open(container);
    }
  }

  /**
   * 等待字体加载
   * @param {string} fontFamily - 字体族
   * @param {number} fontSize - 字体大小
   * @private
   */
  async _waitForFontLoad(fontFamily, fontSize) {
    return new Promise((resolve, reject) => {
      // 设置超时时间，避免无限等待
      const timeout = setTimeout(() => {
        reject(new Error('字体加载超时'));
      }, 3000);

      // 如果浏览器支持FontFace API
      if (document.fonts && document.fonts.ready) {
        // 尝试检查特定字体是否可用
        try {
          const testFont = new FontFace('test', `local('${fontFamily.replace(/'/g, '')}')`);
          testFont.load().then(() => {
            clearTimeout(timeout);
            resolve();
          }).catch(() => {
            // 字体检查失败，使用通用字体加载检测
            document.fonts.ready.then(() => {
              clearTimeout(timeout);
              resolve();
            }).catch(() => {
              clearTimeout(timeout);
              reject(new Error('字体加载失败'));
            });
          });
        } catch (e) {
          // FontFace构造失败，使用通用检测
          document.fonts.ready.then(() => {
            clearTimeout(timeout);
            resolve();
          }).catch(() => {
            clearTimeout(timeout);
            reject(new Error('字体加载失败'));
          });
        }
      } else {
        // 降级方案：使用简单的延迟，考虑字体大小影响加载时间
        const loadTime = Math.min(500 + fontSize * 10, 2000);
        setTimeout(() => {
          clearTimeout(timeout);
          resolve();
        }, loadTime);
      }
    });
  }

  /**
   * 应用渲染器特定的字体优化
   * @param {Terminal} terminal - 终端实例
   * @param {Object} termOptions - 终端选项
   * @param {string} id - 终端ID
   * @private
   */
  _applyRendererSpecificFontOptimizations(terminal, termOptions, id) {
    try {
      const actualRenderer = termOptions._actualRenderer || 'dom';

      if (actualRenderer === 'webgl') {
        // WebGL渲染器字体优化
        this._optimizeWebGLFontRendering(terminal, id);
      } else if (actualRenderer === 'canvas') {
        // Canvas渲染器字体优化
        this._optimizeCanvasFontRendering(terminal, id);
      }

      // 通用字体优化
      this._applyCommonFontOptimizations(terminal, id);

    } catch (error) {
      log.warn(`终端 ${id} 应用字体优化失败:`, error);
    }
  }

  /**
   * WebGL渲染器字体优化
   * @param {Terminal} terminal - 终端实例
   * @param {string} id - 终端ID
   * @private
   */
  _optimizeWebGLFontRendering(terminal, id) {
    try {
      // WebGL渲染器特定优化
      if (terminal.setOption) {
        // 确保字体渲染清晰
        terminal.setOption('fontWeight', 'normal');
        terminal.setOption('fontWeightBold', 'bold');

        // 优化字符间距和行高
        terminal.setOption('letterSpacing', 0);
        terminal.setOption('lineHeight', 1.0);

        // 禁用可能影响WebGL性能的选项
        terminal.setOption('smoothScrollDuration', 0);
      }

      log.debug(`终端 ${id} WebGL字体优化已应用`);
    } catch (error) {
      log.warn(`终端 ${id} WebGL字体优化失败:`, error);
    }
  }

  /**
   * Canvas渲染器字体优化
   * @param {Terminal} terminal - 终端实例
   * @param {string} id - 终端ID
   * @private
   */
  _optimizeCanvasFontRendering(terminal, id) {
    try {
      // Canvas渲染器特定优化
      if (terminal.setOption) {
        // 保持字体渲染一致性
        terminal.setOption('letterSpacing', 0);
        terminal.setOption('lineHeight', 1.0);

        // Canvas可以使用适度的平滑滚动
        terminal.setOption('smoothScrollDuration', 120);
      }

      log.debug(`终端 ${id} Canvas字体优化已应用`);
    } catch (error) {
      log.warn(`终端 ${id} Canvas字体优化失败:`, error);
    }
  }

  /**
   * 通用字体优化
   * @param {Terminal} terminal - 终端实例
   * @param {string} id - 终端ID
   * @private
   */
  _applyCommonFontOptimizations(terminal, id) {
    try {
      // 确保字体渲染的一致性
      if (terminal.element) {
        const terminalElement = terminal.element;

        // 应用CSS优化
        terminalElement.style.fontSmooth = 'always';
        terminalElement.style.webkitFontSmoothing = 'antialiased';
        terminalElement.style.mozOsxFontSmoothing = 'grayscale';

        // 确保字体渲染清晰
        terminalElement.style.textRendering = 'optimizeLegibility';
      }

      log.debug(`终端 ${id} 通用字体优化已应用`);
    } catch (error) {
      log.warn(`终端 ${id} 通用字体优化失败:`, error);
    }
  }

  /**
   * 设置WebGL性能监控
   * @param {Object} webglAddon - WebGL插件实例
   * @param {Terminal} terminal - 终端实例
   * @param {string} id - 终端ID
   * @param {Object} addons - 插件集合
   * @private
   */
  _setupWebGLPerformanceMonitoring(webglAddon, terminal, id, addons) {
    try {
      let renderCount = 0;
      let lastLogTime = Date.now();
      let performanceIssues = 0;
      let lastPerformanceCheck = Date.now();

      // 性能阈值配置
      const PERFORMANCE_THRESHOLDS = {
        MIN_FPS: 30,           // 最低FPS
        MAX_FRAME_TIME: 33,    // 最大帧时间(ms)
        DEGRADATION_LIMIT: 5,  // 性能问题次数限制
        CHECK_INTERVAL: 5000   // 检查间隔(ms)
      };

      const renderHandler = () => {
        const now = Date.now();
        const frameTime = now - lastLogTime;
        renderCount++;

        // 检测性能问题
        if (frameTime > PERFORMANCE_THRESHOLDS.MAX_FRAME_TIME) {
          performanceIssues++;
        }

        // 定期性能检查和报告
        if (now - lastPerformanceCheck > PERFORMANCE_THRESHOLDS.CHECK_INTERVAL) {
          const fps = renderCount / ((now - lastPerformanceCheck) / 1000);
          const avgFrameTime = (now - lastPerformanceCheck) / renderCount;

          // 记录性能统计
          log.debug(`终端 ${id} WebGL性能: ${fps.toFixed(1)} FPS, 平均帧时间: ${avgFrameTime.toFixed(2)}ms`);

          // 检查是否需要降级
          if (fps < PERFORMANCE_THRESHOLDS.MIN_FPS ||
              performanceIssues > PERFORMANCE_THRESHOLDS.DEGRADATION_LIMIT) {
            log.warn(`终端 ${id} WebGL性能不佳，考虑降级到Canvas渲染`);
            this._considerRendererDowngrade(terminal, id, addons, 'webgl', 'canvas');
          }

          // 重置计数器
          renderCount = 0;
          performanceIssues = 0;
          lastPerformanceCheck = now;
        }

        lastLogTime = now;
      };

      webglAddon.onRender(renderHandler);

      log.debug(`终端 ${id} WebGL性能监控已启用`);
    } catch (error) {
      log.warn(`终端 ${id} WebGL性能监控设置失败:`, error);
    }
  }

  /**
   * 考虑渲染器降级
   * @param {Terminal} terminal - 终端实例
   * @param {string} id - 终端ID
   * @param {Object} addons - 插件集合
   * @param {string} fromRenderer - 当前渲染器
   * @param {string} toRenderer - 目标渲染器
   * @private
   */
  _considerRendererDowngrade(terminal, id, addons, fromRenderer, toRenderer) {
    try {
      // 防止频繁降级
      const terminalInstance = this.getTerminal(id);
      if (!terminalInstance) return;

      const now = Date.now();
      if (terminalInstance._lastDowngradeAttempt &&
          now - terminalInstance._lastDowngradeAttempt < 30000) {
        return; // 30秒内不重复降级
      }

      terminalInstance._lastDowngradeAttempt = now;

      log.info(`终端 ${id} 开始渲染器降级: ${fromRenderer} -> ${toRenderer}`);

      // 执行降级
      if (fromRenderer === 'webgl' && toRenderer === 'canvas') {
        this._downgradeWebGLToCanvas(terminal, id, addons);
      }

      // 发送用户通知
      this._notifyRendererChange(id, fromRenderer, toRenderer, 'performance');

    } catch (error) {
      log.error(`终端 ${id} 渲染器降级失败:`, error);
    }
  }

  /**
   * 从WebGL降级到Canvas
   * @param {Terminal} terminal - 终端实例
   * @param {string} id - 终端ID
   * @param {Object} addons - 插件集合
   * @private
   */
  _downgradeWebGLToCanvas(terminal, id, addons) {
    try {
      // 移除WebGL插件
      if (addons.webgl && typeof addons.webgl.dispose === 'function') {
        addons.webgl.dispose();
        addons.webgl = null;
      }

      // 添加Canvas插件
      const canvasAddon = new CanvasAddon();
      terminal.loadAddon(canvasAddon);
      addons.canvas = canvasAddon;

      // 更新渲染器信息
      if (terminal.options) {
        terminal.options._actualRenderer = 'canvas';
      }

      log.info(`终端 ${id} 已成功降级到Canvas渲染器`);

    } catch (error) {
      log.error(`终端 ${id} WebGL到Canvas降级失败:`, error);
    }
  }

  /**
   * 通知渲染器变更
   * @param {string} id - 终端ID
   * @param {string} fromRenderer - 原渲染器
   * @param {string} toRenderer - 新渲染器
   * @param {string} reason - 变更原因
   * @private
   */
  _notifyRendererChange(id, fromRenderer, toRenderer, reason) {
    try {
      // 发送自定义事件
      window.dispatchEvent(new CustomEvent('terminal-renderer-change', {
        detail: {
          terminalId: id,
          fromRenderer,
          toRenderer,
          reason,
          timestamp: Date.now()
        }
      }));

      // 可选：显示用户通知
      if (reason === 'performance') {
        ElMessage.info(`终端渲染器已优化：${fromRenderer.toUpperCase()} → ${toRenderer.toUpperCase()}`);
      }

    } catch (error) {
      log.warn(`终端 ${id} 渲染器变更通知失败:`, error);
    }
  }



  /**
   * 检查WebGL支持
   * @private
   */
  _checkWebGLSupport() {
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
      return !!gl
    } catch (e) {
      return false
    }
  }

  /**
   * 检查Canvas支持
   * @private
   */
  _checkCanvasSupport() {
    try {
      const canvas = document.createElement('canvas')
      return !!(canvas.getContext && canvas.getContext('2d'))
    } catch (e) {
      return false
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





  /**
   * 安全地加载插件
   * @param {Terminal} terminal - 终端实例
   * @param {Object} addon - 插件实例
   * @param {string} addonName - 插件名称
   * @param {string} terminalId - 终端ID
   * @private
   */
  _loadAddonSafely(terminal, addon, addonName, terminalId) {
    try {
      // 检查插件兼容性
      const compatibility = this._checkAddonCompatibility(addon, addonName, terminal);

      if (!compatibility.compatible) {
        log.warn(`终端 ${terminalId} 插件 ${addonName} 兼容性检查失败:`, compatibility.issues);
        return false;
      }

      // 加载插件
      terminal.loadAddon(addon);

      // 验证插件是否正确加载
      const verification = this._verifyAddonLoaded(terminal, addon, addonName);
      if (!verification.success) {
        log.warn(`终端 ${terminalId} 插件 ${addonName} 加载验证失败:`, verification.error);
        return false;
      }

      log.debug(`终端 ${terminalId} 插件 ${addonName} 加载成功`);
      return true;

    } catch (error) {
      log.error(`终端 ${terminalId} 安全加载插件 ${addonName} 失败:`, error);
      return false;
    }
  }

  /**
   * 检查插件兼容性
   * @param {Object} addon - 插件实例
   * @param {string} addonName - 插件名称
   * @param {Terminal} terminal - 终端实例
   * @private
   */
  _checkAddonCompatibility(addon, addonName, terminal) {
    const result = {
      compatible: true,
      issues: []
    };

    try {
      // 检查插件基本结构
      if (!addon || typeof addon !== 'object') {
        result.compatible = false;
        result.issues.push('插件对象无效');
        return result;
      }

      // 检查必需的方法
      const requiredMethods = ['activate'];
      for (const method of requiredMethods) {
        if (typeof addon[method] !== 'function') {
          result.issues.push(`缺少必需方法: ${method}`);
        }
      }

      // 特定插件的兼容性检查
      switch (addonName) {
        case 'fit':
          if (typeof addon.fit !== 'function') {
            result.issues.push('FitAddon缺少fit方法');
          }
          break;

        case 'search':
          if (typeof addon.findNext !== 'function' || typeof addon.findPrevious !== 'function') {
            result.issues.push('SearchAddon缺少搜索方法');
          }
          break;

        case 'webLinks':
          // WebLinksAddon通常不需要特殊检查
          break;

        case 'webgl':
        case 'canvas':
          // 渲染器插件的特殊检查
          if (!this._checkRendererAddonCompatibility(addon, addonName, terminal)) {
            result.issues.push(`${addonName}渲染器不兼容当前环境`);
          }
          break;
      }

      if (result.issues.length > 0) {
        result.compatible = false;
      }

    } catch (error) {
      result.compatible = false;
      result.issues.push(`兼容性检查异常: ${error.message}`);
    }

    return result;
  }

  /**
   * 检查渲染器插件兼容性
   * @param {Object} addon - 渲染器插件
   * @param {string} addonName - 插件名称
   * @param {Terminal} terminal - 终端实例
   * @private
   */
  _checkRendererAddonCompatibility(addon, addonName, terminal) {
    try {
      // 记录插件和终端信息用于调试
      log.debug(`检查渲染器插件兼容性: ${addonName}`, {
        hasAddon: !!addon,
        hasTerminal: !!terminal
      });

      if (addonName === 'webgl') {
        // 检查WebGL支持
        return this._checkWebGLSupport();
      } else if (addonName === 'canvas') {
        // 检查Canvas支持
        return this._checkCanvasSupport();
      }
      return true;
    } catch (error) {
      log.warn(`渲染器插件 ${addonName} 兼容性检查失败:`, error);
      return false;
    }
  }

  /**
   * 验证插件是否正确加载
   * @param {Terminal} terminal - 终端实例
   * @param {Object} addon - 插件实例
   * @param {string} addonName - 插件名称
   * @private
   */
  _verifyAddonLoaded(terminal, addon, addonName) {
    try {
      // 检查插件是否在终端的插件管理器中注册
      if (terminal._core && terminal._core._addonManager) {
        const registeredAddons = terminal._core._addonManager._addons || [];
        const isRegistered = registeredAddons.includes(addon);

        if (!isRegistered) {
          return {
            success: false,
            error: '插件未在插件管理器中注册'
          };
        }
      }

      // 特定插件的验证
      switch (addonName) {
        case 'fit':
          // 验证fit插件是否可以调用
          if (typeof addon.fit === 'function') {
            // 尝试调用fit方法（在安全的上下文中）
            try {
              addon.fit();
            } catch (e) {
              // fit调用失败是正常的，因为终端可能还没有完全初始化
            }
          }
          break;

        case 'search':
          // 验证搜索插件的方法是否可用
          if (typeof addon.findNext !== 'function') {
            return {
              success: false,
              error: 'SearchAddon的findNext方法不可用'
            };
          }
          break;
      }

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }




}

export default new TerminalService()