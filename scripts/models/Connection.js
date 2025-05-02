/**
 * 连接数据模型
 * 提供连接数据的验证、格式化和状态管理
 */

// 导入API
import api from '../services/api/index.js';

// 连接类型枚举
export const ConnectionTypes = {
  SSH: 'ssh',
  SFTP: 'sftp',
  TELNET: 'telnet',
  SERIAL: 'serial'
};

// 认证类型枚举
export const AuthTypes = {
  PASSWORD: 'password',
  PUBLIC_KEY: 'public_key',
  AGENT: 'agent'
};

// 默认连接配置
const DEFAULT_CONNECTION = {
  id: null,
  name: '',
  host: '',
  port: 22,
  username: '',
  password: '',
  type: ConnectionTypes.SSH,
  authType: AuthTypes.PASSWORD,
  privateKey: '',
  passphrase: '',
  savePassword: false,
  description: '',
  tags: [],
  lastConnected: null,
  favorite: false,
  group: 'default',
  color: '#1890ff',
  options: {
    keepAlive: true,
    keepAliveInterval: 60,
    connectTimeout: 10000,
    reconnect: true,
    reconnectDelay: 5000,
    maxReconnectAttempts: 3,
    compression: false
  }
};

/**
 * 连接模型类
 */
export class Connection {
  /**
   * 构造函数
   * @param {Object} data 连接数据
   */
  constructor(data = {}) {
    // 合并默认值和传入数据
    this._data = { ...DEFAULT_CONNECTION, ...data };
    
    // 连接状态
    this._status = {
      connected: false,
      connecting: false,
      error: null,
      lastError: null,
      lastActivity: null,
      reconnectAttempts: 0
    };
    
    // 初始验证
    this.validate();
  }
  
  /**
   * 获取所有数据
   * @returns {Object} 连接数据
   */
  get data() {
    return { ...this._data };
  }
  
  /**
   * 设置数据
   * @param {Object} data 要更新的数据
   */
  set data(data) {
    this._data = { ...this._data, ...data };
    this.validate();
  }
  
  /**
   * 获取连接ID
   * @returns {string} 连接ID
   */
  get id() {
    return this._data.id;
  }
  
  /**
   * 获取连接名称
   * @returns {string} 连接名称
   */
  get name() {
    return this._data.name;
  }
  
  /**
   * 设置连接名称
   * @param {string} value 连接名称
   */
  set name(value) {
    this._data.name = value;
  }
  
  /**
   * 获取主机
   * @returns {string} 主机地址
   */
  get host() {
    return this._data.host;
  }
  
  /**
   * 设置主机
   * @param {string} value 主机地址
   */
  set host(value) {
    this._data.host = value;
  }
  
  /**
   * 获取端口
   * @returns {number} 端口号
   */
  get port() {
    return this._data.port;
  }
  
  /**
   * 设置端口
   * @param {number|string} value 端口号
   */
  set port(value) {
    // 确保端口是数字
    this._data.port = parseInt(value, 10) || DEFAULT_CONNECTION.port;
  }
  
  /**
   * 获取用户名
   * @returns {string} 用户名
   */
  get username() {
    return this._data.username;
  }
  
  /**
   * 设置用户名
   * @param {string} value 用户名
   */
  set username(value) {
    this._data.username = value;
  }
  
  /**
   * 获取认证类型
   * @returns {string} 认证类型
   */
  get authType() {
    return this._data.authType;
  }
  
  /**
   * 设置认证类型
   * @param {string} value 认证类型
   */
  set authType(value) {
    if (Object.values(AuthTypes).includes(value)) {
      this._data.authType = value;
    }
  }
  
  /**
   * 获取连接类型
   * @returns {string} 连接类型
   */
  get type() {
    return this._data.type;
  }
  
  /**
   * 设置连接类型
   * @param {string} value 连接类型
   */
  set type(value) {
    if (Object.values(ConnectionTypes).includes(value)) {
      this._data.type = value;
    }
  }
  
  /**
   * 获取连接状态
   * @returns {Object} 连接状态
   */
  get status() {
    return { ...this._status };
  }
  
  /**
   * 是否已连接
   * @returns {boolean} 是否已连接
   */
  get isConnected() {
    return this._status.connected;
  }
  
  /**
   * 是否正在连接
   * @returns {boolean} 是否正在连接
   */
  get isConnecting() {
    return this._status.connecting;
  }
  
