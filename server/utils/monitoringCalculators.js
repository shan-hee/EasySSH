/**
 * 高精度监控数据计算器
 * 提供准确、可靠的系统监控指标计算方法
 * 
 * @author EasySSH Team
 * @version 2.0.0
 * @since 2025-08-01
 */

import logger from './logger.js';

/**
 * CPU使用率计算器
 * 使用多种方法确保准确性
 */
export class CPUCalculator {
  constructor() {
    this.lastCpuStats = null;
    this.lastUpdateTime = 0;
    this.calculationHistory = [];
    this.maxHistorySize = 10;
  }

  /**
   * 计算CPU使用率
   * 使用多种方法并取最可靠的结果
   */
  async calculateCPUUsage(executeCommand) {
    const methods = [
      () => this.calculateUsingVmstat(executeCommand),
      () => this.calculateUsingProcStat(executeCommand),
      () => this.calculateUsingTop(executeCommand),
      () => this.calculateUsingSar(executeCommand)
    ];

    const results = [];
    
    for (const method of methods) {
      try {
        const result = await method();
        if (result !== null && !isNaN(result) && result >= 0 && result <= 100) {
          results.push(result);
        }
      } catch (error) {
        logger.debug('CPU计算方法失败', { error: error.message });
      }
    }

    if (results.length === 0) {
      logger.warn('所有CPU计算方法都失败');
      return 0;
    }

    // 使用中位数作为最终结果，避免异常值影响
    const finalResult = this.calculateMedian(results);
    
    // 记录计算历史
    this.recordCalculation(finalResult, results);
    
    return Math.round(finalResult * 100) / 100;
  }

  /**
   * 使用vmstat计算CPU使用率
   */
  async calculateUsingVmstat(executeCommand) {
    const output = await executeCommand('LANG=C vmstat 1 2 | tail -1');
    const parts = output.trim().split(/\s+/);
    
    if (parts.length >= 15) {
      const idle = parseFloat(parts[14]);
      return 100 - idle;
    }
    
    throw new Error('vmstat输出格式不正确');
  }

  /**
   * 使用/proc/stat计算CPU使用率
   */
  async calculateUsingProcStat(executeCommand) {
    const now = Date.now();
    
    // 获取当前CPU统计
    const output = await executeCommand('cat /proc/stat | head -1');
    const match = output.match(/cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
    
    if (!match) {
      throw new Error('/proc/stat格式不正确');
    }

    const [, user, nice, system, idle, iowait, irq, softirq] = match.map(Number);
    const currentStats = {
      user, nice, system, idle, iowait, irq, softirq,
      total: user + nice + system + idle + iowait + irq + softirq,
      timestamp: now
    };

    // 如果有历史数据，计算差值
    if (this.lastCpuStats && now - this.lastUpdateTime > 500) {
      const totalDiff = currentStats.total - this.lastCpuStats.total;
      const idleDiff = currentStats.idle - this.lastCpuStats.idle;
      
      if (totalDiff > 0) {
        const usage = ((totalDiff - idleDiff) / totalDiff) * 100;
        this.lastCpuStats = currentStats;
        this.lastUpdateTime = now;
        return usage;
      }
    }

    // 保存当前统计用于下次计算
    this.lastCpuStats = currentStats;
    this.lastUpdateTime = now;
    
    // 如果没有历史数据，返回null
    return null;
  }

  /**
   * 使用top命令计算CPU使用率
   */
  async calculateUsingTop(executeCommand) {
    const output = await executeCommand('LANG=C top -bn1 | grep "Cpu(s)"');
    const match = output.match(/(\d+\.?\d*)%?\s*id/);
    
    if (match) {
      const idle = parseFloat(match[1]);
      return 100 - idle;
    }
    
    throw new Error('top输出格式不正确');
  }

  /**
   * 使用sar命令计算CPU使用率
   */
  async calculateUsingSar(executeCommand) {
    const output = await executeCommand('LANG=C sar 1 1 | grep "Average"');
    const parts = output.trim().split(/\s+/);
    
    if (parts.length >= 8) {
      const idle = parseFloat(parts[7]);
      return 100 - idle;
    }
    
    throw new Error('sar输出格式不正确');
  }

  /**
   * 计算中位数
   */
  calculateMedian(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      return sorted[mid];
    }
  }

