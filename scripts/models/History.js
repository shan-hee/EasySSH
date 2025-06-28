/**
 * 历史记录数据模型
 * 处理连接历史和命令历史
 */

import { getFromStorage, saveToStorage } from '../../src/utils/storage.js';
import { EventEmitter } from '../utils/events.js';
// Settings类已移除，使用统一的设置服务
import settingsService from '../../src/services/settings.js';

// 本地存储键
const STORAGE_KEYS = {
  CONNECTIONS: 'history.connections',
  COMMANDS: 'history.commands'
};

// 默认配置
const DEFAULT_CONFIG = {
  // 最大记录数
  maxConnectionHistory: 50,
  maxCommandHistory: 100,
  
  // 是否启用历史记录
  enableConnectionHistory: true,
  enableCommandHistory: true,
  
  // 过滤选项
  saveFailedConnections: false,
  saveSystemCommands: true,
  
  // 历史记录过期时间（天），0表示不过期
  connectionHistoryExpiration: 30,
  commandHistoryExpiration: 90
};

/**
 * 历史记录条目
 */
class HistoryEntry {
  /**
   * 构造函数
   * @param {Object} data 条目数据
   */
  constructor(data = {}) {
    this.id = data.id || this._generateId();
    this.timestamp = data.timestamp || Date.now();
    this.data = data.data || {};
  }
  
  /**
   * 生成唯一ID
   * @returns {string} 唯一ID
   * @private
   */
  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  }
  
  /**
   * 更新时间戳
   */
  touch() {
    this.timestamp = Date.now();
  }
  
  /**
   * 获取条目年龄（天）
   * @returns {number} 年龄（天）
   */
  getAge() {
    const ageMs = Date.now() - this.timestamp;
    return ageMs / (1000 * 60 * 60 * 24);
  }
  
  /**
   * 序列化为JSON
   * @returns {Object} JSON对象
   */
  toJSON() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      data: this.data
    };
  }
  
  /**
   * 从JSON创建条目
   * @param {Object} json JSON对象
   * @returns {HistoryEntry} 历史记录条目
   */
  static fromJSON(json) {
    return new HistoryEntry(json);
  }
}

/**
 * 连接历史条目
 */
class ConnectionHistoryEntry extends HistoryEntry {
  /**
   * 构造函数
   * @param {Object} data 条目数据
   */
  constructor(data = {}) {
    super(data);
    
    // 连接特定属性
    this.data.host = data.data?.host || '';
    this.data.port = data.data?.port || 22;
    this.data.username = data.data?.username || '';
    this.data.type = data.data?.type || 'ssh';
    this.data.name = data.data?.name || '';
    this.data.duration = data.data?.duration || 0;
    this.data.status = data.data?.status || 'unknown';
    this.data.lastAccess = data.data?.lastAccess || Date.now();
    this.data.accessCount = data.data?.accessCount || 1;
  }
  
  /**
   * 获取显示名称
   * @returns {string} 显示名称
   */
  get displayName() {
    if (this.data.name) {
      return this.data.name;
    }
    
    return `${this.data.username}@${this.data.host}:${this.data.port}`;
  }
  
  /**
   * 更新访问信息
   */
  updateAccess() {
    this.data.lastAccess = Date.now();
    this.data.accessCount++;
    this.touch();
  }
  
  /**
   * 设置状态
   * @param {string} status 状态
   * @param {number} [duration] 持续时间
   */
  setStatus(status, duration) {
    this.data.status = status;
    if (duration) {
      this.data.duration = duration;
    }
    this.touch();
  }
}

/**
 * 命令历史条目
 */
class CommandHistoryEntry extends HistoryEntry {
  /**
   * 构造函数
   * @param {Object} data 条目数据
   */
  constructor(data = {}) {
    super(data);
    
    // 命令特定属性
    this.data.command = data.data?.command || '';
    this.data.connectionId = data.data?.connectionId || null;
    this.data.exitCode = data.data?.exitCode !== undefined ? data.data.exitCode : null;
    this.data.executionTime = data.data?.executionTime || 0;
    this.data.isSystem = !!data.data?.isSystem;
    this.data.output = data.data?.output || '';
  }
  
