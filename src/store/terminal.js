import { defineStore } from 'pinia'
import { ref, reactive, toRefs } from 'vue'
import { ElMessage } from 'element-plus'
import sshService from '../services/ssh'
import { useUserStore } from './user'
import { useConnectionStore } from './connection'
import { useLocalConnectionsStore } from './localConnections'
import { FitAddon } from '@xterm/addon-fit'
import { useSettingsStore } from './settings'

export const useTerminalStore = defineStore('terminal', () => {
  // 使用reactive管理状态
  const state = reactive({
    // 存储所有终端实例，键为终端ID（通常是连接ID）
    terminals: {},
    
    // 存储会话信息
    sessions: {},
    
    // 终端连接状态
    connectionStatus: {},
    
    // 存储终端的FitAddon实例
    fitAddons: {}
  })
  
  /**
   * 初始化终端
   * @param {string} connectionId - 连接ID
   * @param {HTMLElement} container - 终端容器元素
   * @returns {Promise<boolean>} - 是否成功初始化
   */
  const initTerminal = async (connectionId, container) => {
    try {
      if (!connectionId) {
        ElMessage.error('未提供连接ID')
        return false
      }
      
      if (!container) {
        ElMessage.error('未提供终端容器元素')
        return false
      }
      
      // 如果已经存在此连接的终端，直接重新附加
      if (state.terminals[connectionId] && state.sessions[connectionId]) {
        console.log(`终端 ${connectionId} 已存在，直接重新附加`)
        // 将终端实例重新附加到新的容器
        const success = reattachTerminal(connectionId, container)
        return success
      }
      
      // 设置连接状态为connecting
      state.connectionStatus[connectionId] = 'connecting'
      
      // 获取连接信息
      const userStore = useUserStore()
      const connectionStore = useConnectionStore()
      const localConnectionsStore = useLocalConnectionsStore()
      
      // 根据登录状态决定从哪个store获取连接
      let connection = null
      if (userStore.isLoggedIn) {
        connection = connectionStore.getConnectionById(connectionId)
      } else {
        connection = localConnectionsStore.getConnectionById(connectionId)
      }
      
      if (!connection) {
        ElMessage.error('无法找到连接信息')
        state.connectionStatus[connectionId] = 'error'
        return false
      }
      
      // 创建SSH会话
      const sessionId = await sshService.createSession(connection)
      
      // 获取终端设置
      let terminalOptions = {
        fontSize: 16,
        fontFamily: 'monospace',
        theme: {
          background: '#121212',
          foreground: '#f8f8f8',
          black: '#000000',
          red: '#ff5555',
          green: '#50fa7b',
          yellow: '#f1fa8c',
          blue: '#bd93f9',
          magenta: '#ff79c6',
          cyan: '#8be9fd',
          white: '#f8f8f2',
          brightBlack: '#6272a4',
          brightRed: '#ff6e6e',
          brightGreen: '#69ff94',
          brightYellow: '#ffffa5',
          brightBlue: '#d6acff',
          brightMagenta: '#ff92df',
          brightCyan: '#a4ffff',
          brightWhite: '#ffffff'
        }
      }
      
      // 获取设置中的终端选项
      try {
        const settingsStore = useSettingsStore()
        const settings = settingsStore.getTerminalSettings()
        
        // 更新选项
        if (settings) {
          if (settings.fontSize) {
            terminalOptions.fontSize = settings.fontSize
          }
          
          if (settings.fontFamily) {
            terminalOptions.fontFamily = settings.fontFamily
          }
          
          if (settings.cursorStyle) {
            terminalOptions.cursorStyle = settings.cursorStyle
          }
          
          if (settings.cursorBlink !== undefined) {
            terminalOptions.cursorBlink = settings.cursorBlink
          }
          
          // 应用终端主题设置
          if (settings.theme) {
            // 从settingsService获取主题配置
            const settingsService = await import('../services/settings').then(m => m.default)
            const themeConfig = settingsService.getTerminalTheme(settings.theme)
            terminalOptions.theme = themeConfig
          }
          
          console.log('使用设置中的终端选项:', terminalOptions)
        }
      } catch (error) {
        console.error('获取终端设置失败，使用默认选项:', error)
      }
      
      // 创建终端
      const terminal = sshService.createTerminal(
        sessionId,
        container,
        terminalOptions
      )
      
      // 为终端元素添加标识
      if (terminal && terminal.element) {
        terminal.element.setAttribute('data-terminal-id', connectionId)
      }
      
      // 获取SSHService中可能创建的FitAddon实例
      // 因为没有直接访问FitAddon的方法，我们临时创建一个新的用于备份
      const fitAddon = new FitAddon()
      
      // 存储终端和会话信息
      state.terminals[connectionId] = terminal
      state.sessions[connectionId] = sessionId
      state.connectionStatus[connectionId] = 'connected'
      state.fitAddons[connectionId] = fitAddon
      
      // 修复xterm-helpers元素显示问题
      fixXtermHelpers()
      
      // 在SSH会话对象中保存终端ID，以便SFTP功能使用
      try {
        const session = sshService.sessions.get(sessionId)
        if (session) {
          // 添加终端ID到会话中，以便SFTP功能使用
          session.terminalId = connectionId
          console.log(`设置SSH会话 ${sessionId} 的终端ID: ${connectionId}`)
        }
      } catch (error) {
        console.warn(`设置终端ID映射失败:`, error)
      }
      
      return true
    } catch (error) {
      console.error('初始化终端失败:', error)
      ElMessage.error(`初始化终端失败: ${error.message || '未知错误'}`)
      state.connectionStatus[connectionId] = 'error'
      return false
    }
  }
  
  /**
   * 修复xterm-helpers元素的显示问题
   */
  const fixXtermHelpers = () => {
    setTimeout(() => {
      const helpers = document.querySelector('.xterm-helpers')
      if (helpers) {
        // 确保helpers容器正确定位且不可见
        helpers.style.position = 'absolute'
        helpers.style.top = '0'
        helpers.style.left = '0'
        helpers.style.pointerEvents = 'none'
        
        // 处理textarea元素
        const textarea = helpers.querySelector('.xterm-helper-textarea')
        if (textarea) {
          textarea.style.opacity = '0'
          textarea.style.zIndex = '-5'
        }
        
        // 处理字符测量元素
        const charMeasure = helpers.querySelector('.xterm-char-measure-element')
        if (charMeasure) {
          charMeasure.style.visibility = 'hidden'
          charMeasure.style.position = 'absolute'
          charMeasure.style.top = '0'
          charMeasure.style.left = '-9999em'
        }
      }
    }, 100)
  }
  
  /**
   * 重新附加终端到新的容器元素
   * @param {string} connectionId - 连接ID
   * @param {HTMLElement} container - 新的终端容器元素
   */
  const reattachTerminal = (connectionId, container) => {
    try {
      const terminal = state.terminals[connectionId]
      if (!terminal) {
        return false
      }
      
      // 终端重新附加到新容器
      if (container) {
        // 清空容器
        while (container.firstChild) {
          container.removeChild(container.firstChild)
        }
        
        // 直接获取终端DOM元素
        const terminalElement = terminal.element || 
                               document.querySelector(`.xterm[data-terminal-id="${connectionId}"]`) ||
                               terminal._core._parent;
        
        if (terminalElement && terminalElement.parentElement) {
          terminalElement.parentElement.removeChild(terminalElement)
          
          // 为终端元素添加标识，方便后续查找
          if (terminalElement) {
            terminalElement.setAttribute('data-terminal-id', connectionId)
          }
        }
        
        // 将终端DOM元素附加到新容器
        if (terminalElement) {
          container.appendChild(terminalElement)
          
          // 确保元素尺寸正确
          terminalElement.style.width = '100%'
          terminalElement.style.height = '100%'
        } else {
          console.error('找不到终端DOM元素，将尝试使用替代方案')
          // 替代方案：如果无法移动DOM元素，则重新初始化终端
          terminal.clear()
          // 重新加载当前内容
          terminal.refresh(0, terminal.rows - 1)
        }
        
        // 确保终端大小适应容器
        setTimeout(() => {
          fitTerminal(connectionId)
        }, 50)
      }
      
      // 更新状态为已连接
      state.connectionStatus[connectionId] = 'connected'
      
      return true
    } catch (error) {
      console.error('重新附加终端失败:', error)
      return false
    }
  }
  
  /**
   * 调整终端大小以适应容器
   * @param {string} connectionId - 连接ID
   */
  const fitTerminal = (connectionId) => {
    // 检查终端是否存在
    if (!state.terminals[connectionId]) {
      console.warn(`终端不存在，无法调整大小: ${connectionId}`)
      return
    }
    
    const terminal = state.terminals[connectionId]
    
    // 检查终端是否有效
    if (!terminal || typeof terminal !== 'object') {
      console.warn(`终端对象无效: ${connectionId}`)
      return
    }
    
    try {
      console.log(`正在调整终端大小: ${connectionId}`)
      
      // 首先检查终端是否是一个xterm.js Terminal对象
      if (terminal.terminal) {
        // 新版终端服务返回的对象
        
        // 检查addons.fit
        if (terminal.addons && terminal.addons.fit) {
          console.log('使用终端对象的FitAddon调整大小')
          try {
            terminal.addons.fit.fit()
          } catch (e) {
            console.warn('使用addons.fit调整大小失败:', e)
          }
        } else {
          console.log('终端对象中没有找到FitAddon，尝试其他方式')
          
          // 尝试从备份中获取
          if (state.fitAddons[connectionId]) {
            try {
              console.log('使用备份的FitAddon')
              state.fitAddons[connectionId].fit()
            } catch (e) {
              console.warn('使用备份FitAddon失败:', e)
              
              // 创建新的FitAddon
              try {
                console.log('创建新的FitAddon')
                const FitAddon = new window.FitAddon.FitAddon()
                terminal.terminal.loadAddon(FitAddon)
                FitAddon.fit()
                
                // 更新终端对象的addon引用和备份
                if (!terminal.addons) terminal.addons = {}
                terminal.addons.fit = FitAddon
                state.fitAddons[connectionId] = FitAddon
              } catch (newAddonError) {
                console.error('创建新FitAddon失败:', newAddonError)
              }
            }
          } else {
            console.warn('没有备份的FitAddon，尝试创建新的')
            try {
              const FitAddon = new window.FitAddon.FitAddon()
              terminal.terminal.loadAddon(FitAddon)
              FitAddon.fit()
              
              // 更新终端对象的addon引用和备份
              if (!terminal.addons) terminal.addons = {}
              terminal.addons.fit = FitAddon
              state.fitAddons[connectionId] = FitAddon
            } catch (newAddonError) {
              console.error('创建新FitAddon失败:', newAddonError)
            }
          }
        }
        
        // 触发终端的resize事件
        if (terminal.terminal._core) {
          const event = {
            cols: terminal.terminal.cols, 
            rows: terminal.terminal.rows
          }
          console.log(`调整后的终端大小: ${event.cols}x${event.rows}`)
          
          // 检查并调用bufferService的resize方法
          if (terminal.terminal._core._bufferService) {
            terminal.terminal._core._bufferService.resize(event.cols, event.rows)
          }
          
          // 检查并调用renderService的resize方法
          if (terminal.terminal._core._renderService) {
            terminal.terminal._core._renderService.resize(event.cols, event.rows)
          }
          
          // 检查并调用renderer的clear方法
          if (terminal.terminal._core.renderer) {
            terminal.terminal._core.renderer.clear()
          }
        }
      } else {
        // 旧版终端对象
        
        // 尝试获取原始fit方法
        if (typeof terminal.fit === 'function') {
          console.log('使用终端内置fit方法')
          terminal.fit()
        } else {
          console.log('使用FitAddon调整大小')
          // 查找终端中可能存在的FitAddon实例
          let fitAddon = null;
          
          // 尝试从SSHService获取addon
          if (terminal._addonManager && terminal._addonManager._addons) {
            fitAddon = terminal._addonManager._addons.find(addon => addon.constructor.name === 'FitAddon')
            if (fitAddon) {
              console.log('从终端实例找到FitAddon')
            }
          }
          
          // 如果找不到，则尝试从我们的备份中获取
          if (!fitAddon && state.fitAddons[connectionId]) {
            fitAddon = state.fitAddons[connectionId]
            console.log('使用备份的FitAddon')
            // 重新加载addon
            try {
              terminal.loadAddon(fitAddon)
            } catch (e) {
              console.warn('重新加载FitAddon失败，可能已经加载:', e)
            }
          }
          
          // 如果仍找不到，则创建新的FitAddon
          if (!fitAddon) {
            console.log('创建新的FitAddon')
            fitAddon = new FitAddon()
            terminal.loadAddon(fitAddon)
            state.fitAddons[connectionId] = fitAddon
          }
          
          // 使用FitAddon调整大小
          fitAddon.fit()
        }
        
        // 触发终端的resize事件，确保SSH服务器能够感知到大小变化
        if (terminal._core) {
          const event = {
            cols: terminal.cols, 
            rows: terminal.rows
          }
          console.log(`调整后的终端大小: ${event.cols}x${event.rows}`)
          
          // 检查并调用bufferService的resize方法
          if (terminal._core._bufferService) {
            terminal._core._bufferService.resize(event.cols, event.rows)
          }
          
          // 检查并调用renderService的resize方法
          if (terminal._core._renderService) {
            terminal._core._renderService.resize(event.cols, event.rows)
          }
          
          // 检查并调用renderer的clear方法
          if (terminal._core.renderer) {
            terminal._core.renderer.clear()
          }
        }
      }
      
      console.log(`终端大小调整完成: ${connectionId}`)
    } catch (error) {
      console.error('调整终端大小失败:', error)
    }
  }
  
  /**
   * 发送命令到终端
   * @param {string} connectionId - 连接ID
   * @param {string} command - 要执行的命令
   */
  const sendCommand = (connectionId, command) => {
    const terminal = state.terminals[connectionId]
    if (terminal) {
      terminal.write(`${command}\r`)
    }
  }
  
  /**
   * 清除终端内容
   * @param {string} connectionId - 连接ID
   */
  const clearTerminal = (connectionId) => {
    const terminal = state.terminals[connectionId]
    if (terminal) {
      terminal.clear()
    }
  }
  
  /**
   * 断开终端连接
   * @param {string} connectionId - 连接ID
   * @returns {Promise<boolean>} - 是否成功断开
   */
  const disconnectTerminal = async (connectionId) => {
    try {
      console.log(`准备断开终端连接: ${connectionId}`)
      
      // 获取会话ID
      const sessionId = state.sessions[connectionId]
      if (!sessionId) {
        console.warn(`断开终端连接: 找不到会话ID，连接ID=${connectionId}`)
        return false
      }
      
      console.log(`关闭SSH会话: ${sessionId}`)
      
      // 关闭SSH会话
      try {
        await sshService.closeSession(sessionId)
        console.log(`SSH会话已关闭: ${sessionId}`)
      } catch (closeError) {
        console.error(`关闭SSH会话失败: ${sessionId}`, closeError)
        // 即使关闭会话失败，也继续清理资源
      }
      
      // 清理终端实例
      const terminal = state.terminals[connectionId]
      if (terminal) {
        try {
          console.log(`销毁终端实例: ${connectionId}`)
          
          // 检查是否是新版终端服务返回的对象
          if (terminal.terminal && typeof terminal.terminal === 'object') {
            try {
              console.log('检测到新版终端结构，使用安全销毁流程')
              
              // 1. 先安全地处理插件
              const safeDisposeAddons = async () => {
                if (!terminal.addons) return;
                
                try {
                  // 创建插件列表副本以避免在迭代过程中修改
                  const addonKeys = Object.keys(terminal.addons).filter(k => !!terminal.addons[k]);
                  
                  // 创建要处理的插件副本
                  const addonsToDispose = [];
                  for (const key of addonKeys) {
                    const addon = terminal.addons[key];
                    if (addon && typeof addon === 'object') {
                      addonsToDispose.push({ key, addon });
                      // 清空原引用，防止重复处理
                      terminal.addons[key] = null;
                    }
                  }
                  
                  // 逐个处理插件销毁
                  for (const { key, addon } of addonsToDispose) {
                    try {
                      // 严格检查addon是否有效且有dispose方法
                      if (typeof addon.dispose === 'function') {
                        try {
                          // 覆盖原始dispose方法，防止错误中断流程
                          const originalDispose = addon.dispose;
                          addon.dispose = function() {
                            try {
                              return originalDispose.apply(this, arguments);
                            } catch (e) {
                              console.warn(`安全忽略插件 ${key} 销毁错误: ${e.message}`);
                            }
                          };
                          addon.dispose();
                          console.log(`插件 ${key} 已安全销毁`);
                        } catch (addonError) {
                          console.warn(`安全销毁插件 ${key} 失败: ${addonError.message}`);
                        }
                      } else {
                        console.log(`插件 ${key} 不是有效的可销毁对象，跳过`);
                      }
                    } catch (keyError) {
                      console.warn(`处理插件 ${key} 时出错: ${keyError.message}`);
                    }
                  }
                } catch (addonsError) {
                  console.warn('处理终端插件集合时出错:', addonsError.message);
                }
              };
              
              // 执行插件安全销毁
              await safeDisposeAddons();
              
              // 2. 检查终端实例上的_addonManager属性
              if (terminal.terminal._core && 
                  terminal.terminal._core._addonManager) {
                try {
                  console.log('检测到终端核心的_addonManager，尝试安全清理');
                  
                  // 确保_addons是一个数组
                  if (Array.isArray(terminal.terminal._core._addonManager._addons)) {
                    const coreAddons = [...terminal.terminal._core._addonManager._addons];
                    
                    // 先将_addons置为空数组，防止在销毁过程中引用
                    terminal.terminal._core._addonManager._addons = [];
                    
                    // 防止registerAddon方法继续注册新插件
                    if (typeof terminal.terminal._core._addonManager.registerAddon === 'function') {
                      const originalRegister = terminal.terminal._core._addonManager.registerAddon;
                      terminal.terminal._core._addonManager.registerAddon = function(addon) {
                        console.log('忽略终端销毁过程中的插件注册');
                        return addon;
                      };
                    }
                    
                    // 然后逐个尝试销毁，但不抛出错误
                    for (const addon of coreAddons.filter(a => !!a)) {
                      try {
                        if (typeof addon.dispose === 'function') {
                          // 覆盖dispose方法防止错误中断
                          const originalDispose = addon.dispose;
                          addon.dispose = function() {
                            try {
                              return originalDispose.apply(this, arguments);
                            } catch (e) {
                              console.log(`安全忽略核心插件销毁错误: ${e.message}`);
                            }
                          };
                          addon.dispose();
                        }
                      } catch (e) {
                        console.log(`安全处理核心插件时出错: ${e.message}`);
                      }
                    }
                  } else {
                    console.log('核心插件管理器没有有效的_addons数组');
                  }
                } catch (managerError) {
                  console.warn('安全处理_addonManager时出错:', managerError.message);
                }
              }
              
              // 3. 尝试安全销毁终端实例
              if (typeof terminal.terminal.dispose === 'function') {
                try {
                  // 安全地覆盖dispose方法以避免错误
                  const originalDispose = terminal.terminal.dispose;
                  terminal.terminal.dispose = function() {
                    try {
                      return originalDispose.apply(this, arguments);
                    } catch (e) {
                      console.warn('安全忽略终端dispose错误:', e.message);
                    }
                  };
                  
                  // 调用被包装的dispose方法
                  terminal.terminal.dispose();
                } catch (disposeError) {
                  console.warn('即使使用安全方式也无法销毁终端:', disposeError.message);
                }
              } else {
                console.warn('终端对象缺少dispose方法');
              }
              
              // 帮助垃圾回收
              setTimeout(() => {
                terminal.terminal = null;
                terminal.addons = null;
              }, 0);
              
            } catch (newTerminalError) {
              console.warn('处理新版终端结构时出错:', newTerminalError.message);
            }
          } else if (typeof terminal.dispose === 'function') {
            try {
              console.log('检测到旧版终端结构，使用兼容销毁流程');
              
              // 尝试先安全销毁可能存在的插件
              if (terminal._core && 
                  terminal._core._addonManager && 
                  terminal._core._addonManager._addons) {
                try {
                  // 创建副本并清空原数组
                  const oldAddons = Array.isArray(terminal._core._addonManager._addons) ? 
                                   [...terminal._core._addonManager._addons] : [];
                  terminal._core._addonManager._addons = [];
                  
                  // 禁用registerAddon方法
                  if (typeof terminal._core._addonManager.registerAddon === 'function') {
                    const originalRegister = terminal._core._addonManager.registerAddon;
                    terminal._core._addonManager.registerAddon = function() {
                      console.log('忽略销毁过程中的插件注册');
                      return arguments[0];
                    };
                  }
                  
                  // 逐个安全处理插件
                  for (const addon of oldAddons.filter(a => !!a)) {
                    try {
                      if (typeof addon.dispose === 'function') {
                        // 覆盖原方法防止错误
                        const originalDispose = addon.dispose;
                        addon.dispose = function() {
                          try {
                            return originalDispose.apply(this, arguments);
                          } catch (e) {
                            // 忽略错误
                            console.log(`安全忽略旧版插件错误: ${e.message}`);
                          }
                        };
                        addon.dispose();
                      }
                    } catch (e) {
                      // 忽略错误
                      console.log(`安全处理旧版插件时出错: ${e.message}`);
                    }
                  }
                } catch (e) {
                  // 忽略错误
                  console.warn('安全处理旧版插件管理器时出错:', e.message);
                }
              }
              
              // 包装旧版的dispose方法
              const originalDispose = terminal.dispose;
              terminal.dispose = function() {
                try {
                  return originalDispose.apply(this, arguments);
                } catch (e) {
                  console.warn('安全忽略旧版终端dispose错误:', e.message);
                }
              };
              
              // 调用被包装的dispose方法
              terminal.dispose();
            } catch (oldTerminalError) {
              console.warn('处理旧版终端结构时出错:', oldTerminalError.message);
            }
          } else {
            console.warn(`终端对象结构无法识别或缺少dispose方法:`, typeof terminal);
          }
          
          console.log(`终端实例已尝试销毁: ${connectionId}`);
        } catch (disposeError) {
          console.error(`销毁终端实例失败，但将继续清理其他资源: ${connectionId}`, disposeError);
        }
      } else {
        console.warn(`找不到终端实例: ${connectionId}`);
      }
      
      // 清理FitAddon
      if (state.fitAddons[connectionId]) {
        try {
          console.log(`移除FitAddon: ${connectionId}`);
          const fitAddon = state.fitAddons[connectionId];
          
          // 安全销毁fitAddon
          try {
            if (fitAddon && typeof fitAddon === 'object' && typeof fitAddon.dispose === 'function') {
              // 包装原始dispose方法
              const originalDispose = fitAddon.dispose;
              fitAddon.dispose = function() {
                try {
                  return originalDispose.apply(this, arguments);
                } catch (e) {
                  // 特别处理"addon has not been loaded"错误
                  if (e.message && e.message.includes("addon that has not been loaded")) {
                    console.log(`安全忽略FitAddon未加载错误`);
                  } else {
                    console.warn(`安全忽略FitAddon销毁错误: ${e.message}`);
                  }
                }
              };
              fitAddon.dispose();
            }
          } catch (e) {
            console.warn(`FitAddon销毁过程中出错: ${e.message}`);
          }
          
          delete state.fitAddons[connectionId];
        } catch (error) {
          console.error(`移除FitAddon失败: ${connectionId}`, error);
        }
      }
      
      // 删除状态
      console.log(`清理终端状态: ${connectionId}`);
      delete state.terminals[connectionId];
      delete state.sessions[connectionId];
      delete state.connectionStatus[connectionId];
      
      // 通知SSH服务释放资源
      try {
        await sshService.releaseResources(sessionId);
      } catch (error) {
        console.warn(`通知SSH服务释放资源失败: ${sessionId}`, error);
      }
      
      // 对象置空，帮助垃圾回收
      setTimeout(() => {
        if (typeof window.gc === 'function') {
          try {
            window.gc();
          } catch (e) {
            // 忽略
          }
        }
      }, 1000);
      
      console.log(`终端连接断开完成: ${connectionId}`);
      return true;
    } catch (error) {
      console.error(`断开终端连接失败: ${connectionId}`, error);
      return false;
    }
  }
  
  /**
   * 获取终端状态
   * @param {string} connectionId - 连接ID
   * @returns {string} - 连接状态
   */
  const getTerminalStatus = (connectionId) => {
    return state.connectionStatus[connectionId] || 'unknown'
  }
  
  /**
   * 终端是否已连接
   * @param {string} connectionId - 连接ID
   * @returns {boolean} - 是否已连接
   */
  const isTerminalConnected = (connectionId) => {
    return state.connectionStatus[connectionId] === 'connected'
  }
  
  /**
   * 检查终端是否已存在
   * @param {string} connectionId - 连接ID
   * @returns {boolean} - 是否已存在
   */
  const hasTerminal = (connectionId) => {
    return !!state.terminals[connectionId]
  }
  
  /**
   * 获取终端实例
   * @param {string} connectionId - 连接ID
   * @returns {Object|null} - 终端实例或null
   */
  const getTerminal = (connectionId) => {
    return state.terminals[connectionId] || null
  }
  
  /**
   * 聚焦终端
   * @param {string} connectionId - 连接ID
   */
  const focusTerminal = (connectionId) => {
    if (state.terminals[connectionId]) {
      try {
        state.terminals[connectionId].focus()
      } catch (e) {
        console.error('聚焦终端失败:', e)
      }
    }
  }
  
  /**
   * 将设置应用到所有打开的终端
   * @param {Object} settings - 终端设置
   * @returns {Object} - 应用结果，键为连接ID，值为是否成功
   */
  const applySettingsToAllTerminals = async (settings) => {
    if (!settings) {
      console.warn('无法应用设置：设置对象为空')
      return {}
    }
    
    const results = {}
    
    // 获取所有终端ID
    const terminalIds = Object.keys(state.terminals)
    
    if (terminalIds.length === 0) {
      console.log('没有找到打开的终端，无需应用设置')
      return results
    }
    
    console.log(`正在将设置应用到 ${terminalIds.length} 个终端...`)
    
    // 遍历所有终端并应用设置
    for (const termId of terminalIds) {
      try {
        const terminal = state.terminals[termId]
        if (!terminal) {
          results[termId] = false
          continue
        }
        
        let hasChanges = false
        
        // 应用字体大小
        if (settings.fontSize && terminal.options.fontSize !== settings.fontSize) {
          terminal.options.fontSize = settings.fontSize
          hasChanges = true
        }
        
        // 应用字体系列
        if (settings.fontFamily && terminal.options.fontFamily !== settings.fontFamily) {
          terminal.options.fontFamily = settings.fontFamily
          hasChanges = true
        }
        
        // 应用光标样式
        if (settings.cursorStyle && terminal.options.cursorStyle !== settings.cursorStyle) {
          terminal.options.cursorStyle = settings.cursorStyle
          hasChanges = true
        }
        
        // 应用光标闪烁
        if (settings.cursorBlink !== undefined && terminal.options.cursorBlink !== settings.cursorBlink) {
          terminal.options.cursorBlink = settings.cursorBlink
          hasChanges = true
        }
        
        // 应用终端主题
        if (settings.theme) {
          try {
            // 异步导入以避免循环依赖
            const settingsService = await import('../services/settings').then(m => m.default)
            const themeConfig = settingsService.getTerminalTheme(settings.theme)
            
            // 检查主题是否有变化
            if (JSON.stringify(terminal.options.theme) !== JSON.stringify(themeConfig)) {
              console.log(`终端 ${termId}: 更新主题 ${terminal.options.theme?.background} -> ${themeConfig.background}`)
              
              // 应用新主题
              terminal.options.theme = themeConfig
              
              // 如果终端实例有setOption方法，直接应用主题
              if (terminal.terminal && typeof terminal.terminal.setOption === 'function') {
                terminal.terminal.setOption('theme', themeConfig)
              }
              
              hasChanges = true
            }
          } catch (error) {
            console.error(`应用终端 ${termId} 主题失败:`, error)
          }
        }
        
        // 仅在有更改时执行渲染和调整
        if (hasChanges) {
          // 清除渲染器缓存
          if (terminal._core && terminal._core.renderer) {
            terminal._core.renderer.clear()
          }
          
          // 触发终端重新渲染
          terminal.refresh(0, terminal.rows - 1)
          
          // 延迟调整终端大小
          setTimeout(() => {
            try {
              fitTerminal(termId)
            } catch (e) {
              console.warn(`调整终端 ${termId} 大小失败:`, e)
            }
          }, 100)
          
          results[termId] = true
          console.log(`成功应用设置到终端 ${termId}`)
        } else {
          results[termId] = true
          console.log(`终端 ${termId} 无需更新设置`)
        }
      } catch (error) {
        results[termId] = false
        console.error(`应用设置到终端 ${termId} 失败:`, error)
      }
    }
    
    return results
  }
  
  return {
    ...toRefs(state),
    initTerminal,
    reattachTerminal,
    fitTerminal,
    sendCommand,
    clearTerminal,
    disconnectTerminal,
    getTerminalStatus,
    isTerminalConnected,
    hasTerminal,
    getTerminal,
    focusTerminal,
    applySettingsToAllTerminals
  }
}) 