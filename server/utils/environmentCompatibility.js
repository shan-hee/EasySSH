/**
 * 环境兼容性工具
 * 解决多语言环境、不同发行版、不同架构的兼容性问题
 * 
 * @author EasySSH Team
 * @version 2.0.0
 * @since 2025-08-01
 */

import logger from './logger.js';

/**
 * 环境兼容性管理器
 */
export class EnvironmentCompatibility {
  constructor() {
    this.detectedEnvironment = null;
    this.commandVariants = new Map();
    this.initializeCommandVariants();
  }

  /**
   * 初始化命令变体
   */
  initializeCommandVariants() {
    // CPU信息获取命令变体
    this.commandVariants.set('cpuUsage', [
      'LANG=C vmstat 1 2 | tail -1 | awk \'{print 100 - $15}\'',
      'LANG=C iostat -c 1 2 | tail -1 | awk \'{print 100 - $6}\'',
      'LANG=C top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk \'{print 100 - $1}\'',
      'LANG=C sar 1 1 | grep "Average" | awk \'{print 100 - $8}\''
    ]);

    // 内存信息获取命令变体
    this.commandVariants.set('memoryInfo', [
      'LANG=C free -m',
      'LANG=C cat /proc/meminfo',
      'LANG=en_US.UTF-8 free -m'
    ]);

    // 磁盘信息获取命令变体
    this.commandVariants.set('diskInfo', [
      'LANG=C df -BG /',
      'LANG=C df -h /',
      'LANG=en_US.UTF-8 df -BG /'
    ]);

    // 进程信息获取命令变体
    this.commandVariants.set('processInfo', [
      'ps aux | wc -l',
      'ps -ef | wc -l',
      'LANG=C ps aux | wc -l'
    ]);

    // 系统信息获取命令变体
    this.commandVariants.set('osRelease', [
      'cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'',
      'lsb_release -d | cut -d: -f2 | sed "s/^\\s*//"',
      'cat /etc/redhat-release',
      'cat /etc/debian_version',
      'uname -o'
    ]);

    // 网络接口检测命令变体
    this.commandVariants.set('networkInterface', [
      'ip route | grep default | awk \'{print $5}\' | head -1',
      'route | grep default | awk \'{print $8}\' | head -1',
      'netstat -rn | grep "^0.0.0.0" | awk \'{print $8}\' | head -1'
    ]);
  }

  /**
   * 检测系统环境
   */
  async detectEnvironment(executeCommand) {
    if (this.detectedEnvironment) {
      return this.detectedEnvironment;
    }

    try {
      const [osInfo, architecture, shell, locale] = await Promise.allSettled([
        this.detectOperatingSystem(executeCommand),
        this.detectArchitecture(executeCommand),
        this.detectShell(executeCommand),
        this.detectLocale(executeCommand)
      ]);

      this.detectedEnvironment = {
        os: this.getSettledValue(osInfo, { type: 'unknown', version: 'unknown' }),
        architecture: this.getSettledValue(architecture, 'unknown'),
        shell: this.getSettledValue(shell, 'unknown'),
        locale: this.getSettledValue(locale, 'unknown'),
        detectedAt: Date.now()
      };

      logger.info('系统环境检测完成', { environment: this.detectedEnvironment });
      return this.detectedEnvironment;
    } catch (error) {
      logger.error('系统环境检测失败', { error: error.message });
      return {
        os: { type: 'unknown', version: 'unknown' },
        architecture: 'unknown',
        shell: 'unknown',
        locale: 'unknown',
        detectedAt: Date.now()
      };
    }
  }

  /**
   * 检测操作系统
   */
  async detectOperatingSystem(executeCommand) {
    const commands = this.commandVariants.get('osRelease');
    
    for (const command of commands) {
      try {
        const result = await executeCommand(command);
        if (result && result.trim()) {
          return this.parseOSInfo(result.trim());
        }
      } catch (error) {
        continue; // 尝试下一个命令
      }
    }

    // 如果所有命令都失败，尝试基本的uname
    try {
      const unameResult = await executeCommand('uname -s');
      return { type: unameResult.trim(), version: 'unknown' };
    } catch (error) {
      return { type: 'unknown', version: 'unknown' };
    }
  }

