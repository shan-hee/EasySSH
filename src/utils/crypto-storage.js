/**
 * 基于WebCrypto API的安全本地存储工具
 * 使用AES-GCM加密算法和PBKDF2密钥派生
 */

class CryptoStorage {
  constructor() {
    this.algorithm = 'AES-GCM';
    this.keyLength = 256;
    this.ivLength = 12;
    this.saltLength = 16;
    this.iterations = 120000; // PBKDF2迭代次数
    this.storagePrefix = 'easyssh_encrypted_';
  }

  /**
   * 检查WebCrypto API支持
   * @returns {boolean} 是否支持WebCrypto
   */
  isSupported() {
    return typeof crypto !== 'undefined' && 
           typeof crypto.subtle !== 'undefined' &&
           typeof crypto.getRandomValues !== 'undefined';
  }

  /**
   * 派生加密密钥
   * @param {string} password 用户密码
   * @param {Uint8Array} salt 盐值
   * @returns {Promise<CryptoKey>} 派生的密钥
   */
  async deriveKey(password, salt) {
    if (!this.isSupported()) {
      throw new Error('WebCrypto API不支持');
    }

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: this.iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      {
        name: this.algorithm,
        length: this.keyLength
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * 加密数据
   * @param {string} password 用户密码
   * @param {any} data 要加密的数据
   * @returns {Promise<Object>} 加密结果
   */
  async encryptData(password, data) {
    if (!this.isSupported()) {
      throw new Error('WebCrypto API不支持');
    }

    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(this.ivLength));
    const salt = crypto.getRandomValues(new Uint8Array(this.saltLength));

    const key = await this.deriveKey(password, salt);
    const encodedData = encoder.encode(JSON.stringify(data));

    const encrypted = await crypto.subtle.encrypt(
      { name: this.algorithm, iv },
      key,
      encodedData
    );

    return {
      version: '1.0',
      algorithm: this.algorithm,
      iv: Array.from(iv),
      salt: Array.from(salt),
      data: Array.from(new Uint8Array(encrypted)),
      timestamp: Date.now()
    };
  }

  /**
   * 解密数据
   * @param {string} password 用户密码
   * @param {Object} encryptedData 加密的数据对象
   * @returns {Promise<any>} 解密后的数据
   */
  async decryptData(password, encryptedData) {
    if (!this.isSupported()) {
      throw new Error('WebCrypto API不支持');
    }

    const { iv, salt, data, version } = encryptedData;

    // 检查版本兼容性
    if (version && version !== '1.0') {
      throw new Error(`不支持的加密版本: ${version}`);
    }

    const key = await this.deriveKey(password, new Uint8Array(salt));

    const decrypted = await crypto.subtle.decrypt(
      { name: this.algorithm, iv: new Uint8Array(iv) },
      key,
      new Uint8Array(data)
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted));
  }

  /**
   * 安全存储数据到localStorage
   * @param {string} key 存储键名
   * @param {string} password 用户密码
   * @param {any} data 要存储的数据
   * @returns {Promise<boolean>} 是否成功
   */
  async secureStore(key, password, data) {
    try {
      const encrypted = await this.encryptData(password, data);
      const storageKey = this.storagePrefix + key;
      
      localStorage.setItem(storageKey, JSON.stringify(encrypted));
      
      console.debug(`数据已安全存储: ${key}`);
      return true;
    } catch (error) {
      console.error('安全存储失败:', error);
      return false;
    }
  }

  /**
   * 从localStorage安全读取数据
   * @param {string} key 存储键名
   * @param {string} password 用户密码
   * @returns {Promise<any|null>} 解密后的数据或null
   */
  async secureRetrieve(key, password) {
    try {
      const storageKey = this.storagePrefix + key;
      const stored = localStorage.getItem(storageKey);
      
      if (!stored) {
        return null;
      }

      const encrypted = JSON.parse(stored);
      const decrypted = await this.decryptData(password, encrypted);
      
      console.debug(`数据已安全读取: ${key}`);
      return decrypted;
    } catch (error) {
      console.error('安全读取失败:', error);
      return null;
    }
  }

  /**
   * 删除安全存储的数据
   * @param {string} key 存储键名
   * @returns {boolean} 是否成功
   */
  secureRemove(key) {
    try {
      const storageKey = this.storagePrefix + key;
      localStorage.removeItem(storageKey);
      console.debug(`安全数据已删除: ${key}`);
      return true;
    } catch (error) {
      console.error('删除安全数据失败:', error);
      return false;
    }
  }

  /**
   * 列出所有加密存储的键名
   * @returns {string[]} 键名列表
   */
  listSecureKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.storagePrefix)) {
        keys.push(key.substring(this.storagePrefix.length));
      }
    }
    return keys;
  }

  /**
   * 清理所有加密存储的数据
   * @returns {number} 清理的项目数量
   */
  clearAllSecureData() {
    const keys = this.listSecureKeys();
    let cleared = 0;
    
    keys.forEach(key => {
      if (this.secureRemove(key)) {
        cleared++;
      }
    });
    
    console.info(`已清理 ${cleared} 个加密存储项目`);
    return cleared;
  }

  /**
   * 验证密码是否正确
   * @param {string} key 存储键名
   * @param {string} password 要验证的密码
   * @returns {Promise<boolean>} 密码是否正确
   */
  async verifyPassword(key, password) {
    try {
      const data = await this.secureRetrieve(key, password);
      return data !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * 生成安全的随机密码
   * @param {number} length 密码长度
   * @returns {string} 随机密码
   */
  generateSecurePassword(length = 32) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    
    return Array.from(array, byte => charset[byte % charset.length]).join('');
  }

  /**
   * 获取存储统计信息
   * @returns {Object} 统计信息
   */
  getStorageStats() {
    const keys = this.listSecureKeys();
    let totalSize = 0;
    
    keys.forEach(key => {
      const storageKey = this.storagePrefix + key;
      const data = localStorage.getItem(storageKey);
      if (data) {
        totalSize += data.length;
      }
    });
    
    return {
      itemCount: keys.length,
      totalSize,
      totalSizeKB: Math.round(totalSize / 1024 * 100) / 100,
      keys
    };
  }
}

// 创建单例实例
const cryptoStorage = new CryptoStorage();

export default cryptoStorage;
