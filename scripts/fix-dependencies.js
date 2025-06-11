#!/usr/bin/env node

/**
 * 依赖修复脚本
 * 检查并修复package.json中的依赖冲突
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class DependencyFixer {
    constructor() {
        this.packageJsonPath = path.join(process.cwd(), 'package.json');
        this.serverPackageJsonPath = path.join(process.cwd(), 'server', 'package.json');
    }

    /**
     * 读取package.json
     */
    readPackageJson(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`读取 ${filePath} 失败:`, error.message);
            return null;
        }
    }

    /**
     * 写入package.json
     */
    writePackageJson(filePath, packageData) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(packageData, null, 2) + '\n');
            console.log(`✅ 已更新 ${filePath}`);
            return true;
        } catch (error) {
            console.error(`写入 ${filePath} 失败:`, error.message);
            return false;
        }
    }

    /**
     * 检查依赖冲突
     */
    checkDependencyConflicts(packageData) {
        const conflicts = [];
        
        // 检查pinia相关冲突
        const pinia = packageData.dependencies?.pinia;
        const piniaPlugin = packageData.dependencies?.['pinia-plugin-persistedstate'];
        
        if (pinia && piniaPlugin) {
            const piniaVersion = pinia.replace(/[^\d.]/g, '');
            const majorVersion = parseInt(piniaVersion.split('.')[0]);
            
            if (majorVersion < 3 && piniaPlugin.includes('4.')) {
                conflicts.push({
                    type: 'pinia-plugin-persistedstate',
                    issue: 'pinia-plugin-persistedstate 4.x 需要 pinia >= 3.0.0',
                    current: `pinia@${pinia}, pinia-plugin-persistedstate@${piniaPlugin}`,
                    fix: 'pinia-plugin-persistedstate@^3.2.1'
                });
            }
        }
        
        return conflicts;
    }

    /**
     * 修复依赖冲突
     */
    fixDependencyConflicts(packageData) {
        let fixed = false;
        
        // 修复pinia插件版本
        if (packageData.dependencies?.['pinia-plugin-persistedstate']?.includes('4.')) {
            const piniaVersion = packageData.dependencies.pinia?.replace(/[^\d.]/g, '');
            const majorVersion = parseInt(piniaVersion?.split('.')[0] || '0');
            
            if (majorVersion < 3) {
                console.log('🔧 修复pinia-plugin-persistedstate版本冲突...');
                packageData.dependencies['pinia-plugin-persistedstate'] = '^3.2.1';
                fixed = true;
            }
        }
        
        return { packageData, fixed };
    }

    /**
     * 验证npm安装
     */
    validateNpmInstall(directory = process.cwd()) {
        try {
            console.log(`🧪 验证 ${directory} 的依赖安装...`);
            
            const originalCwd = process.cwd();
            process.chdir(directory);
            
            // 清理并重新安装
            execSync('npm cache clean --force', { stdio: 'pipe' });
            execSync('rm -rf node_modules package-lock.json', { stdio: 'pipe' });
            execSync('npm install --legacy-peer-deps', { stdio: 'pipe' });
            
            process.chdir(originalCwd);
            console.log('✅ 依赖安装验证成功');
            return true;
        } catch (error) {
            console.error('❌ 依赖安装验证失败:', error.message);
            return false;
        }
    }

    /**
     * 主修复流程
     */
    async fix() {
        console.log('🔍 开始检查依赖冲突...');
        
        // 检查前端依赖
        const frontendPackage = this.readPackageJson(this.packageJsonPath);
        if (!frontendPackage) return false;
        
        const conflicts = this.checkDependencyConflicts(frontendPackage);
        
        if (conflicts.length > 0) {
            console.log('⚠️  发现依赖冲突:');
            conflicts.forEach(conflict => {
                console.log(`  - ${conflict.type}: ${conflict.issue}`);
                console.log(`    当前: ${conflict.current}`);
                console.log(`    建议: ${conflict.fix}`);
            });
            
            // 修复冲突
            const { packageData: fixedPackage, fixed } = this.fixDependencyConflicts(frontendPackage);
            
            if (fixed) {
                this.writePackageJson(this.packageJsonPath, fixedPackage);
                console.log('✅ 依赖冲突已修复');
            }
        } else {
            console.log('✅ 未发现依赖冲突');
        }
        
        // 可选：验证安装（仅在本地环境）
        if (process.argv.includes('--validate')) {
            console.log('\n🧪 验证依赖安装...');
            
            // 验证前端依赖
            if (!this.validateNpmInstall('.')) {
                return false;
            }
            
            // 验证后端依赖
            if (fs.existsSync(this.serverPackageJsonPath)) {
                if (!this.validateNpmInstall('./server')) {
                    return false;
                }
            }
        }
        
        console.log('\n🎉 依赖检查和修复完成！');
        return true;
    }
}

// 主函数
async function main() {
    const fixer = new DependencyFixer();
    
    try {
        const success = await fixer.fix();
        process.exit(success ? 0 : 1);
    } catch (error) {
        console.error('❌ 修复过程中出错:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = DependencyFixer;
