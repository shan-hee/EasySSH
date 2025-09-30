/**
 * 系统性能检测服务（全面版）
 * - 事件循环延迟
 * - FPS 估算
 * - 内存使用与趋势
 * - 页面性能计时（加载/首绘）
 *
 * 使用：在浏览器控制台执行 EasySSH.printPerformance() 查看报告
 */
class PerformanceService {
  constructor() {
    this.started = false;
    this.samples = {
      eventLoopLag: [], // 毫秒
      fps: [],          // 帧率样本
      memory: []        // {used,total,limit,timestamp}
    };
    this.maxSamples = 300; // 每类最多保留 300 个样本

    // 定时器句柄
    this._lagTimer = null;
    this._memTimer = null;
    this._rafId = null;

    // FPS 统计
    this._fpsLastTime = 0;
    this._fpsFrames = 0;
    this._fpsWindowMs = 2000; // 每2秒记录一次 FPS 样本
  }

  /** 初始化并开始采样（幂等） */
  init() {
    if (this.started) return true;
    this.started = true;

    // 事件循环延迟（基于 setInterval 漂移）
    let expected = performance.now() + 500;
    this._lagTimer = setInterval(() => {
      const now = performance.now();
      const drift = Math.max(0, now - expected);
      expected += 500;
      this._pushSample(this.samples.eventLoopLag, drift);
    }, 500);

    // FPS 估算（基于 rAF）
    const onFrame = (ts) => {
      if (!this._fpsLastTime) this._fpsLastTime = ts;
      this._fpsFrames++;
      const diff = ts - this._fpsLastTime;
      if (diff >= this._fpsWindowMs) {
        const fps = (this._fpsFrames * 1000) / diff;
        this._pushSample(this.samples.fps, fps);
        this._fpsFrames = 0;
        this._fpsLastTime = ts;
      }
      this._rafId = requestAnimationFrame(onFrame);
    };
    if (typeof requestAnimationFrame === 'function') {
      this._rafId = requestAnimationFrame(onFrame);
    }

    // 内存使用（如浏览器支持）
    this._memTimer = setInterval(() => {
      try {
        const m = performance && performance.memory;
        if (m && typeof m.usedJSHeapSize === 'number') {
          this._pushSample(this.samples.memory, {
            used: m.usedJSHeapSize,
            total: m.totalJSHeapSize,
            limit: m.jsHeapSizeLimit,
            timestamp: Date.now()
          });
        }
      } catch (_) {
        // 忽略
      }
    }, 5000);

    // 在全局暴露便捷入口
    this._exposeGlobal();
    return true;
  }

  /** 停止采样 */
  stop() {
    if (!this.started) return;
    this.started = false;
    if (this._lagTimer) clearInterval(this._lagTimer);
    if (this._memTimer) clearInterval(this._memTimer);
    if (this._rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._rafId);
    this._lagTimer = null;
    this._memTimer = null;
    this._rafId = null;
  }

  /** 推入样本并裁剪长度 */
  _pushSample(arr, v) {
    arr.push(v);
    if (arr.length > this.maxSamples) arr.shift();
  }

  /** 获取系统性能报告（对象） */
  getReport() {
    const nav = this._collectNavigationTiming();
    const paint = this._collectPaintTiming();
    const mem = this._analyzeMemory();
    const lag = this._analyzeNumbers(this.samples.eventLoopLag);
    const fps = this._analyzeNumbers(this.samples.fps);

    const report = {
      timestamp: new Date().toISOString(),
      navigation: nav,
      paint,
      eventLoopLag: lag,
      fps,
      memory: mem,
      recommendations: []
    };

    // 生成建议
    if (fps.average && fps.average < 45) {
      report.recommendations.push({ type: 'performance', priority: 'medium', message: 'FPS 较低，建议减少动画或复杂绘制' });
    }
    if (lag.p95 && lag.p95 > 100) {
      report.recommendations.push({ type: 'performance', priority: 'high', message: '事件循环延迟较高，可能存在阻塞主线程的任务' });
    }
    if (mem.utilization && mem.utilization > 0.8) {
      report.recommendations.push({ type: 'memory', priority: 'high', message: '内存使用率过高，建议清理缓存或减少长列表数据' });
    }
    if (nav.domContentLoaded && nav.domContentLoaded > 2000) {
      report.recommendations.push({ type: 'load', priority: 'medium', message: 'DOMContentLoaded 较慢，检查首屏渲染与资源体积' });
    }

    return report;
  }

