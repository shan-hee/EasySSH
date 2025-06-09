#!/usr/bin/env node

/**
 * 构建优化脚本
 * 提供构建前的优化检查和构建后的分析
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkDependencies() {
  log('\n🔍 检查依赖状态...', 'blue');
  
  try {
    const outdated = execSync('npm outdated --json', { encoding: 'utf8' });
    const outdatedDeps = JSON.parse(outdated);
    
    if (Object.keys(outdatedDeps).length > 0) {
      log('⚠️  发现过时的依赖:', 'yellow');
      Object.entries(outdatedDeps).forEach(([name, info]) => {
        log(`  ${name}: ${info.current} → ${info.latest}`, 'yellow');
      });
      log('建议运行: npm run deps:update', 'yellow');
    } else {
      log('✅ 所有依赖都是最新的', 'green');
    }
  } catch (error) {
    log('✅ 依赖检查完成', 'green');
  }
}

function analyzeBundleSize() {
  log('\n📊 分析构建包大小...', 'blue');
  
  const distPath = resolve(process.cwd(), 'dist');
  if (!existsSync(distPath)) {
    log('❌ dist目录不存在，请先运行构建', 'red');
    return;
  }
  
  try {
    execSync('npm run size', { stdio: 'inherit' });
  } catch (error) {
    log('⚠️  包大小分析失败，但构建成功', 'yellow');
  }
}

function generateBuildReport() {
  log('\n📋 生成构建报告...', 'blue');
  
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const buildTime = new Date().toISOString();
  
  const report = {
    projectName: packageJson.name,
    version: packageJson.version,
    buildTime,
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    dependencies: Object.keys(packageJson.dependencies || {}),
    devDependencies: Object.keys(packageJson.devDependencies || {})
  };
  
  writeFileSync('dist/build-report.json', JSON.stringify(report, null, 2));
  log('✅ 构建报告已生成: dist/build-report.json', 'green');
}

function optimizeBuild() {
  log('🚀 开始优化构建流程...', 'cyan');
  
  // 1. 检查依赖
  checkDependencies();
  
  // 2. 清理缓存
  log('\n🧹 清理构建缓存...', 'blue');
  try {
    execSync('npm run clean', { stdio: 'inherit' });
    log('✅ 缓存清理完成', 'green');
  } catch (error) {
    log('⚠️  缓存清理失败，继续构建', 'yellow');
  }
  
  // 3. 执行构建
  log('\n🔨 执行生产构建...', 'blue');
  try {
    execSync('npm run build', { stdio: 'inherit' });
    log('✅ 构建完成', 'green');
  } catch (error) {
    log('❌ 构建失败', 'red');
    process.exit(1);
  }
  
  // 4. 分析包大小
  analyzeBundleSize();
  
  // 5. 生成报告
  generateBuildReport();
  
  log('\n🎉 构建优化完成!', 'green');
  log('📁 构建文件位于: dist/', 'cyan');
  log('📊 查看分析报告: dist/stats.html', 'cyan');
}

// 执行优化
optimizeBuild();
