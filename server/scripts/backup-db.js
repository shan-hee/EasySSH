#!/usr/bin/env node

/**
 * 数据库备份脚本
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function backupDatabase() {
  const dbPath = process.env.SQLITE_PATH || './data/easyssh.sqlite';
  const backupDir = './data/backups';
  
  // 确保备份目录存在
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  // 检查数据库文件是否存在
  if (!fs.existsSync(dbPath)) {
    log(`❌ 数据库文件不存在: ${dbPath}`, 'red');
    process.exit(1);
  }
  
  // 生成备份文件名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `easyssh-backup-${timestamp}.sqlite`;
  const backupPath = path.join(backupDir, backupFileName);
  
  try {
    log('🔄 开始备份数据库...', 'blue');
    
    // 复制数据库文件
    fs.copyFileSync(dbPath, backupPath);
    
    // 获取文件大小
    const stats = fs.statSync(backupPath);
    const fileSizeInBytes = stats.size;
    const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);
    
    log(`✅ 数据库备份完成`, 'green');
    log(`📁 备份文件: ${backupPath}`, 'green');
    log(`📊 文件大小: ${fileSizeInMB} MB`, 'green');
    
    // 清理旧备份（保留最近10个）
    cleanOldBackups(backupDir);
    
  } catch (error) {
    log(`❌ 备份失败: ${error.message}`, 'red');
    process.exit(1);
  }
}

function cleanOldBackups(backupDir) {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('easyssh-backup-') && file.endsWith('.sqlite'))
      .map(file => ({
        name: file,
        path: path.join(backupDir, file),
        mtime: fs.statSync(path.join(backupDir, file)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);
    
    if (files.length > 10) {
      const filesToDelete = files.slice(10);
      log(`🧹 清理旧备份文件 (${filesToDelete.length} 个)...`, 'yellow');
      
      filesToDelete.forEach(file => {
        fs.unlinkSync(file.path);
        log(`  删除: ${file.name}`, 'yellow');
      });
    }
  } catch (error) {
    log(`⚠️  清理旧备份时出错: ${error.message}`, 'yellow');
  }
}

// 执行备份
backupDatabase();