  /**
   * 记录计算历史
   */
  recordCalculation(finalResult, allResults) {
    this.calculationHistory.push({
      timestamp: Date.now(),
      finalResult,
      allResults,
      variance: this.calculateVariance(allResults)
    });

    // 限制历史记录大小
    if (this.calculationHistory.length > this.maxHistorySize) {
      this.calculationHistory.shift();
    }
  }

  /**
   * 计算方差
   */
  calculateVariance(values) {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * 获取计算统计
   */
  getCalculationStats() {
    if (this.calculationHistory.length === 0) {
      return null;
    }

    const recent = this.calculationHistory.slice(-5);
    const avgVariance = recent.reduce((sum, calc) => sum + calc.variance, 0) / recent.length;
    
    return {
      totalCalculations: this.calculationHistory.length,
      averageVariance: Math.round(avgVariance * 100) / 100,
      lastCalculation: this.calculationHistory[this.calculationHistory.length - 1],
      reliability: avgVariance < 5 ? 'high' : avgVariance < 15 ? 'medium' : 'low'
    };
  }
}

/**
 * 内存计算器
 * 提供准确的内存使用率计算
 */
export class MemoryCalculator {
  /**
   * 解析内存信息
   */
  static parseMemoryInfo(memoryOutput) {
    if (!memoryOutput || memoryOutput.trim() === '') {
      return { total: 0, used: 0, free: 0, cached: 0, usedPercentage: 0 };
    }

    const lines = memoryOutput.split('\n');
    const memLine = lines.find(line => line.startsWith('Mem:'));
    
    if (!memLine) {
      throw new Error('未找到内存信息行');
    }

    const parts = memLine.split(/\s+/);
    if (parts.length < 7) {
      throw new Error('内存信息格式不正确');
    }

    const total = parseInt(parts[1]) || 0;
    const used = parseInt(parts[2]) || 0;
    const free = parseInt(parts[3]) || 0;
    const shared = parseInt(parts[4]) || 0;
    const buffCache = parseInt(parts[5]) || 0;
    const available = parseInt(parts[6]) || 0;

    // 计算实际使用率（排除缓存和缓冲区）
    const actualUsed = used - buffCache;
    const usedPercentage = total > 0 ? (actualUsed / total) * 100 : 0;

    return {
      total,
      used: actualUsed,
      free: available,
      cached: buffCache,
      shared,
      usedPercentage: Math.max(0, Math.min(100, usedPercentage))
    };
  }

  /**
   * 验证内存数据合理性
   */
  static validateMemoryData(memoryData) {
    const { total, used, free, cached } = memoryData;
    
    // 基本合理性检查
    if (total <= 0) {
      throw new Error('内存总量不能为0或负数');
    }
    
    if (used < 0 || free < 0 || cached < 0) {
      throw new Error('内存使用量不能为负数');
    }
    
    // 检查数据一致性
    const sum = used + free;
    const tolerance = total * 0.1; // 10%容差
    
    if (Math.abs(sum - total) > tolerance) {
      logger.warn('内存数据可能不一致', { total, used, free, cached, sum });
    }
    
    return true;
  }
}

/**
 * 磁盘计算器
 * 提供准确的磁盘使用率计算
 */
export class DiskCalculator {
  /**
   * 解析磁盘信息
   */
  static parseDiskInfo(diskOutput) {
    if (!diskOutput || diskOutput.trim() === '') {
      return { total: 0, used: 0, free: 0, usedPercentage: 0 };
    }

    const parts = diskOutput.trim().split(/\s+/);
    if (parts.length < 5) {
      throw new Error('磁盘信息格式不正确');
    }

    // 解析大小，处理不同单位
    const parseSize = (sizeStr) => {
      const match = sizeStr.match(/^(\d+(?:\.\d+)?)(G|M|K|T)?$/i);
      if (!match) return 0;
      
      const value = parseFloat(match[1]);
      const unit = (match[2] || 'G').toUpperCase();
      
      switch (unit) {
        case 'T': return value * 1024;
        case 'G': return value;
        case 'M': return value / 1024;
        case 'K': return value / (1024 * 1024);
        default: return value;
      }
    };

    const total = parseSize(parts[1]);
    const used = parseSize(parts[2]);
    const free = parseSize(parts[3]);
    const usedPercentage = parseFloat(parts[4].replace('%', '')) || 0;

    // 验证数据合理性
    if (total <= 0) {
      throw new Error('磁盘总容量不能为0或负数');
    }

    return {
      total: Math.round(total * 100) / 100,
      used: Math.round(used * 100) / 100,
      free: Math.round(free * 100) / 100,
      usedPercentage: Math.max(0, Math.min(100, usedPercentage))
    };
  }
}

/**
 * 负载平均值计算器
 */
export class LoadAverageCalculator {
  /**
   * 解析负载平均值
   */
  static parseLoadAverage(loadOutput) {
    if (!loadOutput || loadOutput.trim() === '') {
      return { load1: 0, load5: 0, load15: 0 };
    }

    const parts = loadOutput.trim().split(/\s+/);
    if (parts.length < 3) {
      throw new Error('负载平均值格式不正确');
    }

    const load1 = parseFloat(parts[0]) || 0;
    const load5 = parseFloat(parts[1]) || 0;
    const load15 = parseFloat(parts[2]) || 0;

    return {
      load1: Math.round(load1 * 100) / 100,
      load5: Math.round(load5 * 100) / 100,
      load15: Math.round(load15 * 100) / 100
    };
  }

