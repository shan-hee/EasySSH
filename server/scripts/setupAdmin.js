/**
 * 初始化管理员用户
 * 用于首次启动时创建默认管理员账户
 */

const User = require('../models/User');
const { connectDatabase } = require('../config/database');

async function setupAdmin() {
  console.log('正在检查管理员用户...');
  
  try {
    // 连接数据库
    connectDatabase();
    
    // 检查是否已存在用户
    const users = await User.find();
    
    if (users.length === 0) {
      console.log('未检测到用户，创建默认管理员账户...');
      
      // 创建管理员用户
      const adminUser = new User({
        username: 'admin',
        email: 'admin@example.com',
        isAdmin: true,
        status: 'active',
        profile: {
          displayName: '系统管理员',
          mfaEnabled: false
        }
      });
      
      // 设置密码
      adminUser.setPassword('admin');
      
      // 保存到数据库
      await adminUser.save();
      
      console.log('默认管理员账户创建成功:');
      console.log('  用户名: admin');
      console.log('  密码: admin');
      console.log('请登录后立即修改默认密码!');
    } else {
      console.log(`系统中已存在${users.length}个用户账户，跳过管理员创建`);
    }
  } catch (error) {
    console.error('创建管理员账户失败:', error);
    process.exit(1);
  }
}

module.exports = setupAdmin;

// 如果直接运行此脚本
if (require.main === module) {
  setupAdmin().then(() => {
    console.log('初始化完成');
    process.exit(0);
  }).catch(err => {
    console.error('初始化失败:', err);
    process.exit(1);
  });
} 