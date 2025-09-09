<template>
  <div class="performance-monitor">
    <div class="monitor-header">
      <h3>📊 SFTP性能监控</h3>
      <div class="header-controls">
        <el-select
          v-model="timeWindow"
          size="small"
          @change="refreshData"
        >
          <el-option
            label="最近1分钟"
            :value="60000"
          />
          <el-option
            label="最近5分钟"
            :value="300000"
          />
          <el-option
            label="最近15分钟"
            :value="900000"
          />
          <el-option
            label="最近1小时"
            :value="3600000"
          />
        </el-select>
        <el-button
          size="small"
          :loading="loading"
          @click="refreshData"
        >
          <i class="el-icon-refresh" /> 刷新
        </el-button>
        <el-button
          size="small"
          :type="autoRefresh ? 'success' : 'info'"
          @click="autoRefresh = !autoRefresh"
        >
          <i :class="autoRefresh ? 'el-icon-video-pause' : 'el-icon-video-play'" />
          {{ autoRefresh ? '停止' : '自动' }}
        </el-button>
      </div>
    </div>

    <!-- 系统健康状态 -->
    <div class="health-status">
      <div
        class="health-card"
        :class="healthStatus.status"
      >
        <div class="health-score">
          {{ healthStatus.score }}
        </div>
        <div class="health-label">
          系统健康分数
        </div>
        <div class="health-status-text">
          {{ getHealthStatusText(healthStatus.status) }}
        </div>
      </div>
    </div>

    <!-- 实时指标 -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">
          {{ metrics.transferSpeeds.upload.recent.toFixed(2) }}
        </div>
        <div class="metric-label">
          上传速度 (MB/s)
        </div>
        <div
          class="metric-trend"
          :class="getSpeedTrend('upload')"
        >
          <i :class="getSpeedTrendIcon('upload')" />
          {{ getSpeedTrendText('upload') }}
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-value">
          {{ metrics.transferSpeeds.download.recent.toFixed(2) }}
        </div>
        <div class="metric-label">
          下载速度 (MB/s)
        </div>
        <div
          class="metric-trend"
          :class="getSpeedTrend('download')"
        >
          <i :class="getSpeedTrendIcon('download')" />
          {{ getSpeedTrendText('download') }}
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-value">
          {{ metrics.reliability.successRate.toFixed(1) }}%
        </div>
        <div class="metric-label">
          成功率
        </div>
        <div
          class="metric-trend"
          :class="getSuccessRateTrend()"
        >
          <i :class="getSuccessRateTrendIcon()" />
          {{ getSuccessRateTrendText() }}
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-value">
          {{ metrics.reliability.concurrentOperations }}
        </div>
        <div class="metric-label">
          并发操作
        </div>
        <div
          class="metric-trend"
          :class="getConcurrencyTrend()"
        >
          <i :class="getConcurrencyTrendIcon()" />
          {{ getConcurrencyTrendText() }}
        </div>
      </div>
    </div>

    <!-- 性能图表 -->
    <div class="charts-container">
      <div class="chart-card">
        <h4>传输速度趋势</h4>
        <div
          ref="speedChart"
          class="chart"
        />
      </div>

      <div class="chart-card">
        <h4>延迟分布</h4>
        <div
          ref="latencyChart"
          class="chart"
        />
      </div>
    </div>

    <!-- 建议和警告 -->
    <div
      v-if="recommendations.length > 0"
      class="recommendations"
    >
      <h4>🔧 优化建议</h4>
      <div
        v-for="(rec, index) in recommendations"
        :key="index"
        class="recommendation-item"
        :class="rec.priority"
      >
        <i :class="getRecommendationIcon(rec.type)" />
        <span>{{ rec.message }}</span>
      </div>
    </div>

    <!-- 错误统计 -->
    <div
      v-if="errors.length > 0"
      class="error-stats"
    >
      <h4>❌ 错误统计</h4>
      <div class="error-list">
        <div
          v-for="error in errors.slice(0, 5)"
          :key="error.operation + error.errorType"
          class="error-item"
        >
          <span class="error-operation">{{ error.operation }}</span>
          <span class="error-type">{{ error.errorType }}</span>
          <span class="error-count">{{ error.count }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  name: 'PerformanceMonitor',
  data() {
    return {
      loading: false,
      autoRefresh: false,
      timeWindow: 300000, // 5分钟
      refreshInterval: null,

      // 性能数据
      metrics: {
        transferSpeeds: {
          upload: { average: 0, recent: 0 },
          download: { average: 0, recent: 0 }
        },
        latency: {
          upload: 0,
          download: 0,
          list: 0
        },
        reliability: {
          successRate: 100,
          concurrentOperations: 0
        }
      },

      // 健康状态
      healthStatus: {
        status: 'healthy',
        score: 100
      },

      // 建议和错误
      recommendations: [],
      errors: [],

      // 历史数据
      speedHistory: {
        upload: [],
        download: []
      },

      // 上一次的数据，用于计算趋势
      previousMetrics: null
    };
  },

  watch: {
    autoRefresh(newVal) {
      if (newVal) {
        this.startAutoRefresh();
      } else {
        this.stopAutoRefresh();
      }
    }
  },

  mounted() {
    this.refreshData();
  },

  beforeUnmount() {
    this.stopAutoRefresh();
  },

  methods: {
    async refreshData() {
      this.loading = true;
      try {
        // 保存上一次的数据用于趋势计算
        this.previousMetrics = { ...this.metrics };

        // 获取实时指标
        const metricsResponse = await axios.get('/api/performance/metrics', {
          params: { timeWindow: this.timeWindow }
        });
        this.metrics = metricsResponse.data.data;

        // 获取健康状态
        const healthResponse = await axios.get('/api/performance/health');
        this.healthStatus = healthResponse.data.data;
        this.recommendations = healthResponse.data.data.recommendations || [];

        // 获取错误统计
        const errorsResponse = await axios.get('/api/performance/errors');
        this.errors = errorsResponse.data.data.errors || [];

        // 获取速度历史数据
        await this.loadSpeedHistory();

        // 更新图表
        this.updateCharts();
      } catch (error) {
        console.error('获取性能数据失败:', error);
        this.$message.error('获取性能数据失败');
      } finally {
        this.loading = false;
      }
    },

    async loadSpeedHistory() {
      try {
        const [uploadResponse, downloadResponse] = await Promise.all([
          axios.get('/api/performance/speed-history', {
            params: { operation: 'upload', timeWindow: this.timeWindow, limit: 50 }
          }),
          axios.get('/api/performance/speed-history', {
            params: { operation: 'download', timeWindow: this.timeWindow, limit: 50 }
          })
        ]);

        this.speedHistory.upload = uploadResponse.data.data.records;
        this.speedHistory.download = downloadResponse.data.data.records;
      } catch (error) {
        console.error('获取速度历史失败:', error);
      }
    },

    updateCharts() {
      // 这里可以集成图表库如 ECharts 或 Chart.js
      // 由于篇幅限制，这里只是占位符
      console.log('更新图表:', this.speedHistory);
    },

    startAutoRefresh() {
      this.refreshInterval = setInterval(() => {
        this.refreshData();
      }, 10000); // 每10秒刷新
    },

    stopAutoRefresh() {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = null;
      }
    },

    // 趋势计算方法
    getSpeedTrend(operation) {
      if (!this.previousMetrics) return 'neutral';

      const current = this.metrics.transferSpeeds[operation].recent;
      const previous = this.previousMetrics.transferSpeeds[operation].recent;

      if (current > previous * 1.1) return 'up';
      if (current < previous * 0.9) return 'down';
      return 'neutral';
    },

    getSpeedTrendIcon(operation) {
      const trend = this.getSpeedTrend(operation);
      return {
        up: 'el-icon-top',
        down: 'el-icon-bottom',
        neutral: 'el-icon-minus'
      }[trend];
    },

    getSpeedTrendText(operation) {
      const trend = this.getSpeedTrend(operation);
      return {
        up: '上升',
        down: '下降',
        neutral: '稳定'
      }[trend];
    },

    getSuccessRateTrend() {
      if (!this.previousMetrics) return 'neutral';

      const current = this.metrics.reliability.successRate;
      const previous = this.previousMetrics.reliability.successRate;

      if (current > previous + 1) return 'up';
      if (current < previous - 1) return 'down';
      return 'neutral';
    },

    getSuccessRateTrendIcon() {
      const trend = this.getSuccessRateTrend();
      return {
        up: 'el-icon-top',
        down: 'el-icon-bottom',
        neutral: 'el-icon-minus'
      }[trend];
    },

    getSuccessRateTrendText() {
      const trend = this.getSuccessRateTrend();
      return {
        up: '提升',
        down: '下降',
        neutral: '稳定'
      }[trend];
    },

    getConcurrencyTrend() {
      const concurrent = this.metrics.reliability.concurrentOperations;
      if (concurrent > 10) return 'high';
      if (concurrent > 5) return 'medium';
      return 'low';
    },

    getConcurrencyTrendIcon() {
      const trend = this.getConcurrencyTrend();
      return {
        high: 'el-icon-warning',
        medium: 'el-icon-info',
        low: 'el-icon-success'
      }[trend];
    },

    getConcurrencyTrendText() {
      const trend = this.getConcurrencyTrend();
      return {
        high: '较高',
        medium: '中等',
        low: '正常'
      }[trend];
    },

    getHealthStatusText(status) {
      return (
        {
          healthy: '健康',
          warning: '警告',
          critical: '严重'
        }[status] || '未知'
      );
    },

    getRecommendationIcon(type) {
      return (
        {
          performance: 'el-icon-lightning',
          reliability: 'el-icon-shield',
          concurrency: 'el-icon-connection'
        }[type] || 'el-icon-info'
      );
    }
  }
};
</script>

