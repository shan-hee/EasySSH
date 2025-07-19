#!/usr/bin/env node

import fs from 'fs';
import globPkg from 'glob';
const { glob } = globPkg;

/**
 * 统一的CSS样式检测工具
 * 集成所有必要的样式质量检测功能
 */
class StyleChecker {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      summary: {
        totalFiles: 0,
        totalSize: 0,
        totalLines: 0,
        cssVariables: 0,
        selectors: 0,
        importantUsage: 0,
        specificityConflicts: 0,
        unusedVariables: 0,
        duplicateSelectors: 0,
        performanceScore: 0
      },
      details: {
        importantRules: [],
        specificityConflicts: [],
        unusedVariables: [],
        duplicateSelectors: [],
        performanceMetrics: {}
      }
    };
    
    this.themeVariables = new Map();
    this.allSelectors = new Map();
    this.variableUsage = new Map();
  }

  /**
   * 运行完整的样式检测
   */
  async run() {
    console.log('🎨 CSS样式质量检测工具');
    console.log('='.repeat(40));
    console.log('');

    const startTime = Date.now();

    try {
      // 1. 收集文件信息
      await this.collectFiles();
      
      // 2. 分析CSS变量
      await this.analyzeVariables();
      
      // 3. 检测!important使用
      await this.checkImportantUsage();
      
      // 4. 检测特异性冲突
      await this.checkSpecificityConflicts();
      
      // 5. 检测未使用变量
      await this.checkUnusedVariables();
      
      // 6. 检测重复选择器
      await this.checkDuplicateSelectors();
      
      // 7. 计算性能评分
      this.calculatePerformanceScore();
      
      // 8. 生成报告
      this.generateReport();
      
      const endTime = Date.now();
      console.log(`\n⏱️  检测完成，耗时: ${endTime - startTime}ms`);
      
    } catch (error) {
      console.error('❌ 检测过程中出现错误:', error.message);
      process.exit(1);
    }
  }

  /**
   * 收集样式文件
   */
  async collectFiles() {
    console.log('📁 收集样式文件...');
    
    const patterns = [
      'src/**/*.css',
      'src/**/*.vue'
    ];

    let totalFiles = 0;
    let totalSize = 0;
    let totalLines = 0;

    for (const pattern of patterns) {
      const files = glob.sync(pattern);
      for (const file of files) {
        const stats = fs.statSync(file);
        const content = fs.readFileSync(file, 'utf8');
        
        totalFiles++;
        totalSize += stats.size;
        totalLines += content.split('\n').length;
      }
    }

    this.results.summary.totalFiles = totalFiles;
    this.results.summary.totalSize = totalSize;
    this.results.summary.totalLines = totalLines;
    
    console.log(`   找到 ${totalFiles} 个文件，总大小 ${(totalSize / 1024).toFixed(2)} KB`);
  }

  /**
   * 分析CSS变量
   */
  async analyzeVariables() {
    console.log('🎨 分析CSS变量...');
    
    // 首先收集主题变量
    const themeFiles = glob.sync('src/assets/styles/themes/**/*.css');
    for (const file of themeFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const variables = content.match(/--[a-zA-Z0-9-_]+/g) || [];
      variables.forEach(variable => {
        this.themeVariables.set(variable, file);
      });
    }

    // 然后分析所有文件中的变量使用
    const allFiles = glob.sync('src/**/*.{css,vue}');
    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf8');
      
      // 提取CSS内容
      let cssContent = content;
      if (file.endsWith('.vue')) {
        const styleMatches = content.match(/<style[^>]*>([\s\S]*?)<\/style>/g);
        if (styleMatches) {
          cssContent = styleMatches.join('\n');
        }
      }

      // 统计变量使用
      const usedVariables = cssContent.match(/var\(--[a-zA-Z0-9-_]+\)/g) || [];
      usedVariables.forEach(usage => {
        const variable = usage.match(/--[a-zA-Z0-9-_]+/)[0];
        if (!this.variableUsage.has(variable)) {
          this.variableUsage.set(variable, []);
        }
        this.variableUsage.get(variable).push(file);
      });
    }

    this.results.summary.cssVariables = this.themeVariables.size;
    console.log(`   发现 ${this.themeVariables.size} 个CSS变量`);
  }

  /**
   * 检测!important使用
   */
  async checkImportantUsage() {
    console.log('⚠️  检测!important使用...');
    
    const files = glob.sync('src/**/*.{css,vue}');
    let importantCount = 0;
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const importantMatches = content.match(/[^;{}]*!important[^;{}]*/g) || [];
      
      importantMatches.forEach(match => {
        importantCount++;
        this.results.details.importantRules.push({
          file: file.replace(process.cwd() + '/', ''),
          rule: match.trim(),
          severity: this.assessImportantSeverity(match)
        });
      });
    }

    this.results.summary.importantUsage = importantCount;
    console.log(`   发现 ${importantCount} 个!important使用`);
  }

  /**
   * 检测特异性冲突
   */
  async checkSpecificityConflicts() {
    console.log('⚔️  检测特异性冲突...');
    
    const files = glob.sync('src/**/*.{css,vue}');
    
    // 收集所有选择器
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      let cssContent = content;
      
      if (file.endsWith('.vue')) {
        const styleMatches = content.match(/<style[^>]*>([\s\S]*?)<\/style>/g);
        if (styleMatches) {
          cssContent = styleMatches.join('\n');
        }
      }

      // 移除媒体查询和关键帧动画避免误报
      cssContent = cssContent.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, '');
      cssContent = cssContent.replace(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g, '');

      const selectorPattern = /([^{}]+)\s*\{([^{}]*)\}/g;
      let match;
      
      while ((match = selectorPattern.exec(cssContent)) !== null) {
        const selector = match[1].trim();
        const rules = match[2].trim();
        
        if (!selector || selector.startsWith('@') || this.isKeyframeSelector(selector)) continue;
        
        if (!this.allSelectors.has(selector)) {
          this.allSelectors.set(selector, []);
        }
        
        this.allSelectors.get(selector).push({
          file: file.replace(process.cwd() + '/', ''),
          rules,
          specificity: this.calculateSpecificity(selector)
        });
      }
    }

    // 分析冲突
    let conflictCount = 0;
    for (const [selector, definitions] of this.allSelectors) {
      if (definitions.length > 1) {
        // 检查是否有相同特异性的定义
        const specificityGroups = new Map();
        definitions.forEach(def => {
          const key = def.specificity.total;
          if (!specificityGroups.has(key)) {
            specificityGroups.set(key, []);
          }
          specificityGroups.get(key).push(def);
        });

        for (const [, group] of specificityGroups) {
          if (group.length > 1) {
            conflictCount++;
            this.results.details.specificityConflicts.push({
              selector,
              conflictingDefinitions: group,
              severity: this.assessConflictSeverity(selector, group)
            });
          }
        }
      }
    }

    this.results.summary.specificityConflicts = conflictCount;
    this.results.summary.selectors = this.allSelectors.size;
    console.log(`   发现 ${conflictCount} 个特异性冲突`);
  }

  /**
   * 检测未使用变量
   */
  async checkUnusedVariables() {
    console.log('🗑️  检测未使用变量...');
    
    let unusedCount = 0;
    for (const [variable] of this.themeVariables) {
      if (!this.variableUsage.has(variable)) {
        unusedCount++;
        this.results.details.unusedVariables.push({
          variable,
          definedIn: this.themeVariables.get(variable)
        });
      }
    }

    this.results.summary.unusedVariables = unusedCount;
    console.log(`   发现 ${unusedCount} 个未使用变量`);
  }

  /**
   * 检测重复选择器
   */
  async checkDuplicateSelectors() {
    console.log('🔄 检测重复选择器...');
    
    let duplicateCount = 0;
    for (const [selector, definitions] of this.allSelectors) {
      if (definitions.length > 1) {
        // 检查是否有完全相同的规则
        const ruleGroups = new Map();
        definitions.forEach(def => {
          const normalizedRules = def.rules.replace(/\s+/g, ' ').trim();
          if (!ruleGroups.has(normalizedRules)) {
            ruleGroups.set(normalizedRules, []);
          }
          ruleGroups.get(normalizedRules).push(def);
        });

        for (const [rules, group] of ruleGroups) {
          if (group.length > 1) {
            duplicateCount++;
            this.results.details.duplicateSelectors.push({
              selector,
              rules,
              duplicateDefinitions: group
            });
          }
        }
      }
    }

    this.results.summary.duplicateSelectors = duplicateCount;
    console.log(`   发现 ${duplicateCount} 个重复选择器`);
  }

  /**
   * 计算性能评分
   */
  calculatePerformanceScore() {
    console.log('🎯 计算性能评分...');
    
    let score = 100;
    
    // 文件大小评分 (30%)
    const avgFileSize = this.results.summary.totalSize / this.results.summary.totalFiles / 1024;
    if (avgFileSize > 50) score -= 15;
    else if (avgFileSize > 30) score -= 10;
    else if (avgFileSize > 20) score -= 5;
    
    // !important使用评分 (25%)
    const importantRatio = this.results.summary.importantUsage / this.results.summary.selectors;
    if (importantRatio > 0.2) score -= 15;
    else if (importantRatio > 0.1) score -= 10;
    else if (importantRatio > 0.05) score -= 5;
    
    // 特异性冲突评分 (25%)
    if (this.results.summary.specificityConflicts > 100) score -= 15;
    else if (this.results.summary.specificityConflicts > 50) score -= 10;
    else if (this.results.summary.specificityConflicts > 20) score -= 5;
    
    // 重复选择器评分 (10%)
    if (this.results.summary.duplicateSelectors > 50) score -= 10;
    else if (this.results.summary.duplicateSelectors > 20) score -= 5;
    
    // CSS变量使用评分 (10%)
    const variableUsageRatio = this.variableUsage.size / this.results.summary.cssVariables;
    if (variableUsageRatio < 0.5) score -= 5;
    else if (variableUsageRatio > 0.8) score += 5;
    
    this.results.summary.performanceScore = Math.max(0, Math.min(100, score));
    
    this.results.details.performanceMetrics = {
      avgFileSize: avgFileSize.toFixed(2) + ' KB',
      importantRatio: (importantRatio * 100).toFixed(1) + '%',
      variableUsageRatio: (variableUsageRatio * 100).toFixed(1) + '%'
    };
    
    console.log(`   性能评分: ${this.results.summary.performanceScore}/100`);
  }

  /**
   * 生成报告
   */
  generateReport() {
    console.log('\n📋 样式质量检测报告');
    console.log('='.repeat(40));
    
    // 基础指标
    console.log('📊 基础指标:');
    console.log(`   总文件数: ${this.results.summary.totalFiles}`);
    console.log(`   总大小: ${(this.results.summary.totalSize / 1024).toFixed(2)} KB`);
    console.log(`   选择器数: ${this.results.summary.selectors}`);
    console.log(`   CSS变量数: ${this.results.summary.cssVariables}`);
    
    // 质量指标
    console.log('\n🎯 质量指标:');
    console.log(`   !important使用: ${this.results.summary.importantUsage}`);
    console.log(`   特异性冲突: ${this.results.summary.specificityConflicts}`);
    console.log(`   未使用变量: ${this.results.summary.unusedVariables}`);
    console.log(`   重复选择器: ${this.results.summary.duplicateSelectors}`);
    
    // 性能评分
    console.log('\n🏆 性能评分:');
    console.log(`   总评分: ${this.results.summary.performanceScore}/100`);
    
    let grade = 'F';
    if (this.results.summary.performanceScore >= 90) grade = 'A+';
    else if (this.results.summary.performanceScore >= 80) grade = 'A';
    else if (this.results.summary.performanceScore >= 70) grade = 'B';
    else if (this.results.summary.performanceScore >= 60) grade = 'C';
    else if (this.results.summary.performanceScore >= 50) grade = 'D';
    
    console.log(`   等级: ${grade}`);
    
    // 优化建议
    this.generateSuggestions();
    
    // 保存详细报告
    fs.writeFileSync('style-quality-report.json', JSON.stringify(this.results, null, 2));
    console.log('\n📄 详细报告已保存到: style-quality-report.json');
  }

  /**
   * 生成优化建议
   */
  generateSuggestions() {
    console.log('\n💡 优化建议:');
    
    const suggestions = [];
    
    if (this.results.summary.importantUsage > 100) {
      suggestions.push('⚠️  减少!important使用，当前使用过多');
    }
    
    if (this.results.summary.specificityConflicts > 50) {
      suggestions.push('⚔️  解决特异性冲突，当前冲突较多');
    }
    
    if (this.results.summary.unusedVariables > 20) {
      suggestions.push('🗑️  清理未使用的CSS变量');
    }
    
    if (this.results.summary.duplicateSelectors > 10) {
      suggestions.push('🔄 清理重复的选择器定义');
    }
    
    const avgFileSize = this.results.summary.totalSize / this.results.summary.totalFiles / 1024;
    if (avgFileSize > 30) {
      suggestions.push('📦 考虑拆分大型CSS文件');
    }
    
    if (suggestions.length === 0) {
      console.log('   ✅ 当前CSS质量表现良好，无需特别优化');
    } else {
      suggestions.forEach(suggestion => console.log(`   ${suggestion}`));
    }
  }

  /**
   * 检查是否是关键帧选择器
   */
  isKeyframeSelector(selector) {
    // 关键帧选择器：0%, 100%, from, to, 或百分比
    return /^(0%|100%|from|to|\d+%)$/.test(selector.trim());
  }

  /**
   * 计算选择器特异性
   */
  calculateSpecificity(selector) {
    const ids = (selector.match(/#[a-zA-Z0-9_-]+/g) || []).length;
    const classes = (selector.match(/\.[a-zA-Z0-9_-]+/g) || []).length;
    const elements = (selector.match(/^[a-zA-Z0-9]+|[\s>+~][a-zA-Z0-9]+/g) || []).length;
    
    return {
      ids,
      classes,
      elements,
      total: ids * 100 + classes * 10 + elements
    };
  }

  /**
   * 评估!important严重程度
   */
  assessImportantSeverity(rule) {
    if (rule.includes('display: none')) return 'low';
    if (rule.includes('z-index')) return 'medium';
    if (rule.includes('color') || rule.includes('background')) return 'high';
    return 'medium';
  }

  /**
   * 评估冲突严重程度
   */
  assessConflictSeverity(selector, definitions) {
    if (selector === 'body' || selector === 'html') return 'high';
    if (definitions.length > 3) return 'high';
    if (definitions.some(def => def.rules.includes('!important'))) return 'high';
    return 'medium';
  }
}

// 运行检测
const checker = new StyleChecker();
checker.run();
