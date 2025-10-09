/**
 * 密码管理器服务
 * 管理用户的主密码和加密存储
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import cryptoStorage from '../utils/crypto-storage';
import log from './log';

class PasswordManager {
  masterPassword: Ref<string | null>;
  isUnlocked: ComputedRef<boolean>;
  autoLockTimer: ReturnType<typeof setTimeout> | null;
  autoLockDelay: number;
  passwordRequirements: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
  };

  constructor() {
    // 当前会话的主密码
    this.masterPassword = ref<string | null>(null);

    // 密码状态
    this.isUnlocked = computed<boolean>(() => this.masterPassword.value !== null);

    // 自动锁定定时器
    this.autoLockTimer = null;
    this.autoLockDelay = 30 * 60 * 1000; // 30分钟

    // 密码强度要求
    this.passwordRequirements = {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: false
    };

    this.init();
  }

  /**
   * 初始化密码管理器
   */
  init(): void {
    // 检查WebCrypto支持
    if (!cryptoStorage.isSupported()) {
      ElMessage.error('浏览器不支持WebCrypto API，无法使用加密存储功能');
      return;
    }

    // 监听页面可见性变化
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.startAutoLockTimer();
      } else {
        this.resetAutoLockTimer();
      }
    });

    // 监听用户活动
    ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(event => {
      document.addEventListener(
        event,
        () => {
          this.resetAutoLockTimer();
        },
        { passive: true }
      );
    });

    log.info('密码管理器已初始化');
  }

  /**
   * 验证密码强度
   * @param {string} password 密码
   * @returns {Object} 验证结果
   */
  validatePasswordStrength(password: string): { isValid: boolean; score: number; issues: string[] } {
    const result: { isValid: boolean; score: number; issues: string[] } = {
      isValid: true,
      score: 0,
      issues: []
    };

    if (password.length < this.passwordRequirements.minLength) {
      result.isValid = false;
      result.issues.push(`密码长度至少需要${this.passwordRequirements.minLength}位`);
    } else {
      result.score += 20;
    }

    if (this.passwordRequirements.requireUppercase && !/[A-Z]/.test(password)) {
      result.isValid = false;
      result.issues.push('密码需要包含大写字母');
    } else if (/[A-Z]/.test(password)) {
      result.score += 20;
    }

    if (this.passwordRequirements.requireLowercase && !/[a-z]/.test(password)) {
      result.isValid = false;
      result.issues.push('密码需要包含小写字母');
    } else if (/[a-z]/.test(password)) {
      result.score += 20;
    }

    if (this.passwordRequirements.requireNumbers && !/\d/.test(password)) {
      result.isValid = false;
      result.issues.push('密码需要包含数字');
    } else if (/\d/.test(password)) {
      result.score += 20;
    }

    if (this.passwordRequirements.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      result.isValid = false;
      result.issues.push('密码需要包含特殊字符');
    } else if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      result.score += 20;
    }

    // 额外的复杂度检查
    if (password.length >= 12) result.score += 10;
    if (password.length >= 16) result.score += 10;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) result.score += 10;

    return result;
  }

  /**
   * 设置主密码
   * @param {string} password 主密码
   * @returns {Promise<boolean>} 是否成功
   */
  async setMasterPassword(password: string): Promise<boolean> {
    try {
      // 验证密码强度
      const validation = this.validatePasswordStrength(password);
      if (!validation.isValid) {
        ElMessage.error(`密码强度不足: ${validation.issues.join(', ')}`);
        return false;
      }

      // 创建一个测试数据来验证密码
      const testData = { test: 'master_password_verification', timestamp: Date.now() };
      const success = await (cryptoStorage as any).secureStore('master_password_test', password, testData);

      if (success) {
        this.masterPassword.value = password;
        this.resetAutoLockTimer();

        ElMessage.success('主密码设置成功');
        log.info('主密码已设置');
        return true;
      } else {
        ElMessage.error('主密码设置失败');
        return false;
      }
    } catch (error: any) {
      log.error('设置主密码失败:', error);
      ElMessage.error('设置主密码时发生错误');
      return false;
    }
  }

  /**
   * 验证主密码
   * @param {string} password 要验证的密码
   * @returns {Promise<boolean>} 是否正确
   */
  async verifyMasterPassword(password: string): Promise<boolean> {
    try {
      const isValid = await (cryptoStorage as any).verifyPassword('master_password_test', password);

      if (isValid) {
        this.masterPassword.value = password;
        this.resetAutoLockTimer();
        log.info('主密码验证成功');
        return true;
      } else {
        log.warn('主密码验证失败');
        return false;
      }
    } catch (error: any) {
      log.error('验证主密码失败:', error);
      return false;
    }
  }

  /**
   * 检查是否已设置主密码
   * @returns {boolean} 是否已设置
   */
  hasMasterPassword(): boolean {
    const keys = (cryptoStorage as any).listSecureKeys() as string[];
    return keys.includes('master_password_test');
  }

  /**
   * 请求用户输入主密码
   * @param {string} action 操作描述
   * @returns {Promise<boolean>} 是否成功解锁
   */
  async requestMasterPassword(action: string = '访问加密数据'): Promise<boolean> {
    if (this.isUnlocked.value) {
      return true;
    }

    try {
      const { value: password } = (await (ElMessageBox as any).prompt(`请输入主密码以${action}`, '身份验证', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: '请输入主密码',
        inputValidator: (value: string) => {
          if (!value) {
            return '请输入密码';
          }
          return true;
        }
      })) as { value: string };

      const isValid = await this.verifyMasterPassword(password);
      if (!isValid) {
        ElMessage.error('密码错误');
        return false;
      }

      return true;
    } catch (error: any) {
      log.debug('用户取消密码输入');
      return false;
    }
  }

  /**
   * 锁定密码管理器
   */
  lock(): void {
    this.masterPassword.value = null;
    this.clearAutoLockTimer();
    log.info('密码管理器已锁定');
  }

  /**
   * 启动自动锁定定时器
   */
  startAutoLockTimer(): void {
    this.clearAutoLockTimer();
    this.autoLockTimer = setTimeout(() => {
      this.lock();
      ElMessage.info('由于长时间未活动，已自动锁定');
    }, this.autoLockDelay);
  }

  /**
   * 重置自动锁定定时器
   */
  resetAutoLockTimer(): void {
    if (this.isUnlocked.value) {
      this.startAutoLockTimer();
    }
  }

  /**
   * 清除自动锁定定时器
   */
  clearAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
  }

  /**
   * 安全存储数据
   * @param {string} key 存储键
   * @param {any} data 数据
   * @returns {Promise<boolean>} 是否成功
   */
  async secureStore(key: string, data: any): Promise<boolean> {
    if (!this.isUnlocked.value) {
      const unlocked = await this.requestMasterPassword('存储数据');
      if (!unlocked) return false;
    }

    return await (cryptoStorage as any).secureStore(key, this.masterPassword.value, data);
  }

  /**
   * 安全读取数据
   * @param {string} key 存储键
   * @returns {Promise<any|null>} 数据或null
   */
  async secureRetrieve(key: string): Promise<any | null> {
    if (!this.isUnlocked.value) {
      const unlocked = await this.requestMasterPassword('读取数据');
      if (!unlocked) return null;
    }

    return await (cryptoStorage as any).secureRetrieve(key, this.masterPassword.value);
  }

  /**
   * 删除安全存储的数据
   * @param {string} key 存储键
   * @returns {boolean} 是否成功
   */
  secureRemove(key: string): boolean {
    return (cryptoStorage as any).secureRemove(key);
  }

  /**
   * 获取存储统计
   * @returns {Object} 统计信息
   */
  getStorageStats(): any {
    return (cryptoStorage as any).getStorageStats();
  }

  /**
   * 清理所有加密数据
   * @returns {Promise<boolean>} 是否成功
   */
  async clearAllData(): Promise<boolean> {
    try {
      const confirmed = await (ElMessageBox as any).confirm(
        '这将删除所有加密存储的数据，包括服务器配置和凭据。此操作不可恢复！',
        '确认清理',
        {
          confirmButtonText: '确定删除',
          cancelButtonText: '取消',
          type: 'warning'
        }
      );

      if (confirmed) {
        const cleared = (cryptoStorage as any).clearAllSecureData();
        this.lock();
        ElMessage.success(`已清理 ${cleared} 个加密存储项目`);
        return true;
      }
    } catch (error: any) {
      log.debug('用户取消清理操作');
    }

    return false;
  }
}

// 创建单例
const passwordManager = new PasswordManager();

export default passwordManager;