  /**
   * 验证连接数据
   * @returns {boolean} 是否有效
   * @throws {Error} 验证失败时抛出
   */
  validate() {
    const errors = [];
    
    // 名称验证
    if (!this._data.name) {
      errors.push('连接名称不能为空');
    }
    
    // 主机验证
    if (!this._data.host) {
      errors.push('主机地址不能为空');
    }
    
    // 端口验证
    const port = parseInt(this._data.port, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      errors.push('端口号必须是1-65535之间的有效数字');
    }
    
    // 用户名验证
    if (!this._data.username) {
      errors.push('用户名不能为空');
    }
    
    // 根据认证类型验证
    if (this._data.authType === AuthTypes.PASSWORD && !this._data.password && !this._data.savePassword) {
      errors.push('使用密码认证时，密码不能为空');
    } else if (this._data.authType === AuthTypes.PUBLIC_KEY && !this._data.privateKey) {
      errors.push('使用公钥认证时，私钥不能为空');
    }
    
    // 如果有错误
    if (errors.length > 0) {
      const error = new Error(errors.join('\n'));
      error.validationErrors = errors;
      this._status.error = error;
      return false;
    }
    
    this._status.error = null;
    return true;
  }
  
  /**
   * 格式化连接字符串
   * @returns {string} 连接字符串
   */
  toString() {
    return `${this._data.username}@${this._data.host}:${this._data.port}`;
  }
  
  /**
   * 获取显示标识
   * @returns {string} 用于显示的字符串
   */
  getDisplayName() {
    return this._data.name || this.toString();
  }
  
  /**
   * 创建连接副本
   * @returns {Connection} 新的连接实例
   */
  clone() {
    return new Connection(this._data);
  }
  
  /**
   * 重置连接状态
   */
  resetStatus() {
    this._status = {
      connected: false,
      connecting: false,
      error: null,
      lastError: this._status.error,
      lastActivity: this._status.lastActivity,
      reconnectAttempts: 0
    };
  }
  
  /**
   * 更新连接状态
   * @param {Object} status 状态对象
   */
  updateStatus(status) {
    this._status = { ...this._status, ...status };
    
    // 如果连接成功，更新最后连接时间
    if (status.connected && !this._status.connected) {
      this._data.lastConnected = new Date().toISOString();
    }
  }
  
  /**
   * 将模型转换为API可用的数据
   * @returns {Object} API数据
   */
  toApiData() {
    // 创建一个副本
    const apiData = { ...this._data };
    
    // 如果不保存密码，移除敏感信息
    if (!apiData.savePassword) {
      delete apiData.password;
      delete apiData.passphrase;
    }
    
    return apiData;
  }
  
  /**
   * 从API数据创建模型
   * @param {Object} apiData API返回的数据
   * @returns {Connection} 连接模型实例
   */
  static fromApiData(apiData) {
    return new Connection(apiData);
  }
  
  /**
   * 连接测试
   * @returns {Promise<Object>} 测试结果
   */
  async test() {
    try {
      this.updateStatus({ connecting: true });
      const result = await api.connection.test(this.toApiData());
      this.updateStatus({ 
        connecting: false,
        connected: result.success,
        error: result.success ? null : new Error(result.message)
      });
      return result;
    } catch (error) {
      this.updateStatus({ 
        connecting: false,
        connected: false,
        error
      });
      throw error;
    }
  }
  
  /**
   * 保存连接
   * @returns {Promise<Connection>} 保存后的连接
   */
  async save() {
    try {
      let result;
      
      if (this._data.id) {
        // 更新
        result = await api.connection.update(this._data.id, this.toApiData());
      } else {
        // 创建
        result = await api.connection.create(this.toApiData());
      }
      
      // 更新数据
      this._data = { ...this._data, ...result };
      
      return this;
    } catch (error) {
      this._status.error = error;
      throw error;
    }
  }
  
  /**
   * 删除连接
   * @returns {Promise<boolean>} 是否成功
   */
  async delete() {
    if (!this._data.id) {
      throw new Error('无法删除未保存的连接');
    }
    
    try {
      await api.connection.delete(this._data.id);
      return true;
    } catch (error) {
      this._status.error = error;
      throw error;
    }
  }
  
  /**
   * 加载连接详情
   * @param {string} id 连接ID
   * @returns {Promise<Connection>} 加载后的连接
   */
  static async load(id) {
    try {
      const data = await api.connection.getById(id);
      return Connection.fromApiData(data);
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * 加载所有连接
   * @param {Object} params 查询参数
   * @returns {Promise<Array<Connection>>} 连接列表
   */
  static async loadAll(params = {}) {
    try {
      const dataList = await api.connection.getAllConnections(params);
      return dataList.map(data => Connection.fromApiData(data));
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * 创建一个新的连接
   * @param {Object} initialData 初始数据
   * @returns {Connection} 新连接实例
   */
  static create(initialData = {}) {
    return new Connection(initialData);
  }
}

export default Connection; 