<style scoped>
.performance-monitor {
  padding: 20px;
  background: #f5f5f5;
  min-height: 100vh;
}

.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  background: white;
  padding: 15px 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.monitor-header h3 {
  margin: 0;
  color: #333;
}

.header-controls {
  display: flex;
  gap: 10px;
  align-items: center;
}

.health-status {
  margin-bottom: 20px;
}

.health-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  text-align: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  border-left: 4px solid #67c23a;
}

.health-card.warning {
  border-left-color: #e6a23c;
}

.health-card.critical {
  border-left-color: #f56c6c;
}

.health-score {
  font-size: 48px;
  font-weight: bold;
  color: #67c23a;
}

.health-card.warning .health-score {
  color: #e6a23c;
}

.health-card.critical .health-score {
  color: #f56c6c;
}

.health-label {
  font-size: 14px;
  color: #666;
  margin-top: 5px;
}

.health-status-text {
  font-size: 16px;
  font-weight: bold;
  margin-top: 10px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
}

.metric-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  text-align: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.metric-value {
  font-size: 32px;
  font-weight: bold;
  color: #409eff;
}

.metric-label {
  font-size: 14px;
  color: #666;
  margin-top: 5px;
}

.metric-trend {
  font-size: 12px;
  margin-top: 10px;
  padding: 4px 8px;
  border-radius: 4px;
}