  /** 打印系统性能报告 */
  printReport() {
    const r = this.getReport();
    try {
      // 友好格式化输出
      console.log('\n📈 系统性能报告');
      console.log('='.repeat(40));
      if (r.navigation) {
        console.log('\n⏱️ 页面加载:');
        if (typeof r.navigation.domContentLoaded === 'number') console.log(`  DOMContentLoaded: ${r.navigation.domContentLoaded.toFixed(0)}ms`);
        if (typeof r.navigation.total === 'number') console.log(`  总加载时间: ${r.navigation.total.toFixed(0)}ms`);
      }
      if (r.paint) {
        console.log('\n🎨 首绘:');
        if (typeof r.paint.FP === 'number') console.log(`  FP: ${r.paint.FP.toFixed(0)}ms`);
        if (typeof r.paint.FCP === 'number') console.log(`  FCP: ${r.paint.FCP.toFixed(0)}ms`);
      }
      console.log('\n🌀 事件循环延迟:');
      console.log(`  平均: ${Number(r.eventLoopLag.average || 0).toFixed(1)}ms, P95: ${Number(r.eventLoopLag.p95 || 0).toFixed(1)}ms, 最大: ${Number(r.eventLoopLag.max || 0).toFixed(1)}ms`);
      console.log('\n🎞️ FPS 估算:');
      console.log(`  平均: ${Number(r.fps.average || 0).toFixed(1)}, 最低: ${Number(r.fps.min || 0).toFixed(1)}`);
      if (r.memory) {
        console.log('\n💾 内存:');
        if (r.memory.currentMB) console.log(`  当前: ${r.memory.currentMB.toFixed(2)} MB`);
        if (r.memory.peakMB) console.log(`  峰值: ${r.memory.peakMB.toFixed(2)} MB`);
        if (typeof r.memory.utilization === 'number') console.log(`  使用率: ${(r.memory.utilization * 100).toFixed(1)}%`);
        console.log(`  趋势: ${r.memory.trend}`);
      }
      if (r.recommendations.length) {
        console.log('\n💡 建议:');
        r.recommendations.forEach((rec, i) => {
          const p = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
          console.log(`  ${i + 1}. ${p} ${rec.message}`);
        });
      } else {
        console.log('\n✅ 系统性能良好');
      }
    } catch (_) {
      // 兜底输出
      console.log('[Performance Report]', r);
    }
    return r;
  }

  /** 暴露全局入口（浏览器环境） */
  _exposeGlobal() {
    try {
      const g = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null;
      if (!g) return;
      g.EasySSH = g.EasySSH || {};
      if (typeof g.EasySSH.printPerformance !== 'function') {
        g.EasySSH.printPerformance = () => this.printReport();
      }
    } catch (_) {
      // 忽略
    }
  }

  /** 数组数值分析 */
  _analyzeNumbers(list) {
    const arr = (list || []).filter(v => typeof v === 'number' && !Number.isNaN(v));
    if (!arr.length) return { count: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const avg = sum / sorted.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    return {
      count: sorted.length,
      average: avg,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p95
    };
  }

  /** 内存分析 */
  _analyzeMemory() {
    const list = this.samples.memory || [];
    if (!list.length) return { trend: 'unknown' };
    const latest = list[list.length - 1];
    const peak = Math.max(...list.map(m => m.used));
    let trend = 'stable';
    if (list.length >= 6) {
      const recent = list.slice(-6);
      const c = recent[0].used;
      const d = recent[recent.length - 1].used;
      const change = c ? (d - c) / c : 0;
      trend = change > 0.1 ? 'increasing' : change < -0.1 ? 'decreasing' : 'stable';
    }
    return {
      current: latest.used,
      currentMB: latest.used / 1024 / 1024,
      peak,
      peakMB: peak / 1024 / 1024,
      utilization: latest.total ? latest.used / latest.total : undefined,
      trend
    };
  }

  /** 页面加载计时 */
  _collectNavigationTiming() {
    try {
      const [nav] = performance.getEntriesByType('navigation');
      if (!nav) return {};
      const domContentLoaded = nav.domContentLoadedEventEnd - nav.startTime;
      const total = nav.responseEnd - nav.startTime;
      return {
        domContentLoaded,
        total
      };
    } catch (_) {
      return {};
    }
  }

  /** 首绘计时 */
  _collectPaintTiming() {
    try {
      const entries = performance.getEntriesByType('paint');
      const res = {};
      for (const e of entries) {
        if (e.name === 'first-paint') res.FP = e.startTime;
        if (e.name === 'first-contentful-paint') res.FCP = e.startTime;
      }
      return res;
    } catch (_) {
      return {};
    }
  }
}

const performanceService = new PerformanceService();
export default performanceService;
