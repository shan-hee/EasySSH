#!/usr/bin/env node

/**
 * 依赖管理脚本
 * 统一管理前后端依赖版本，检查安全漏洞
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
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

function readPackageJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    log(`❌ 无法读取 ${path}`, 'red');
    return null;
  }
}

function checkVersionConsistency() {
  log('\n🔍 检查前后端依赖版本一致性...', 'blue');
  
  const frontendPkg = readPackageJson('package.json');
  const backendPkg = readPackageJson('server/package.json');
  
  if (!frontendPkg || !backendPkg) {
    return;
  }
  
  const frontendDeps = { ...frontendPkg.dependencies, ...frontendPkg.devDependencies };
  const backendDeps = { ...backendPkg.dependencies, ...backendPkg.devDependencies };
  
  const commonDeps = Object.keys(frontendDeps).filter(dep => backendDeps[dep]);
  const inconsistencies = [];
  
  commonDeps.forEach(dep => {
    const frontendVersion = frontendDeps[dep];
    const backendVersion = backendDeps[dep];
    
    if (frontendVersion !== backendVersion) {
      inconsistencies.push({
        package: dep,
        frontend: frontendVersion,
        backend: backendVersion
      });
    }
  });
  
  if (inconsistencies.length > 0) {
    log('⚠️  发现版本不一致的依赖:', 'yellow');
    inconsistencies.forEach(({ package: pkg, frontend, backend }) => {
      log(`  ${pkg}: 前端(${frontend}) vs 后端(${backend})`, 'yellow');
    });
    
    // 生成修复建议
    log('\n💡 修复建议:', 'cyan');
    inconsistencies.forEach(({ package: pkg, frontend, backend }) => {
      const newerVersion = compareVersions(frontend, backend) > 0 ? frontend : backend;
      log(`  统一 ${pkg} 版本为: ${newerVersion}`, 'cyan');
    });
  } else {
    log('✅ 共同依赖版本一致', 'green');
  }
  
  return inconsistencies;
}

function compareVersions(v1, v2) {
  // 简单的版本比较（去除^和~符号）
  const clean1 = v1.replace(/[\^~]/, '');
  const clean2 = v2.replace(/[\^~]/, '');
  
  const parts1 = clean1.split('.').map(Number);
  const parts2 = clean2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    
    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }
  
  return 0;
}

function checkSecurity() {
  log('\n🔒 检查安全漏洞...', 'blue');
  
  // 检查前端
  log('检查前端依赖...', 'blue');
  try {
    execSync('npm audit --audit-level=moderate', { stdio: 'inherit' });
  } catch (error) {
    log('⚠️  前端发现安全问题，建议运行: npm audit fix', 'yellow');
  }
  
  // 检查后端
  log('\n检查后端依赖...', 'blue');
  try {
    execSync('cd server && npm audit --audit-level=moderate', { stdio: 'inherit' });
  } catch (error) {
    log('⚠️  后端发现安全问题，建议运行: cd server && npm audit fix', 'yellow');
  }
}

function updateDependencies() {
  log('\n📦 更新依赖...', 'blue');
  
  const answer = process.argv.includes('--auto') ? 'y' : 
    require('readline-sync').question('是否要更新所有依赖到最新版本? (y/N): ');
  
  if (answer.toLowerCase() === 'y') {
    log('更新前端依赖...', 'blue');
    try {
      execSync('npm update', { stdio: 'inherit' });
      log('✅ 前端依赖更新完成', 'green');
    } catch (error) {
      log('❌ 前端依赖更新失败', 'red');
    }
    
    log('更新后端依赖...', 'blue');
    try {
      execSync('cd server && npm update', { stdio: 'inherit' });
      log('✅ 后端依赖更新完成', 'green');
    } catch (error) {
      log('❌ 后端依赖更新失败', 'red');
    }
  } else {
    log('跳过依赖更新', 'yellow');
  }
}

function generateDependencyReport() {
  log('\n📋 生成依赖报告...', 'blue');
  
  const frontendPkg = readPackageJson('package.json');
  const backendPkg = readPackageJson('server/package.json');
  
  const report = {
    generatedAt: new Date().toISOString(),
    frontend: {
      dependencies: frontendPkg?.dependencies || {},
      devDependencies: frontendPkg?.devDependencies || {}
    },
    backend: {
      dependencies: backendPkg?.dependencies || {},
      devDependencies: backendPkg?.devDependencies || {}
    }
  };
  
  writeFileSync('dependency-report.json', JSON.stringify(report, null, 2));
  log('✅ 依赖报告已生成: dependency-report.json', 'green');
}

function main() {
  log('🔧 依赖管理工具', 'cyan');
  
  // 检查版本一致性
  checkVersionConsistency();
  
  // 检查安全漏洞
  checkSecurity();
  
  // 更新依赖（可选）
  if (process.argv.includes('--update')) {
    updateDependencies();
  }
  
  // 生成报告
  generateDependencyReport();
  
  log('\n✅ 依赖管理完成', 'green');
}

// 执行主函数
main();
