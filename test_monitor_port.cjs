/**
 * 测试监控端口9527相关脚本
 * 验证端口配置是否正确
 */

const { connectDatabase } = require('./server/config/database');

async function testMonitorPort() {
  try {
    // 连接数据库
    connectDatabase();
    const db = require('./server/config/database').getDb();
    
    console.log('开始测试监控端口9527相关脚本...\n');
    
    // 查询所有EasySSH监控脚本
    const monitorScripts = db.prepare(
      "SELECT * FROM scripts WHERE category = 'EasySSH监控' ORDER BY name"
    ).all();
    
    console.log(`找到 ${monitorScripts.length} 个EasySSH监控脚本:\n`);
    
    // 检查每个脚本中的端口配置
    monitorScripts.forEach((script, index) => {
      console.log(`${index + 1}. ${script.name}`);
      console.log(`   描述: ${script.description}`);
      
      // 检查是否包含端口9527
      const hasPort9527 = script.command.includes('9527') || script.description.includes('9527');
      if (hasPort9527) {
        console.log(`   ✅ 包含端口9527配置`);
      } else if (script.name.includes('安装') || script.name.includes('卸载') || script.name.includes('重启') || script.name.includes('日志')) {
        console.log(`   ⚪ 不需要端口配置（${script.name.includes('安装') ? '安装' : script.name.includes('卸载') ? '卸载' : script.name.includes('重启') ? '重启' : '日志'}脚本）`);
      } else {
        console.log(`   ❌ 缺少端口9527配置`);
      }
      
      // 检查特定脚本的命令内容
      if (script.name === '检查EasySSH监控服务状态') {
        if (script.command.includes('netstat -tulpn | grep :9527')) {
          console.log(`   ✅ 状态检查包含端口9527监听检测`);
        } else {
          console.log(`   ❌ 状态检查缺少端口9527监听检测`);
        }
      }
      
      if (script.name === '测试EasySSH监控端口连接') {
        if (script.command.includes('localhost:9527')) {
          console.log(`   ✅ 端口测试使用正确的9527端口`);
        } else {
          console.log(`   ❌ 端口测试未使用9527端口`);
        }
        
        if (script.command.includes('/health')) {
          console.log(`   ✅ 包含健康检查端点`);
        } else {
          console.log(`   ❌ 缺少健康检查端点`);
        }
      }
      
      console.log('');
    });
    
    console.log('='.repeat(60));
    console.log('端口9527相关脚本汇总:');
    console.log('='.repeat(60));
    
    // 统计包含端口9527的脚本
    const port9527Scripts = monitorScripts.filter(script => 
      script.command.includes('9527') || script.description.includes('9527')
    );
    
    console.log(`包含端口9527配置的脚本数量: ${port9527Scripts.length}`);
    port9527Scripts.forEach(script => {
      console.log(`  - ${script.name}`);
    });
    
    console.log('\n专门的端口测试脚本:');
    const portTestScript = monitorScripts.find(script => 
      script.name.includes('端口') && script.name.includes('测试')
    );
    
    if (portTestScript) {
      console.log(`✅ 找到端口测试脚本: ${portTestScript.name}`);
      console.log(`   完整命令: ${portTestScript.command}`);
    } else {
      console.log('❌ 未找到专门的端口测试脚本');
    }
    
    console.log('\n状态检查脚本端口配置:');
    const statusScript = monitorScripts.find(script => 
      script.name.includes('状态')
    );
    
    if (statusScript) {
      console.log(`✅ 找到状态检查脚本: ${statusScript.name}`);
      if (statusScript.command.includes(':9527')) {
        console.log(`   ✅ 正确配置端口9527检查`);
      } else {
        console.log(`   ❌ 未配置端口9527检查`);
      }
    } else {
      console.log('❌ 未找到状态检查脚本');
    }
    
    console.log('\n安装脚本服务器地址:');
    const installScript = monitorScripts.find(script => 
      script.name.includes('安装')
    );
    
    if (installScript) {
      console.log(`✅ 找到安装脚本: ${installScript.name}`);
      
      // 提取服务器地址
      const serverMatch = installScript.command.match(/EASYSSH_SERVER=([^\s]+)/);
      if (serverMatch) {
        console.log(`   ✅ 检测到服务器地址: ${serverMatch[1]}`);
        console.log(`   ℹ️  注意: 监控服务将在端口9527上运行`);
      } else {
        console.log(`   ❌ 未找到服务器地址配置`);
      }
    } else {
      console.log('❌ 未找到安装脚本');
    }
    
    console.log('\n🎉 监控端口9527配置检查完成！');
    
  } catch (error) {
    console.error('❌ 测试过程中发生错误:', error);
  }
}

// 运行测试
if (require.main === module) {
  testMonitorPort()
    .then(() => {
      console.log('\n🎉 测试完成！');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 测试失败:', error);
      process.exit(1);
    });
}

module.exports = { testMonitorPort };