  /**
   * 获取命令文本
   * @returns {string} 命令文本
   */
  get command() {
    return this.data.command;
  }
  
  /**
   * 更新执行结果
   * @param {number} exitCode 退出码
   * @param {number} executionTime 执行时间
   * @param {string} output 输出内容
   */
  updateResult(exitCode, executionTime, output) {
    this.data.exitCode = exitCode;
    this.data.executionTime = executionTime;
    
    if (output !== undefined) {
      this.data.output = output;
    }
    
    this.touch();
  }
}

/**
 * 历史记录管理器
 */
export class History extends EventEmitter {
  /**
   * 构造函数
   * @param {Object} config 配置
   */
  constructor(config = {}) {
    super();
    
    // 配置
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // 设置管理器
    this.settings = settingsService;
    
    // 加载历史记录
    this._connections = this._loadConnections();
    this._commands = this._loadCommands();
    
    // 设置清理计时器
    this._setupCleanupTimer();
    
    // 从设置中加载配置
    this._loadConfigFromSettings();
  }
  
  /**
   * 从设置中加载配置
   * @private
   */
  _loadConfigFromSettings() {
    // 命令历史设置
    const commandHistoryEnabled = this.settings.get('connection.saveHistory', true);
    if (this.config.enableCommandHistory !== commandHistoryEnabled) {
      this.config.enableCommandHistory = commandHistoryEnabled;
    }

    // 连接历史设置
    const saveHistory = this.settings.get('connection.saveHistory', true);
    if (this.config.enableConnectionHistory !== saveHistory) {
      this.config.enableConnectionHistory = saveHistory;
    }
  }
  
