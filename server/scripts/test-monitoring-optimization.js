#!/usr/bin/env node
/**
 * EasySSH监控系统优化效果测试脚本
 * 测试流式采集、传输优化和指标准确性
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class MonitoringOptimizationTester {
  constructor() {
    this.testResults = {
      streamingCollection: { passed: false, metrics: {} },
      dataAccuracy: { passed: false, metrics: {} },
      performance: { passed: false, metrics: {} },
      compression: { passed: false, metrics: {} }
    };
  }

  /**
   * 运行所有测试
   */
  async runAllTests() {
    console.log('🚀 开始EasySSH监控系统优化效果测试\n');

    try {
      await this.testStreamingCollection();
      await this.testDataAccuracy();
      await this.testPerformance();
      await this.testCompression();

      this.printSummary();
    } catch (error) {
      console.error('❌ 测试执行失败:', error.message);
      process.exit(1);
    }
  }

  /**
   * 测试流式采集功能
   */
  async testStreamingCollection() {
    console.log('📡 测试1: 流式采集功能');

    const scriptPath = path.join(__dirname, 'streaming-monitor.sh');
    
    // 检查脚本是否存在
    if (!fs.existsSync(scriptPath)) {
      throw new Error('流式监控脚本不存在: ' + scriptPath);
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let messageCount = 0;
      let firstMessageTime = 0;
      let lastMessageTime = 0;
      let buffer = '';

      const child = spawn('bash', [scriptPath, '1', '0'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      child.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() && !line.startsWith('#')) {
            try {
              const parsed = JSON.parse(line);
              messageCount++;
              
              if (messageCount === 1) {
                firstMessageTime = Date.now();
              }
              lastMessageTime = Date.now();

              // 验证数据结构
              this.validateDataStructure(parsed);
            } catch (error) {
              console.log('   ⚠️  JSON解析失败:', line.substring(0, 100));
            }
          }
        }
      });

      child.stderr.on('data', (data) => {
        const errorMsg = data.toString().trim();
        if (errorMsg && !errorMsg.includes('warning')) {
          console.log('   ⚠️  stderr:', errorMsg);
        }
      });

      // 5秒后停止测试
      setTimeout(() => {
        child.kill('SIGTERM');
        
        const totalTime = lastMessageTime - firstMessageTime;
        const avgInterval = totalTime / Math.max(1, messageCount - 1);

        this.testResults.streamingCollection = {
          passed: messageCount >= 4, // 至少收到4条消息
          metrics: {
            messageCount,
            avgInterval: Math.round(avgInterval),
            firstMessageLatency: firstMessageTime - startTime,
            totalTestTime: Date.now() - startTime
          }
        };

        console.log(`   ✅ 收到 ${messageCount} 条消息`);
        console.log(`   ✅ 平均间隔: ${Math.round(avgInterval)}ms`);
        console.log(`   ✅ 首条消息延迟: ${firstMessageTime - startTime}ms\n`);

        resolve();
      }, 5000);

      child.on('error', reject);
    });
  }

  /**
   * 验证数据结构
   */
  validateDataStructure(data) {
    const requiredFields = [
      'timestamp', 'cpu', 'memory', 'disk', 'network', 'os'
    ];

    for (const field of requiredFields) {
      if (!(field in data)) {
        throw new Error(`缺少必需字段: ${field}`);
      }
    }

    // 验证CPU数据
    if (!data.cpu.usage !== undefined || !data.cpu.cores) {
      throw new Error('CPU数据格式错误');
    }

    // 验证内存数据
    if (!data.memory.total || !data.memory.used !== undefined) {
      throw new Error('内存数据格式错误');
    }

    // 验证网络数据
    if (!data.network.interface || data.network.total_rx_speed === undefined) {
      throw new Error('网络数据格式错误');
    }
  }

  /**
   * 测试数据准确性
   */
  async testDataAccuracy() {
    console.log('🎯 测试2: 数据准确性');

    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'streaming-monitor.sh');
      let samples = [];
      let buffer = '';

      const child = spawn('bash', [scriptPath, '1', '0'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      child.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() && !line.startsWith('#')) {
            try {
              const parsed = JSON.parse(line);
              samples.push(parsed);
            } catch (error) {
              // 忽略解析错误
            }
          }
        }
      });

      // 3秒后分析数据
      setTimeout(() => {
        child.kill('SIGTERM');

        if (samples.length < 2) {
          reject(new Error('样本数据不足'));
          return;
        }

        // 分析CPU使用率变化
        const cpuUsages = samples.map(s => s.cpu.usage);
        const cpuVariance = this.calculateVariance(cpuUsages);

        // 分析网络速率
        const networkSpeeds = samples.slice(1).map(s => s.network.total_rx_speed + s.network.total_tx_speed);
        const avgNetworkSpeed = networkSpeeds.reduce((a, b) => a + b, 0) / networkSpeeds.length;

        // 验证时间戳连续性
        const timestampDiffs = [];
        for (let i = 1; i < samples.length; i++) {
          timestampDiffs.push(samples[i].timestamp - samples[i-1].timestamp);
        }
        const avgTimestampDiff = timestampDiffs.reduce((a, b) => a + b, 0) / timestampDiffs.length;

        this.testResults.dataAccuracy = {
          passed: Math.abs(avgTimestampDiff - 1000) < 200, // 时间戳差值应接近1000ms
          metrics: {
            sampleCount: samples.length,
            cpuVariance: Math.round(cpuVariance * 100) / 100,
            avgNetworkSpeed: Math.round(avgNetworkSpeed),
            avgTimestampDiff: Math.round(avgTimestampDiff),
            timestampAccuracy: Math.abs(avgTimestampDiff - 1000) < 200
          }
        };

        console.log(`   ✅ 样本数量: ${samples.length}`);
        console.log(`   ✅ CPU使用率方差: ${Math.round(cpuVariance * 100) / 100}%`);
        console.log(`   ✅ 平均网络速度: ${Math.round(avgNetworkSpeed)} B/s`);
        console.log(`   ✅ 时间戳精度: ${Math.round(avgTimestampDiff)}ms (目标: 1000ms)\n`);

        resolve();
      }, 3000);

      child.on('error', reject);
    });
  }

  /**
   * 测试性能表现
   */
  async testPerformance() {
    console.log('⚡ 测试3: 性能表现');

    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'streaming-monitor.sh');
      let messageCount = 0;
      let totalDataSize = 0;
      let buffer = '';

      const child = spawn('bash', [scriptPath, '1', '0'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      child.stdout.on('data', (data) => {
        const dataStr = data.toString();
        buffer += dataStr;
        totalDataSize += Buffer.byteLength(dataStr, 'utf8');

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        messageCount += lines.filter(line => line.trim() && !line.startsWith('#')).length;
      });

      // 5秒后分析性能
      setTimeout(() => {
        child.kill('SIGTERM');

        const endTime = Date.now();
        const endMemory = process.memoryUsage();
        const duration = endTime - startTime;

        const messagesPerSecond = messageCount / (duration / 1000);
        const bytesPerSecond = totalDataSize / (duration / 1000);
        const memoryIncrease = endMemory.rss - startMemory.rss;

        this.testResults.performance = {
          passed: messagesPerSecond >= 0.8, // 至少0.8条消息/秒
          metrics: {
            duration,
            messageCount,
            messagesPerSecond: Math.round(messagesPerSecond * 100) / 100,
            totalDataSize,
            bytesPerSecond: Math.round(bytesPerSecond),
            memoryIncrease: Math.round(memoryIncrease / 1024) // KB
          }
        };

        console.log(`   ✅ 测试时长: ${duration}ms`);
        console.log(`   ✅ 消息数量: ${messageCount}`);
        console.log(`   ✅ 消息速率: ${Math.round(messagesPerSecond * 100) / 100} msg/s`);
        console.log(`   ✅ 数据速率: ${Math.round(bytesPerSecond)} B/s`);
        console.log(`   ✅ 内存增长: ${Math.round(memoryIncrease / 1024)} KB\n`);

        resolve();
      }, 5000);

      child.on('error', reject);
    });
  }

  /**
   * 测试压缩效果
   */
  async testCompression() {
    console.log('🗜️  测试4: 数据压缩效果');

    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'streaming-monitor.sh');
      let rawData = '';
      let buffer = '';

      const child = spawn('bash', [scriptPath, '1', '0'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      child.stdout.on('data', (data) => {
        const dataStr = data.toString();
        buffer += dataStr;
        rawData += dataStr;
      });

      // 3秒后分析压缩效果
      setTimeout(() => {
        child.kill('SIGTERM');

        const rawSize = Buffer.byteLength(rawData, 'utf8');
        
        // 模拟gzip压缩
        const zlib = require('zlib');
        const compressed = zlib.gzipSync(rawData);
        const compressedSize = compressed.length;
        const compressionRatio = (rawSize - compressedSize) / rawSize;

        this.testResults.compression = {
          passed: compressionRatio > 0.3, // 压缩率应超过30%
          metrics: {
            rawSize,
            compressedSize,
            compressionRatio: Math.round(compressionRatio * 1000) / 10, // 百分比
            spaceSaved: rawSize - compressedSize
          }
        };

        console.log(`   ✅ 原始大小: ${rawSize} bytes`);
        console.log(`   ✅ 压缩大小: ${compressedSize} bytes`);
        console.log(`   ✅ 压缩率: ${Math.round(compressionRatio * 1000) / 10}%`);
        console.log(`   ✅ 节省空间: ${rawSize - compressedSize} bytes\n`);

        resolve();
      }, 3000);

      child.on('error', reject);
    });
  }

  /**
   * 计算方差
   */
  calculateVariance(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * 打印测试总结
   */
  printSummary() {
    console.log('📊 测试总结报告');
    console.log('=' * 50);

    const tests = [
      { name: '流式采集功能', key: 'streamingCollection' },
      { name: '数据准确性', key: 'dataAccuracy' },
      { name: '性能表现', key: 'performance' },
      { name: '数据压缩效果', key: 'compression' }
    ];

    let passedCount = 0;
    for (const test of tests) {
      const result = this.testResults[test.key];
      const status = result.passed ? '✅ 通过' : '❌ 失败';
      console.log(`${test.name}: ${status}`);
      if (result.passed) passedCount++;
    }

    console.log('\n🎯 优化效果评估:');
    
    // 性能提升评估
    const perfMetrics = this.testResults.performance.metrics;
    if (perfMetrics.messagesPerSecond >= 1.0) {
      console.log('   ✅ 消息处理性能: 优秀 (≥1.0 msg/s)');
    } else if (perfMetrics.messagesPerSecond >= 0.8) {
      console.log('   ✅ 消息处理性能: 良好 (≥0.8 msg/s)');
    } else {
      console.log('   ⚠️  消息处理性能: 需要改进 (<0.8 msg/s)');
    }

    // 压缩效果评估
    const compMetrics = this.testResults.compression.metrics;
    if (compMetrics.compressionRatio >= 50) {
      console.log('   ✅ 数据压缩效果: 优秀 (≥50%)');
    } else if (compMetrics.compressionRatio >= 30) {
      console.log('   ✅ 数据压缩效果: 良好 (≥30%)');
    } else {
      console.log('   ⚠️  数据压缩效果: 需要改进 (<30%)');
    }

    // 数据准确性评估
    const accMetrics = this.testResults.dataAccuracy.metrics;
    if (accMetrics.timestampAccuracy) {
      console.log('   ✅ 时间戳精度: 优秀 (±200ms)');
    } else {
      console.log('   ⚠️  时间戳精度: 需要改进 (>±200ms)');
    }

    console.log(`\n🏆 总体评分: ${passedCount}/${tests.length} (${Math.round(passedCount/tests.length*100)}%)`);

    if (passedCount === tests.length) {
      console.log('🎉 恭喜！所有优化测试均通过，系统性能显著提升！');
    } else {
      console.log('⚠️  部分测试未通过，建议进一步优化相关功能。');
    }
  }
}

// 运行测试
if (require.main === module) {
  const tester = new MonitoringOptimizationTester();
  tester.runAllTests().catch(console.error);
}

module.exports = MonitoringOptimizationTester;
