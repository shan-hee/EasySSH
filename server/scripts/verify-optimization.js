#!/usr/bin/env node
/**
 * EasySSH监控系统优化验证脚本
 * 快速验证所有优化组件是否正常工作
 */

const fs = require('fs');
const path = require('path');

class OptimizationVerifier {
  constructor() {
    this.results = {
      files: [],
      dependencies: [],
      configurations: [],
      overall: false
    };
  }

  /**
   * 运行所有验证
   */
  async runVerification() {
    console.log('🔍 EasySSH监控系统优化验证\n');

    try {
      this.verifyFiles();
      this.verifyDependencies();
      this.verifyConfigurations();
      this.printResults();
    } catch (error) {
      console.error('❌ 验证过程失败:', error.message);
      process.exit(1);
    }
  }

  /**
   * 验证关键文件
   */
  verifyFiles() {
    console.log('📁 验证关键文件...');

    const requiredFiles = [
      {
        path: 'server/scripts/streaming-monitor.sh',
        description: '流式监控采集脚本',
        executable: true
      },
      {
        path: 'server/services/streamingSSHMonitoringCollector.js',
        description: '流式SSH监控收集器'
      },
      {
        path: 'server/services/enhancedDataTransport.js',
        description: '增强版数据传输服务'
      },
      {
        path: 'server/scripts/test-monitoring-optimization.js',
        description: '监控优化测试脚本',
        executable: true
      },
      {
        path: 'EasySSH监控系统P0优化实施报告.md',
        description: '优化实施报告'
      }
    ];

    for (const file of requiredFiles) {
      const fullPath = path.resolve(file.path);
      const exists = fs.existsSync(fullPath);
      
      let status = exists ? '✅' : '❌';
      let details = exists ? '存在' : '缺失';

      if (exists && file.executable) {
        try {
          const stats = fs.statSync(fullPath);
          const isExecutable = !!(stats.mode & parseInt('111', 8));
          if (!isExecutable) {
            status = '⚠️';
            details = '存在但不可执行';
          }
        } catch (error) {
          status = '⚠️';
          details = '权限检查失败';
        }
      }

      console.log(`   ${status} ${file.description}: ${details}`);
      
      this.results.files.push({
        path: file.path,
        description: file.description,
        exists,
        status: status === '✅'
      });
    }

    console.log();
  }

  /**
   * 验证依赖包
   */
  verifyDependencies() {
    console.log('📦 验证依赖包...');

    const requiredDependencies = [
      {
        name: 'msgpack5',
        description: 'MessagePack二进制编码库',
        path: 'server/node_modules/msgpack5'
      },
      {
        name: 'ws',
        description: 'WebSocket库',
        path: 'server/node_modules/ws'
      }
    ];

    for (const dep of requiredDependencies) {
      const exists = fs.existsSync(dep.path);
      const status = exists ? '✅' : '❌';
      const details = exists ? '已安装' : '未安装';

      console.log(`   ${status} ${dep.description} (${dep.name}): ${details}`);

      this.results.dependencies.push({
        name: dep.name,
        description: dep.description,
        exists,
        status: exists
      });
    }

    console.log();
  }