  /**
   * 评估负载状态
   */
  static evaluateLoadStatus(loadAverage, cpuCores) {
    const { load1, load5, load15 } = loadAverage;
    const normalizedLoad1 = load1 / cpuCores;
    
    let status = 'normal';
    let message = '系统负载正常';
    
    if (normalizedLoad1 > 2.0) {
      status = 'critical';
      message = '系统负载过高，可能影响性能';
    } else if (normalizedLoad1 > 1.0) {
      status = 'warning';
      message = '系统负载较高';
    } else if (normalizedLoad1 > 0.7) {
      status = 'moderate';
      message = '系统负载适中';
    }
    
    return {
      status,
      message,
      normalizedLoad: Math.round(normalizedLoad1 * 100) / 100,
      recommendation: this.getLoadRecommendation(normalizedLoad1)
    };
  }

  /**
   * 获取负载建议
   */
  static getLoadRecommendation(normalizedLoad) {
    if (normalizedLoad > 2.0) {
      return '建议检查系统进程，考虑增加CPU资源或优化应用';
    } else if (normalizedLoad > 1.0) {
      return '建议监控系统性能，必要时优化资源使用';
    } else {
      return '系统运行良好';
    }
  }
}

/**
 * 进程计算器
 */
export class ProcessCalculator {
  /**
   * 解析进程信息
   */
  static parseProcessInfo(totalResult, runningResult, sleepingResult, zombieResult) {
    const total = Math.max(0, (parseInt(totalResult) || 1) - 1); // 减去标题行
    const running = Math.max(0, parseInt(runningResult) || 0);
    const sleeping = Math.max(0, parseInt(sleepingResult) || 0);
    const zombie = Math.max(0, parseInt(zombieResult) || 0);

    // 计算其他状态的进程
    const accounted = running + sleeping + zombie;
    const other = Math.max(0, total - accounted);

    return {
      total,
      running,
      sleeping,
      zombie,
      other,
      runningPercentage: total > 0 ? (running / total) * 100 : 0,
      zombiePercentage: total > 0 ? (zombie / total) * 100 : 0
    };
  }

  /**
   * 评估进程状态
   */
  static evaluateProcessStatus(processInfo) {
    const { total, running, zombie, zombiePercentage } = processInfo;
    
    let status = 'normal';
    let warnings = [];
    
    // 检查僵尸进程
    if (zombie > 10 || zombiePercentage > 5) {
      status = 'warning';
      warnings.push(`检测到${zombie}个僵尸进程，建议检查系统状态`);
    }
    
    // 检查运行进程数
    if (running > total * 0.1) {
      status = 'warning';
      warnings.push('运行中进程数量较多，系统可能负载较高');
    }
    
    // 检查总进程数
    if (total > 1000) {
      warnings.push('系统进程数量较多，建议监控资源使用');
    }
    
    return {
      status,
      warnings,
      recommendation: warnings.length > 0 ? warnings.join('; ') : '进程状态正常'
    };
  }
}

// 创建单例实例
export const cpuCalculator = new CPUCalculator();

export default {
  CPUCalculator,
  MemoryCalculator,
  DiskCalculator,
  LoadAverageCalculator,
  ProcessCalculator,
  cpuCalculator
};
