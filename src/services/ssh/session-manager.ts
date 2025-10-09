import log from '../log';

/**
 * SSH会话管理器
 * 负责管理终端ID与SSH会话ID之间的映射关系
 */
class SSHSessionManager {
  private terminalToSSH: Map<string, string>; // 终端ID -> SSH会话ID
  private sshToTerminal: Map<string, string>; // SSH会话ID -> 终端ID

  constructor() {
    this.terminalToSSH = new Map(); // 终端ID -> SSH会话ID
    this.sshToTerminal = new Map(); // SSH会话ID -> 终端ID
    // 从本地存储恢复映射关系
    this.loadMappings();
    log.debug('SSH会话管理器初始化完成');
  }

  /**
   * 设置映射关系
   * @param {string} terminalId - 终端ID
   * @param {string} sshSessionId - SSH会话ID
   */
  setMapping(terminalId: string, sshSessionId: string): void {
    this.terminalToSSH.set(terminalId, sshSessionId);
    this.sshToTerminal.set(sshSessionId, terminalId);
    this.saveMappings();

    // 优化：降低日志级别，避免与SSH连接成功日志重复
    log.debug(`[SSH] 建立终端会话映射: ${terminalId} -> ${sshSessionId}`);
  }

  /**
   * 根据SSH会话ID获取终端ID
   * @param {string} sshSessionId - SSH会话ID
   * @returns {string|undefined} - 终端ID
   */
  getTerminalId(sshSessionId: string): string | undefined {
    return this.sshToTerminal.get(sshSessionId);
  }

  /**
   * 根据终端ID获取SSH会话ID
   * @param {string} terminalId - 终端ID
   * @returns {string|undefined} - SSH会话ID
   */
  getSSHSessionId(terminalId: string): string | undefined {
    return this.terminalToSSH.get(terminalId);
  }

  /**
   * 移除映射关系
   * @param {string} terminalId - 终端ID
   * @param {string} sshSessionId - SSH会话ID
   */
  removeMapping(terminalId?: string, sshSessionId?: string): void {
    // 如果只提供了其中一个ID，尝试查找另一个
    if (terminalId && !sshSessionId) {
      sshSessionId = this.terminalToSSH.get(terminalId);
    } else if (!terminalId && sshSessionId) {
      terminalId = this.sshToTerminal.get(sshSessionId);
    }

    // 移除双向映射
    if (terminalId) {
      this.terminalToSSH.delete(terminalId);
    }

    if (sshSessionId) {
      this.sshToTerminal.delete(sshSessionId);
    }

    this.saveMappings();
    log.debug(`已移除会话映射: 终端 ${terminalId} <=> SSH ${sshSessionId}`);
  }

  /**
   * 保存映射到本地存储
   */
  saveMappings(): void {
    try {
      const mappings: Record<string, string> = {};
      for (const [termId, sshId] of this.terminalToSSH.entries()) {
        mappings[termId] = sshId;
      }
      localStorage.setItem('ssh_terminal_mappings', JSON.stringify(mappings));
    } catch (e: unknown) {
      log.warn('保存会话映射失败', e as any);
    }
  }

  /**
   * 从本地存储加载映射
   */
  loadMappings(): void {
    try {
      const saved = localStorage.getItem('ssh_terminal_mappings');
      if (saved) {
        const mappings = JSON.parse(saved) as Record<string, string>;
        for (const [termId, sshId] of Object.entries(mappings) as [string, string][]) {
          this.terminalToSSH.set(termId, sshId);
          this.sshToTerminal.set(sshId, termId);
        }
        log.debug(`已从本地存储加载 ${Object.keys(mappings).length} 个会话映射`);
      }
    } catch (e: unknown) {
      log.warn('加载会话映射失败', e as any);
    }
  }

  /**
   * 清除所有映射
   */
  clearMappings(): void {
    this.terminalToSSH.clear();
    this.sshToTerminal.clear();
    try {
      localStorage.removeItem('ssh_terminal_mappings');
    } catch (e: unknown) {
      log.warn('清除会话映射失败', e as any);
    }
    log.debug('已清除所有会话映射');
  }

  /**
   * 获取所有映射
   * @returns {Array} - 映射数组 [{terminalId, sshSessionId}]
   */
  getAllMappings(): Array<{ terminalId: string; sshSessionId: string }> {
    const mappings: Array<{ terminalId: string; sshSessionId: string }> = [];
    for (const [termId, sshId] of this.terminalToSSH.entries()) {
      mappings.push({
        terminalId: termId,
        sshSessionId: sshId
      });
    }
    return mappings;
  }
}

// 创建单例
const sessionManager = new SSHSessionManager();

export default sessionManager;