  /**
   * 验证配置文件
   */
  verifyConfigurations() {
    console.log('⚙️  验证配置文件...');

    try {
      // 验证监控配置
      const monitoringConfigPath = path.resolve('server/config/monitoring.js');
      if (fs.existsSync(monitoringConfigPath)) {
        const config = require(monitoringConfigPath);
        
        // 检查流式采集配置
        const hasStreamingConfig = config.collector && config.collector.streaming;
        console.log(`   ${hasStreamingConfig ? '✅' : '❌'} 流式采集配置: ${hasStreamingConfig ? '已配置' : '缺失'}`);

        // 检查传输优化配置
        const hasTransportConfig = config.transport && config.transport.ws;
        console.log(`   ${hasTransportConfig ? '✅' : '❌'} 传输优化配置: ${hasTransportConfig ? '已配置' : '缺失'}`);

        // 检查差量更新配置
        const hasDeltaConfig = config.transport && config.transport.delta;
        console.log(`   ${hasDeltaConfig ? '✅' : '❌'} 差量更新配置: ${hasDeltaConfig ? '已配置' : '缺失'}`);

        this.results.configurations.push({
          name: '监控配置',
          streaming: hasStreamingConfig,
          transport: hasTransportConfig,
          delta: hasDeltaConfig,
          overall: hasStreamingConfig && hasTransportConfig && hasDeltaConfig
        });
      } else {
        console.log('   ❌ 监控配置文件: 不存在');
        this.results.configurations.push({
          name: '监控配置',
          overall: false
        });
      }

      // 验证监控服务配置
      const monitoringIndexPath = path.resolve('server/monitoring/index.js');
      if (fs.existsSync(monitoringIndexPath)) {
        const content = fs.readFileSync(monitoringIndexPath, 'utf8');
        
        const hasEnhancedTransport = content.includes('EnhancedDataTransport');
        console.log(`   ${hasEnhancedTransport ? '✅' : '❌'} 增强传输集成: ${hasEnhancedTransport ? '已集成' : '未集成'}`);

        const hasPerMessageDeflate = content.includes('perMessageDeflate');
        console.log(`   ${hasPerMessageDeflate ? '✅' : '❌'} WebSocket压缩: ${hasPerMessageDeflate ? '已启用' : '未启用'}`);

        this.results.configurations.push({
          name: '监控服务',
          enhancedTransport: hasEnhancedTransport,
          compression: hasPerMessageDeflate,
          overall: hasEnhancedTransport && hasPerMessageDeflate
        });
      } else {
        console.log('   ❌ 监控服务文件: 不存在');
        this.results.configurations.push({
          name: '监控服务',
          overall: false
        });
      }

    } catch (error) {
      console.log(`   ❌ 配置验证失败: ${error.message}`);
      this.results.configurations.push({
        name: '配置验证',
        overall: false,
        error: error.message
      });
    }

    console.log();
  }

  /**
   * 打印验证结果
   */
  printResults() {
    console.log('📊 验证结果总结');
    console.log('=' * 50);

    // 文件验证结果
    const filesPassed = this.results.files.filter(f => f.status).length;
    const filesTotal = this.results.files.length;
    console.log(`📁 关键文件: ${filesPassed}/${filesTotal} 通过`);

    // 依赖验证结果
    const depsPassed = this.results.dependencies.filter(d => d.status).length;
    const depsTotal = this.results.dependencies.length;
    console.log(`📦 依赖包: ${depsPassed}/${depsTotal} 通过`);

    // 配置验证结果
    const configsPassed = this.results.configurations.filter(c => c.overall).length;
    const configsTotal = this.results.configurations.length;
    console.log(`⚙️  配置文件: ${configsPassed}/${configsTotal} 通过`);

    // 总体评估
    const totalPassed = filesPassed + depsPassed + configsPassed;
    const totalItems = filesTotal + depsTotal + configsTotal;
    const passRate = Math.round((totalPassed / totalItems) * 100);

    console.log(`\n🏆 总体通过率: ${totalPassed}/${totalItems} (${passRate}%)`);

    if (passRate >= 90) {
      console.log('🎉 优秀！系统优化已成功实施，所有组件运行正常。');
      this.results.overall = true;
    } else if (passRate >= 70) {
      console.log('⚠️  良好！大部分组件正常，建议检查未通过的项目。');
    } else {
      console.log('❌ 需要改进！多个组件存在问题，请检查并修复。');
    }

    // 详细建议
    console.log('\n💡 建议事项:');
    
    if (filesPassed < filesTotal) {
      console.log('   • 检查缺失的关键文件，确保所有组件都已正确部署');
    }
    
    if (depsPassed < depsTotal) {
      console.log('   • 运行 "npm install" 安装缺失的依赖包');
    }
    
    if (configsPassed < configsTotal) {
      console.log('   • 检查配置文件，确保所有优化选项都已启用');
    }

    if (this.results.overall) {
      console.log('   • 可以运行 "node server/scripts/test-monitoring-optimization.js" 进行完整测试');
      console.log('   • 建议启动服务器并测试监控功能');
    }

    console.log('\n📋 验证完成！');
  }

  /**
   * 获取验证结果
   */
  getResults() {
    return this.results;
  }
}

// 运行验证
if (require.main === module) {
  const verifier = new OptimizationVerifier();
  verifier.runVerification().catch(console.error);
}

module.exports = OptimizationVerifier;