  /**
   * 解析操作系统信息
   */
  parseOSInfo(osString) {
    const lowerOS = osString.toLowerCase();
    
    if (lowerOS.includes('ubuntu')) {
      const version = osString.match(/(\d+\.\d+)/)?.[1] || 'unknown';
      return { type: 'Ubuntu', version, family: 'debian' };
    } else if (lowerOS.includes('debian')) {
      const version = osString.match(/(\d+)/)?.[1] || 'unknown';
      return { type: 'Debian', version, family: 'debian' };
    } else if (lowerOS.includes('centos')) {
      const version = osString.match(/(\d+)/)?.[1] || 'unknown';
      return { type: 'CentOS', version, family: 'rhel' };
    } else if (lowerOS.includes('red hat') || lowerOS.includes('rhel')) {
      const version = osString.match(/(\d+)/)?.[1] || 'unknown';
      return { type: 'RHEL', version, family: 'rhel' };
    } else if (lowerOS.includes('fedora')) {
      const version = osString.match(/(\d+)/)?.[1] || 'unknown';
      return { type: 'Fedora', version, family: 'rhel' };
    } else if (lowerOS.includes('alpine')) {
      const version = osString.match(/(\d+\.\d+)/)?.[1] || 'unknown';
      return { type: 'Alpine', version, family: 'alpine' };
    } else if (lowerOS.includes('arch')) {
      return { type: 'Arch', version: 'rolling', family: 'arch' };
    } else {
      return { type: osString, version: 'unknown', family: 'unknown' };
    }
  }

  /**
   * 检测系统架构
   */
  async detectArchitecture(executeCommand) {
    try {
      const arch = await executeCommand('uname -m');
      return arch.trim();
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * 检测Shell类型
   */
  async detectShell(executeCommand) {
    try {
      const shell = await executeCommand('echo $SHELL');
      return shell.trim().split('/').pop() || 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * 检测系统Locale
   */
  async detectLocale(executeCommand) {
    try {
      const locale = await executeCommand('echo $LANG');
      return locale.trim() || 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * 获取兼容的命令
   */
  async getCompatibleCommand(commandType, executeCommand) {
    const variants = this.commandVariants.get(commandType);
    if (!variants) {
      throw new Error(`未知的命令类型: ${commandType}`);
    }

    // 如果环境未检测，先检测环境
    if (!this.detectedEnvironment) {
      await this.detectEnvironment(executeCommand);
    }

    // 根据环境选择最适合的命令
    const prioritizedCommands = this.prioritizeCommands(variants, this.detectedEnvironment);

    for (const command of prioritizedCommands) {
      try {
        const result = await executeCommand(command);
        if (result !== null && result !== undefined) {
          logger.debug('找到兼容命令', { commandType, command });
          return { command, result };
        }
      } catch (error) {
        logger.debug('命令执行失败，尝试下一个', { 
          commandType, 
          command, 
          error: error.message 
        });
        continue;
      }
    }

    throw new Error(`所有${commandType}命令变体都执行失败`);
  }

  /**
   * 根据环境优先排序命令
   */
  prioritizeCommands(commands, environment) {
    const prioritized = [...commands];
    
    // 根据操作系统家族调整优先级
    if (environment.os.family === 'debian') {
      // Debian系统优先使用某些命令
      prioritized.sort((a, b) => {
        if (a.includes('apt') || a.includes('dpkg')) return -1;
        if (b.includes('apt') || b.includes('dpkg')) return 1;
        return 0;
      });
    } else if (environment.os.family === 'rhel') {
      // RHEL系统优先使用某些命令
      prioritized.sort((a, b) => {
        if (a.includes('yum') || a.includes('rpm')) return -1;
        if (b.includes('yum') || b.includes('rpm')) return 1;
        return 0;
      });
    }

    return prioritized;
  }

  /**
   * 获取Promise.allSettled的值
   */
  getSettledValue(settledResult, defaultValue = null) {
    return settledResult.status === 'fulfilled' ? settledResult.value : defaultValue;
  }

  /**
   * 重置环境检测缓存
   */
  resetEnvironmentCache() {
    this.detectedEnvironment = null;
    logger.info('环境检测缓存已重置');
  }

  /**
   * 获取环境信息
   */
  getEnvironmentInfo() {
    return this.detectedEnvironment;
  }

  /**
   * 检查命令是否可用
   */
  async isCommandAvailable(command, executeCommand) {
    try {
      await executeCommand(`which ${command.split(' ')[0]} > /dev/null 2>&1`);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取系统特定的配置
   */
  getSystemSpecificConfig(environment = this.detectedEnvironment) {
    if (!environment) return {};

    const config = {
      timeoutMultiplier: 1,
      retryAttempts: 3,
      preferredCommands: []
    };

    // 根据系统类型调整配置
    switch (environment.os.family) {
      case 'alpine':
        config.timeoutMultiplier = 1.5; // Alpine系统可能较慢
        config.preferredCommands = ['busybox'];
        break;
      case 'debian':
        config.preferredCommands = ['systemctl', 'service'];
        break;
      case 'rhel':
        config.preferredCommands = ['systemctl', 'chkconfig'];
        break;
    }

    // 根据架构调整配置
    if (environment.architecture === 'armv7l' || environment.architecture === 'aarch64') {
      config.timeoutMultiplier = 2; // ARM设备可能较慢
    }

    return config;
  }
}

// 创建单例实例
export const environmentCompatibility = new EnvironmentCompatibility();

export default environmentCompatibility;