  /**
   * 设置定期清理计时器
   * @private
   */
  _setupCleanupTimer() {
    // 每天执行一次清理
    const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24小时
    
    this._cleanupTimer = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL);
  }
  
  /**
   * 加载连接历史
   * @returns {Map<string, ConnectionHistoryEntry>} 连接历史
   * @private
   */
  _loadConnections() {
    const connections = new Map();
    const storedConnections = getFromStorage(STORAGE_KEYS.CONNECTIONS) || [];
    
    for (const item of storedConnections) {
      const entry = new ConnectionHistoryEntry(item);
      connections.set(entry.id, entry);
    }
    
    return connections;
  }
  
  /**
   * 加载命令历史
   * @returns {Map<string, CommandHistoryEntry>} 命令历史
   * @private
   */
  _loadCommands() {
    const commands = new Map();
    const storedCommands = getFromStorage(STORAGE_KEYS.COMMANDS) || [];
    
    for (const item of storedCommands) {
      const entry = new CommandHistoryEntry(item);
      commands.set(entry.id, entry);
    }
    
    return commands;
  }
  
  /**
   * 保存连接历史
   * @private
   */
  _saveConnections() {
    if (!this.config.enableConnectionHistory) {
      return;
    }
    
    const connections = Array.from(this._connections.values())
      .map(entry => entry.toJSON());
    
    saveToStorage(STORAGE_KEYS.CONNECTIONS, connections);
  }
  
  /**
   * 保存命令历史
   * @private
   */
  _saveCommands() {
    if (!this.config.enableCommandHistory) {
      return;
    }
    
    const commands = Array.from(this._commands.values())
      .map(entry => entry.toJSON());
    
    saveToStorage(STORAGE_KEYS.COMMANDS, commands);
  }
  
  /**
   * 添加连接历史记录
   * @param {Object} connectionData 连接数据
   * @returns {ConnectionHistoryEntry} 连接历史条目
   */
  addConnection(connectionData) {
    if (!this.config.enableConnectionHistory) {
      return null;
    }
    
    // 检查是否保存失败连接
    if (!this.config.saveFailedConnections && 
        connectionData.status === 'failed') {
      return null;
    }
    
    // 查找是否已存在相同连接
    let existingEntry = null;
    
    for (const entry of this._connections.values()) {
      if (entry.data.host === connectionData.host && 
          entry.data.port === connectionData.port &&
          entry.data.username === connectionData.username &&
          entry.data.type === connectionData.type) {
        existingEntry = entry;
        break;
      }
    }
    
    if (existingEntry) {
      // 更新现有条目
      existingEntry.updateAccess();
      existingEntry.setStatus(connectionData.status, connectionData.duration);
      
      // 触发更新事件
      this.emit('connection:updated', existingEntry);
    } else {
      // 创建新条目
      const entry = new ConnectionHistoryEntry({
        data: connectionData
      });
      
      // 添加到集合
      this._connections.set(entry.id, entry);
      
      // 触发添加事件
      this.emit('connection:added', entry);
      
      // 检查历史记录数量限制
      this._enforceConnectionLimit();
      
      existingEntry = entry;
    }
    
    // 保存到存储
    this._saveConnections();
    
    return existingEntry;
  }
  
  /**
   * 添加命令历史记录
   * @param {Object} commandData 命令数据
   * @returns {CommandHistoryEntry} 命令历史条目
   */
  addCommand(commandData) {
    if (!this.config.enableCommandHistory) {
      return null;
    }
    
    // 检查是否保存系统命令
    if (!this.config.saveSystemCommands && commandData.isSystem) {
      return null;
    }
    
    // 检查命令是否为空
    if (!commandData.command || commandData.command.trim() === '') {
      return null;
    }
    
    // 查找是否最近执行过完全相同的命令
    const recentTime = Date.now() - 60000; // 1分钟内
    let isDuplicate = false;
    
    for (const entry of this._commands.values()) {
      if (entry.data.command === commandData.command &&
          entry.data.connectionId === commandData.connectionId &&
          entry.timestamp > recentTime) {
        isDuplicate = true;
        break;
      }
    }
    
    // 跳过重复命令
    if (isDuplicate) {
      return null;
    }
    
    // 创建新条目
    const entry = new CommandHistoryEntry({
      data: commandData
    });
    
    // 添加到集合
    this._commands.set(entry.id, entry);
    
    // 触发添加事件
    this.emit('command:added', entry);
    
    // 检查历史记录数量限制
    this._enforceCommandLimit();
    
    // 保存到存储
    this._saveCommands();
    
    return entry;
  }
  
  /**
   * 执行连接历史数量限制
   * @private
   */
  _enforceConnectionLimit() {
    if (this._connections.size <= this.config.maxConnectionHistory) {
      return;
    }
    
    // 按时间戳排序
    const sorted = Array.from(this._connections.values())
      .sort((a, b) => b.timestamp - a.timestamp);
    
    // 保留最近的记录
    const toKeep = sorted.slice(0, this.config.maxConnectionHistory);
    const toRemove = sorted.slice(this.config.maxConnectionHistory);
    
    // 移除多余记录
    for (const entry of toRemove) {
      this._connections.delete(entry.id);
      this.emit('connection:removed', entry);
    }
  }
  
  /**
   * 执行命令历史数量限制
   * @private
   */
  _enforceCommandLimit() {
    if (this._commands.size <= this.config.maxCommandHistory) {
      return;
    }
    
    // 按时间戳排序
    const sorted = Array.from(this._commands.values())
      .sort((a, b) => b.timestamp - a.timestamp);
    
    // 保留最近的记录
    const toKeep = sorted.slice(0, this.config.maxCommandHistory);
    const toRemove = sorted.slice(this.config.maxCommandHistory);
    
    // 移除多余记录
    for (const entry of toRemove) {
      this._commands.delete(entry.id);
      this.emit('command:removed', entry);
    }
  }
  
  /**
   * 获取连接历史记录
   * @param {Object} [options] 选项
   * @param {string} [options.sortBy='timestamp'] 排序字段
   * @param {boolean} [options.desc=true] 是否降序
   * @param {number} [options.limit] 限制数量
   * @param {Function} [options.filter] 过滤函数
   * @returns {ConnectionHistoryEntry[]} 连接历史条目数组
   */
  getConnections(options = {}) {
    const {
      sortBy = 'timestamp',
      desc = true,
      limit,
      filter
    } = options;
    
    let entries = Array.from(this._connections.values());
    
    // 应用过滤
    if (filter && typeof filter === 'function') {
      entries = entries.filter(filter);
    }
    
    // 应用排序
    entries.sort((a, b) => {
      let valueA, valueB;
      
      if (sortBy === 'timestamp') {
        valueA = a.timestamp;
        valueB = b.timestamp;
      } else if (sortBy.startsWith('data.')) {
        const dataKey = sortBy.substring(5);
        valueA = a.data[dataKey];
        valueB = b.data[dataKey];
      }
      
      if (valueA < valueB) return desc ? 1 : -1;
      if (valueA > valueB) return desc ? -1 : 1;
      return 0;
    });
    
    // 应用限制
    if (limit && limit > 0) {
      entries = entries.slice(0, limit);
    }
    
    return entries;
  }
  
  /**
   * 获取命令历史记录
   * @param {Object} [options] 选项
   * @param {string} [options.sortBy='timestamp'] 排序字段
   * @param {boolean} [options.desc=true] 是否降序
   * @param {number} [options.limit] 限制数量
   * @param {Function} [options.filter] 过滤函数
   * @param {string} [options.connectionId] 连接ID
   * @returns {CommandHistoryEntry[]} 命令历史条目数组
   */
  getCommands(options = {}) {
    const {
      sortBy = 'timestamp',
      desc = true,
      limit,
      filter,
      connectionId
    } = options;
    
    let entries = Array.from(this._commands.values());
    
    // 应用连接过滤
    if (connectionId) {
      entries = entries.filter(entry => 
        entry.data.connectionId === connectionId
      );
    }
    
    // 应用自定义过滤
    if (filter && typeof filter === 'function') {
      entries = entries.filter(filter);
    }
    
    // 应用排序
    entries.sort((a, b) => {
      let valueA, valueB;
      
      if (sortBy === 'timestamp') {
        valueA = a.timestamp;
        valueB = b.timestamp;
      } else if (sortBy.startsWith('data.')) {
        const dataKey = sortBy.substring(5);
        valueA = a.data[dataKey];
        valueB = b.data[dataKey];
      }
      
      if (valueA < valueB) return desc ? 1 : -1;
      if (valueA > valueB) return desc ? -1 : 1;
      return 0;
    });
    
    // 应用限制
    if (limit && limit > 0) {
      entries = entries.slice(0, limit);
    }
    
    return entries;
  }
  
  /**
   * 获取连接历史记录
   * @param {string} id 条目ID
   * @returns {ConnectionHistoryEntry|null} 连接历史条目
   */
  getConnection(id) {
    return this._connections.get(id) || null;
  }
  
  /**
   * 获取命令历史记录
   * @param {string} id 条目ID
   * @returns {CommandHistoryEntry|null} 命令历史条目
   */
  getCommand(id) {
    return this._commands.get(id) || null;
  }
  
  /**
   * 移除连接历史记录
   * @param {string} id 条目ID
   * @returns {boolean} 是否成功移除
   */
  removeConnection(id) {
    const entry = this._connections.get(id);
    if (!entry) {
      return false;
    }
    
    // 移除条目
    this._connections.delete(id);
    
    // 触发事件
    this.emit('connection:removed', entry);
    
    // 保存到存储
    this._saveConnections();
    
    return true;
  }
  
  /**
   * 移除命令历史记录
   * @param {string} id 条目ID
   * @returns {boolean} 是否成功移除
   */
  removeCommand(id) {
    const entry = this._commands.get(id);
    if (!entry) {
      return false;
    }
    
    // 移除条目
    this._commands.delete(id);
    
    // 触发事件
    this.emit('command:removed', entry);
    
    // 保存到存储
    this._saveCommands();
    
    return true;
  }
  
  /**
   * 清空连接历史
   * @returns {number} 清除的记录数量
   */
  clearConnections() {
    const count = this._connections.size;
    
    if (count === 0) {
      return 0;
    }
    
    // 备份当前记录
    const oldEntries = Array.from(this._connections.values());
    
    // 清空记录
    this._connections.clear();
    
    // 发出事件
    this.emit('connections:cleared', oldEntries);
    
    // 保存到存储
    this._saveConnections();
    
    return count;
  }
  
  /**
   * 清空命令历史
   * @param {string} [connectionId] 连接ID，如果提供则只清空该连接的命令历史
   * @returns {number} 清除的记录数量
   */
  clearCommands(connectionId) {
    let count = 0;
    let removedEntries = [];
    
    if (connectionId) {
      // 仅清空特定连接的命令
      for (const [id, entry] of this._commands.entries()) {
        if (entry.data.connectionId === connectionId) {
          this._commands.delete(id);
          removedEntries.push(entry);
          count++;
        }
      }
    } else {
      // 清空所有命令
      count = this._commands.size;
      removedEntries = Array.from(this._commands.values());
      this._commands.clear();
    }
    
    if (count > 0) {
      // 发出事件
      this.emit('commands:cleared', removedEntries, connectionId);
      
      // 保存到存储
      this._saveCommands();
    }
    
    return count;
  }
  
  /**
   * 清理过期记录
   * @returns {Object} 清理结果 { connections, commands }
   */
  cleanup() {
    const result = {
      connections: 0,
      commands: 0
    };
    
    // 清理连接历史
    if (this.config.connectionHistoryExpiration > 0) {
      const maxAge = this.config.connectionHistoryExpiration;
      const now = Date.now();
      
      for (const [id, entry] of this._connections.entries()) {
        const age = entry.getAge();
        
        if (age > maxAge) {
          this._connections.delete(id);
          this.emit('connection:expired', entry);
          result.connections++;
        }
      }
    }
    
    // 清理命令历史
    if (this.config.commandHistoryExpiration > 0) {
      const maxAge = this.config.commandHistoryExpiration;
      const now = Date.now();
      
      for (const [id, entry] of this._commands.entries()) {
        const age = entry.getAge();
        
        if (age > maxAge) {
          this._commands.delete(id);
          this.emit('command:expired', entry);
          result.commands++;
        }
      }
    }
    
    // 如果有清理，保存到存储
    if (result.connections > 0) {
      this._saveConnections();
    }
    
    if (result.commands > 0) {
      this._saveCommands();
    }
    
    if (result.connections > 0 || result.commands > 0) {
      this.emit('cleanup', result);
    }
    
    return result;
  }
  
  /**
   * 更新设置
   * @param {Object} config 新的配置
   */
  updateConfig(config) {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };
    
    // 配置变更事件
    this.emit('config:updated', this.config, oldConfig);
    
    // 如果修改了数量限制，执行限制
    if (this.config.maxConnectionHistory !== oldConfig.maxConnectionHistory) {
      this._enforceConnectionLimit();
    }
    
    if (this.config.maxCommandHistory !== oldConfig.maxCommandHistory) {
      this._enforceCommandLimit();
    }
  }
  
  /**
   * 创建历史记录管理器单例
   * @param {Object} config 配置
   * @returns {History} 历史记录管理器
   */
  static create(config = {}) {
    if (!History.instance) {
      History.instance = new History(config);
    }
    return History.instance;
  }
  
  /**
   * 获取历史记录管理器单例
   * @returns {History} 历史记录管理器
   */
  static getInstance() {
    return History.create();
  }
  
  /**
   * 销毁实例
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    
    this.removeAllListeners();
    
    if (History.instance === this) {
      History.instance = null;
    }
  }
}

export default History; 