.metric-trend.up {
  background: #f0f9ff;
  color: #67c23a;
}

.metric-trend.down {
  background: #fef0f0;
  color: #f56c6c;
}

.metric-trend.neutral {
  background: #f5f5f5;
  color: #909399;
}

.charts-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.chart-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.chart-card h4 {
  margin: 0 0 15px 0;
  color: #333;
}

.chart {
  height: 200px;
  background: #f9f9f9;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
}

.recommendations {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  margin-bottom: 20px;
}

.recommendations h4 {
  margin: 0 0 15px 0;
  color: #333;
}

.recommendation-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  margin-bottom: 8px;
  border-radius: 4px;
  border-left: 3px solid #409eff;
}

.recommendation-item.high {
  background: #fef0f0;
  border-left-color: #f56c6c;
}

.recommendation-item.medium {
  background: #fdf6ec;
  border-left-color: #e6a23c;
}

.error-stats {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.error-stats h4 {
  margin: 0 0 15px 0;
  color: #333;
}

.error-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.error-item {
  display: grid;
  grid-template-columns: 1fr 2fr 80px;
  gap: 10px;
  padding: 8px 12px;
  background: #fef0f0;
  border-radius: 4px;
  font-size: 14px;
}

.error-operation {
  font-weight: bold;
  color: #f56c6c;
}

.error-type {
  color: #666;
}

.error-count {
  text-align: right;
  font-weight: bold;
  color: #f56c6c;
}
</style>
