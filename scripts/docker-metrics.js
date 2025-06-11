#!/usr/bin/env node

/**
 * Docker镜像性能指标收集脚本
 * 用于GitHub Actions中收集和展示构建优化效果
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class DockerMetrics {
    constructor() {
        this.metrics = {
            buildTime: null,
            imageSize: null,
            layers: null,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * 获取镜像大小（MB）
     */
    getImageSize(imageName) {
        try {
            const output = execSync(`docker images ${imageName} --format "{{.Size}}"`, { encoding: 'utf8' });
            const sizeStr = output.trim();
            
            // 转换为MB
            if (sizeStr.includes('GB')) {
                return parseFloat(sizeStr) * 1024;
            } else if (sizeStr.includes('MB')) {
                return parseFloat(sizeStr);
            } else if (sizeStr.includes('KB')) {
                return parseFloat(sizeStr) / 1024;
            }
            return 0;
        } catch (error) {
            console.error('获取镜像大小失败:', error.message);
            return null;
        }
    }

    /**
     * 获取镜像层数
     */
    getImageLayers(imageName) {
        try {
            const output = execSync(`docker history ${imageName} --format "{{.CreatedBy}}" | wc -l`, { encoding: 'utf8' });
            return parseInt(output.trim());
        } catch (error) {
            console.error('获取镜像层数失败:', error.message);
            return null;
        }
    }

    /**
     * 分析镜像组成
     */
    analyzeImage(imageName) {
        try {
            const history = execSync(`docker history ${imageName} --format "table {{.CreatedBy}}\t{{.Size}}"`, { encoding: 'utf8' });
            return history.split('\n').filter(line => line.trim());
        } catch (error) {
            console.error('分析镜像失败:', error.message);
            return [];
        }
    }

    /**
     * 生成性能报告
     */
    generateReport(imageName) {
        console.log('🔍 收集Docker镜像指标...');
        
        this.metrics.imageSize = this.getImageSize(imageName);
        this.metrics.layers = this.getImageLayers(imageName);
        
        const analysis = this.analyzeImage(imageName);
        
        console.log('\n📊 镜像性能指标:');
        console.log('================');
        console.log(`镜像名称: ${imageName}`);
        console.log(`镜像大小: ${this.metrics.imageSize ? this.metrics.imageSize.toFixed(2) + 'MB' : '未知'}`);
        console.log(`镜像层数: ${this.metrics.layers || '未知'}`);
        console.log(`分析时间: ${this.metrics.timestamp}`);
        
        // 大小评估
        if (this.metrics.imageSize) {
            if (this.metrics.imageSize < 300) {
                console.log('✅ 镜像大小优秀 (<300MB)');
            } else if (this.metrics.imageSize < 500) {
                console.log('🟡 镜像大小良好 (300-500MB)');
            } else {
                console.log('🔴 镜像大小需要优化 (>500MB)');
            }
        }
        
        // 层数评估
        if (this.metrics.layers) {
            if (this.metrics.layers < 20) {
                console.log('✅ 镜像层数合理 (<20层)');
            } else if (this.metrics.layers < 30) {
                console.log('🟡 镜像层数较多 (20-30层)');
            } else {
                console.log('🔴 镜像层数过多 (>30层)');
            }
        }
        
        console.log('\n📋 镜像层分析:');
        console.log('================');
        analysis.slice(0, 10).forEach(line => {
            console.log(line);
        });
        
        if (analysis.length > 10) {
            console.log(`... 还有 ${analysis.length - 10} 层`);
        }
        
        return this.metrics;
    }

    /**
     * 保存指标到文件
     */
    saveMetrics(metrics, filename = 'docker-metrics.json') {
        try {
            const metricsDir = path.join(process.cwd(), 'metrics');
            if (!fs.existsSync(metricsDir)) {
                fs.mkdirSync(metricsDir, { recursive: true });
            }
            
            const filepath = path.join(metricsDir, filename);
            fs.writeFileSync(filepath, JSON.stringify(metrics, null, 2));
            console.log(`\n💾 指标已保存到: ${filepath}`);
        } catch (error) {
            console.error('保存指标失败:', error.message);
        }
    }

    /**
     * 对比历史指标
     */
    compareMetrics(currentMetrics, previousMetrics) {
        if (!previousMetrics) {
            console.log('\n📈 首次构建，无历史数据对比');
            return;
        }
        
        console.log('\n📈 性能对比:');
        console.log('================');
        
        if (currentMetrics.imageSize && previousMetrics.imageSize) {
            const sizeDiff = currentMetrics.imageSize - previousMetrics.imageSize;
            const sizePercent = (sizeDiff / previousMetrics.imageSize * 100).toFixed(1);
            
            if (sizeDiff > 0) {
                console.log(`镜像大小: ${currentMetrics.imageSize.toFixed(2)}MB (+${sizeDiff.toFixed(2)}MB, +${sizePercent}%)`);
            } else {
                console.log(`镜像大小: ${currentMetrics.imageSize.toFixed(2)}MB (${sizeDiff.toFixed(2)}MB, ${sizePercent}%)`);
            }
        }
        
        if (currentMetrics.layers && previousMetrics.layers) {
            const layerDiff = currentMetrics.layers - previousMetrics.layers;
            console.log(`镜像层数: ${currentMetrics.layers} (${layerDiff > 0 ? '+' : ''}${layerDiff})`);
        }
    }
}

// 主函数
function main() {
    const imageName = process.argv[2] || 'easyssh:latest';
    const metrics = new DockerMetrics();
    
    try {
        const currentMetrics = metrics.generateReport(imageName);
        
        // 尝试加载历史指标
        const metricsFile = path.join(process.cwd(), 'metrics', 'docker-metrics.json');
        let previousMetrics = null;
        
        if (fs.existsSync(metricsFile)) {
            try {
                previousMetrics = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
            } catch (error) {
                console.log('无法读取历史指标');
            }
        }
        
        // 对比指标
        metrics.compareMetrics(currentMetrics, previousMetrics);
        
        // 保存当前指标
        metrics.saveMetrics(currentMetrics);
        
        // 设置GitHub Actions输出
        if (process.env.GITHUB_ACTIONS) {
            console.log(`\n::set-output name=image-size::${currentMetrics.imageSize || 0}`);
            console.log(`::set-output name=image-layers::${currentMetrics.layers || 0}`);
        }
        
    } catch (error) {
        console.error('执行失败:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = DockerMetrics;
