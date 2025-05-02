<!--
  系统监控面板组件
  用于展示系统、CPU、内存和硬盘的使用情况
-->
<template>
  <div class="monitoring-panel" :class="{ 'closing': isClosing, 'resizing': isResizing }" :style="{ width: width + 'px' }">
    <div class="panel-resizer" @mousedown="startResizing"></div>
    <div class="panel-header">
      <h2>系统监控</h2>
      <button class="close-button" @click="closePanel">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
          <path fill="#ffffff" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path>
        </svg>
      </button>
    </div>

    <div class="panel-content">
      <!-- 系统信息卡片 -->
      <div class="dashboard-card">
        <h3>系统信息</h3>
        <div class="system-info-container">
        <div class="info-list">
          <div class="info-item">
            <span class="info-label">主机名：</span>
            <span class="info-value">{{ systemInfo.os?.hostname || '获取中...' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">系统：</span>
            <span class="info-value">{{ formatOsInfo }}</span>
          </div>
            <div class="info-item">
              <span class="info-label">时区：</span>
              <span class="info-value">{{ systemInfo.location?.timezone || '获取中...' }}</span>
            </div>
          <div class="info-item">
            <span class="info-label">IP地址：</span>
            <span class="info-value">{{ systemInfo.ip?.internal || '获取中...' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">运行时间：</span>
            <span class="info-value">{{ formatUptime }}</span>
            </div>
          </div>
          <div class="disk-swap-chart-container">
            <div ref="diskSwapChartRef" class="disk-swap-chart"></div>
            <div class="chart-labels">
              <div class="chart-label">
                <span class="label-dot disk-dot"></span>
                <span class="label-text">硬盘: {{ systemInfo.disk?.usedPercentage || 0 }}% ({{ systemInfo.disk?.used || 0 }}/{{ systemInfo.disk?.total || 0 }} GB)</span>
              </div>
              <div class="chart-label">
                <span class="label-dot swap-dot"></span>
                <span class="label-text">交换: {{ systemInfo.swap?.usedPercentage || 0 }}% ({{ systemInfo.swap?.used || 0 }}/{{ systemInfo.swap?.total || 0 }} MB)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- CPU使用率卡片 -->
      <div class="dashboard-card">
        <div class="card-header compact">
        <h3>CPU使用率</h3>
          <div class="card-value" :class="getCpuValueClass">{{ systemInfo.cpu?.usage || 0 }}%</div>
        </div>
        
        <div class="cpu-info-container">
        <div class="info-item cpu-info">
          <span class="info-label">处理器：</span>
          <span class="info-value">{{ systemInfo.cpu?.model || '获取中...' }}</span>
        </div>
        <div class="info-item cpu-cores">
          <span class="info-label">核心数：</span>
          <span class="info-value">{{ systemInfo.cpu?.cores || '获取中...' }}</span>
          </div>
        </div>
        
        <!-- CPU实时图表 -->
        <div class="chart-container compact">
          <div ref="cpuChartRef" class="chart"></div>
        </div>
      </div>

      <!-- 内存使用情况卡片 -->
      <div class="dashboard-card">
        <div class="card-header compact">
        <h3>内存使用情况</h3>
          <div class="card-value" :class="getMemValueClass">{{ systemInfo.memory?.usedPercentage || 0 }}%</div>
          </div>
        
        <div class="memory-info compact">
          <div class="memory-item">
            <span class="memory-label">已用/总量:</span>
            <span class="memory-value">{{ systemInfo.memory?.used || 0 }}/{{ systemInfo.memory?.total || 0 }} MB</span>
          </div>
          <div class="memory-item">
            <span class="memory-label">可用:</span>
            <span class="memory-value">{{ systemInfo.memory?.free || 0 }} MB</span>
          </div>
        </div>
        
        <!-- 内存实时图表 -->
        <div class="chart-container compact">
          <div ref="memoryChartRef" class="chart"></div>
        </div>
      </div>

      <!-- 网络状态卡片 -->
      <div class="dashboard-card">
        <h3>网络状态</h3>
        <div class="network-stats compact">
          <div class="network-item">
            <span class="network-label">连接数：</span>
            <span class="network-value">{{ systemInfo.network?.connections || 0 }}</span>
          </div>
          <div class="network-item">
            <span class="network-label">输入流量：</span>
            <span class="network-value">{{ systemInfo.network?.total_rx_speed || 0 }} KB/s</span>
          </div>
          <div class="network-item">
            <span class="network-label">输出流量：</span>
            <span class="network-value">{{ systemInfo.network?.total_tx_speed || 0 }} KB/s</span>
          </div>
        </div>
        
        <!-- 网络实时图表 -->
        <div class="chart-container compact">
          <div ref="networkChartRef" class="chart"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import axios from 'axios';
import { ElMessage } from 'element-plus';
import monitoringService from '../../services/monitoring';
import * as echarts from 'echarts/core';
import { LineChart, PieChart } from 'echarts/charts';
import { 
  GridComponent, 
  TooltipComponent, 
  TitleComponent,
  LegendComponent 
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// 注册ECharts组件
echarts.use([
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
  CanvasRenderer
]);

export default defineComponent({
  name: 'MonitoringPanel',
  props: {
    serverId: {
      type: [String, Number],
      required: true
    },
    serverInfo: {
      type: Object,
      required: true
    },
    width: {
      type: Number,
      default: 450
    },
    isInstalled: {
      type: Boolean,
      default: false
    },
    isClosing: {
      type: Boolean,
      default: false
    }
  },
  emits: ['close', 'update:width', 'resize'],
  setup(props, { emit }) {
    // 状态变量
    const isResizing = ref(false);
    
    // 系统信息
    const systemInfo = ref({
      cpu: {},
      memory: {},
      swap: {},
      disk: {},
      network: {},
      os: {},
      ip: {},
      location: {},
      timestamp: null // 服务器时间戳
    });

    // 消息监听器ID
    const messageListenerIds = ref([]);

    // 图表引用
    const cpuChartRef = ref(null);
    const memoryChartRef = ref(null);
    const networkChartRef = ref(null);
    const diskSwapChartRef = ref(null);
    
    // 图表实例
    const cpuChart = ref(null);
    const memoryChart = ref(null);
    const networkChart = ref(null);
    const diskSwapChart = ref(null);
    
    // 历史数据
    const cpuHistory = ref([]);
    const memoryHistory = ref([]);
    const networkHistory = ref({
      input: [],
      output: []
    });
    
    // 时间戳数组（用于X轴）
    const timePoints = ref([]);
    
    // 最大数据点数
    const MAX_DATA_POINTS = 20;
    
    // 开始调整面板宽度
    const startResizing = (event) => {
      // 设置正在调整状态
      isResizing.value = true;
      
      // 记录初始鼠标位置和面板宽度
      const startX = event.clientX;
      const startWidth = props.width;
      
      // 创建鼠标移动和释放事件处理函数
      const handleMouseMove = (moveEvent) => {
        // 计算鼠标移动距离
        const deltaX = moveEvent.clientX - startX;
        
        // 计算新宽度（从右向左拖动，所以是减法）
        const newWidth = startWidth - deltaX;
        
        // 计算最大宽度为窗口宽度的90%
        const maxWidth = window.innerWidth * 0.95;
        
        // 设置宽度范围在 300px 到 窗口宽度的90% 之间
        if (newWidth >= 300 && newWidth <= maxWidth) {
          emit('update:width', newWidth);
          emit('resize', newWidth);
          
          // 保存宽度到本地存储
          try {
            localStorage.setItem('monitoringPanelWidth', newWidth.toString());
          } catch (error) {
            console.error('保存监控面板宽度失败:', error);
          }
        }
      };
      
      const handleMouseUp = () => {
        // 移除事件监听器
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        
        // 重置调整状态
        isResizing.value = false;
      };
      
      // 添加事件监听器
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };
    
    // 添加数据点到历史记录
    const addDataPoint = () => {
      // 使用服务器时间（如果有），否则使用当前时间
      let timeStr;
      
      if (systemInfo.value.timestamp) {
        // 如果有服务器时间戳则使用
        const serverTime = new Date(systemInfo.value.timestamp);
        timeStr = serverTime.getHours().toString().padStart(2, '0') + ':' + 
                serverTime.getMinutes().toString().padStart(2, '0') + ':' + 
                serverTime.getSeconds().toString().padStart(2, '0');
      } else {
        // 如果服务器没有提供时间戳，则使用本地时间
        const now = new Date();
        timeStr = now.getHours().toString().padStart(2, '0') + ':' + 
                now.getMinutes().toString().padStart(2, '0') + ':' + 
                now.getSeconds().toString().padStart(2, '0');
      }
      
      // 添加时间点
      timePoints.value.push(timeStr);
      if (timePoints.value.length > MAX_DATA_POINTS) {
        timePoints.value.shift();
      }
      
      // 添加CPU数据
      cpuHistory.value.push(systemInfo.value.cpu?.usage || 0);
      if (cpuHistory.value.length > MAX_DATA_POINTS) {
        cpuHistory.value.shift();
      }
      
      // 添加内存数据
      memoryHistory.value.push(systemInfo.value.memory?.usedPercentage || 0);
      if (memoryHistory.value.length > MAX_DATA_POINTS) {
        memoryHistory.value.shift();
      }
      
      // 添加网络数据
      const inputBytes = systemInfo.value.network?.total_rx_speed || 0;
      const outputBytes = systemInfo.value.network?.total_tx_speed || 0;
      
      networkHistory.value.input.push(parseFloat(inputBytes)); // KB
      networkHistory.value.output.push(parseFloat(outputBytes)); // KB
      
      if (networkHistory.value.input.length > MAX_DATA_POINTS) {
        networkHistory.value.input.shift();
      }
      if (networkHistory.value.output.length > MAX_DATA_POINTS) {
        networkHistory.value.output.shift();
      }
      
      // 更新所有图表
      updateCharts();
    };
    
    // 自定义ECharts初始化函数，强制使用被动事件监听器
    const initChartWithPassiveEvents = (dom, theme = null, opts = {}) => {
      // 保存原始的addEventListener方法
      const originalAddEventListener = EventTarget.prototype.addEventListener;
      
      // 覆盖addEventListener方法，强制添加passive标志
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        // 对于鼠标滚轮和触摸事件，强制设置为passive
        if (type === 'mousewheel' || type === 'wheel' || type === 'touchstart' || type === 'touchmove') {
          let newOptions = options;
          
          if (typeof options === 'boolean') {
            newOptions = {
              capture: options,
              passive: true
            };
          } else if (typeof options === 'object') {
            newOptions = {
              ...options,
              passive: true
            };
          } else {
            newOptions = {
              passive: true
            };
          }
          
          return originalAddEventListener.call(this, type, listener, newOptions);
        }
        
        // 对于其他事件类型，保持原样
        return originalAddEventListener.call(this, type, listener, options);
      };
      
      try {
        // 使用修改后的addEventListener初始化ECharts
        const chart = echarts.init(dom, theme, {
          renderer: 'canvas',
          useDirtyRect: true,
          ...opts
        });
        
        return chart;
      } finally {
        // 恢复原始的addEventListener方法
        EventTarget.prototype.addEventListener = originalAddEventListener;
      }
    };
    
    // 修改初始化CPU图表函数
    const initCpuChart = () => {
      if (!cpuChartRef.value) return;
      
      // 使用自定义函数替代直接调用echarts.init
      cpuChart.value = initChartWithPassiveEvents(cpuChartRef.value);
      
      const option = {
        tooltip: {
          show: true,
          trigger: 'item',
          triggerOn: 'mousemove',
          position: function (pos, params, el, elRect, size) {
            // 计算提示框位置
            const offsetX = 10; // 右侧偏移量
            const offsetY = -30; // 上方偏移量
            return [pos[0] + offsetX, pos[1] + offsetY];
          },
          axisPointer: {
          show: false
          },
          formatter: function(params) {
            // 对于item触发，params是单个对象，不是数组
            const value = parseFloat(params.value).toFixed(2);
            const time = params.name;
            return `<div style="font-weight:bold">CPU使用率</div>
                   <div style="margin:5px 0">
                     <span style="display:inline-block;margin-right:5px;border-radius:50%;width:8px;height:8px;background-color:#409EFF;"></span>
                     <span>${value}%</span>
                   </div>
                   <div style="font-size:11px;color:#ccc">时间: ${time}</div>`;
          },
          backgroundColor: 'rgba(35, 35, 35, 0.95)',
          borderColor: '#444',
          borderWidth: 1,
          padding: [8, 10],
          textStyle: {
            color: '#fff',
            fontSize: 12
          },
          extraCssText: 'box-shadow: 0 0 8px rgba(0, 0, 0, 0.3); border-radius: 4px;'
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '5%',
          top: '3%',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: timePoints.value,
          axisLine: {
            lineStyle: {
              color: '#666'
            }
          },
          axisLabel: {
            color: '#aaa',
            fontSize: 10,
            showMinLabel: true,
            showMaxLabel: true,
            formatter: function(value) {
              if (value) {
                const parts = value.split(':');
                if (parts.length === 3) {
                  // 显示完整时间 HH:MM:SS
                  return value;
                }
              }
              return value;
            }
          },
          axisPointer: {
            show: false
          }
        },
        yAxis: {
          type: 'value',
          min: 0,
          max: 100,
          splitLine: {
            lineStyle: {
              color: '#333'
            }
          },
          axisLabel: {
            color: '#aaa',
            fontSize: 10
          },
          axisPointer: {
            show: false
          }
        },
        series: [{
          name: 'CPU使用率',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          showSymbol: true,
          emphasis: {
            focus: 'series',
            scale: false,
            itemStyle: {
              color: '#409EFF',
              borderColor: '#fff',
              borderWidth: 2,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
              shadowBlur: 4
            }
          },
          tooltip: {
            show: true
          },
          sampling: 'average',
          itemStyle: {
            color: '#409EFF'
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [{
                offset: 0, color: 'rgba(64, 158, 255, 0.5)'
              }, {
                offset: 1, color: 'rgba(64, 158, 255, 0.1)'
              }]
            }
          },
          label: {
            show: false,
          },
          data: cpuHistory.value
        }]
      };
      
      cpuChart.value.setOption(option);
    };
    
    // 修改初始化内存图表函数
    const initMemoryChart = () => {
      if (!memoryChartRef.value) return;
      
      // 使用自定义函数替代直接调用echarts.init
      memoryChart.value = initChartWithPassiveEvents(memoryChartRef.value);
      
      const option = {
        tooltip: {
          show: true,
          trigger: 'item',
          triggerOn: 'mousemove',
          position: function (pos, params, el, elRect, size) {
            // 计算提示框位置
            const offsetX = 10; // 右侧偏移量
            const offsetY = -30; // 上方偏移量
            return [pos[0] + offsetX, pos[1] + offsetY];
          },
          axisPointer: {
          show: false
          },
          formatter: function(params) {
            // 对于item触发，params不是数组
            const value = parseFloat(params.value).toFixed(2);
            const time = params.name;
            return `<div style="font-weight:bold">内存使用率</div>
                   <div style="margin:5px 0">
                     <span style="display:inline-block;margin-right:5px;border-radius:50%;width:8px;height:8px;background-color:#E6A23C;"></span>
                     <span>${value}%</span>
                   </div>
                   <div style="font-size:11px;color:#ccc">时间: ${time}</div>`;
          },
          backgroundColor: 'rgba(35, 35, 35, 0.95)',
          borderColor: '#444',
          borderWidth: 1,
          padding: [8, 10],
          textStyle: {
            color: '#fff',
            fontSize: 12
          },
          extraCssText: 'box-shadow: 0 0 8px rgba(0, 0, 0, 0.3); border-radius: 4px;'
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '5%',
          top: '3%',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: timePoints.value,
          axisLine: {
            lineStyle: {
              color: '#666'
            }
          },
          axisLabel: {
            color: '#aaa',
            fontSize: 10,
            showMinLabel: true,
            showMaxLabel: true,
            formatter: function(value) {
              if (value) {
                const parts = value.split(':');
                if (parts.length === 3) {
                  // 显示完整时间 HH:MM:SS
                  return value;
                }
              }
              return value;
            }
          },
          axisPointer: {
            show: false
          }
        },
        yAxis: {
          type: 'value',
          min: 0,
          max: 100,
          splitLine: {
            lineStyle: {
              color: '#333'
            }
          },
          axisLabel: {
            color: '#aaa',
            fontSize: 10
          },
          axisPointer: {
            show: false
          }
        },
        series: [{
          name: '内存使用率',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          showSymbol: true,
          emphasis: {
            focus: 'series',
            scale: false,
            itemStyle: {
              color: '#E6A23C',
              borderColor: '#fff',
              borderWidth: 2,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
              shadowBlur: 4
            }
          },
          tooltip: {
            show: true
          },
          sampling: 'average',
          itemStyle: {
            color: '#E6A23C'
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [{
                offset: 0, color: 'rgba(230, 162, 60, 0.5)'
              }, {
                offset: 1, color: 'rgba(230, 162, 60, 0.1)'
              }]
            }
          },
          label: {
            show: false,
          },
          data: memoryHistory.value
        }]
      };
      
      memoryChart.value.setOption(option);
    };
    
    // 修改初始化网络图表函数
    const initNetworkChart = () => {
      if (!networkChartRef.value) return;
      
      // 使用自定义函数替代直接调用echarts.init
      networkChart.value = initChartWithPassiveEvents(networkChartRef.value);
      
      const option = {
        tooltip: {
          show: true,
          trigger: 'item',
          triggerOn: 'mousemove',
          position: function (pos, params, el, elRect, size) {
            // 计算提示框位置
            const offsetX = 10; // 右侧偏移量
            const offsetY = -30; // 上方偏移量
            return [pos[0] + offsetX, pos[1] + offsetY];
          },
          axisPointer: {
          show: false
          },
          formatter: function(params) {
            // 对于item触发模式，params是单个对象，不是数组
            const time = params.name;
            const color = params.color;
            const name = params.seriesName;
            const value = parseFloat(params.value).toFixed(2);
            
            return `<div style="font-weight:bold">网络流量</div>
                   <div style="margin:5px 0">
                     <span style="display:inline-block;margin-right:5px;border-radius:50%;width:8px;height:8px;background-color:${color};"></span>
                     <span>${name}: ${value} KB/s</span>
                   </div>
                   <div style="font-size:11px;color:#ccc">时间: ${time}</div>`;
          },
          backgroundColor: 'rgba(35, 35, 35, 0.95)',
          borderColor: '#444',
          borderWidth: 1,
          padding: [8, 10],
          textStyle: {
            color: '#fff',
            fontSize: 12
          },
          extraCssText: 'box-shadow: 0 0 8px rgba(0, 0, 0, 0.3); border-radius: 4px;'
        },
        legend: {
          show: true,
          bottom: 0,
          itemWidth: 12,
          itemHeight: 8,
          textStyle: {
            color: '#aaa',
            fontSize: 10
          },
          data: [
            {
              name: '输入流量',
              icon: 'rect'
            },
            {
              name: '输出流量',
              icon: 'rect'
            }
          ]
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '15%',
          top: '5%',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: timePoints.value,
          axisLine: {
            lineStyle: {
              color: '#666'
            }
          },
          axisLabel: {
            color: '#aaa',
            fontSize: 10,
            showMinLabel: true,
            showMaxLabel: true,
            formatter: function(value) {
              if (value) {
                const parts = value.split(':');
                if (parts.length === 3) {
                  // 显示完整时间 HH:MM:SS
                  return value;
                }
              }
              return value;
            }
          },
          axisPointer: {
            show: false
          }
        },
        yAxis: {
          type: 'value',
          name: 'KB',
          nameTextStyle: {
            color: '#aaa'
          },
          splitLine: {
            lineStyle: {
              color: '#333'
            }
          },
          axisLabel: {
            color: '#aaa',
            fontSize: 10
          },
          axisPointer: {
            show: false
          }
        },
        series: [
          {
            name: '输入流量',
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 8,
            showSymbol: true,
            emphasis: {
              focus: 'series',
              scale: false,
              itemStyle: {
                color: '#67C23A',
                borderColor: '#fff',
                borderWidth: 2,
                shadowColor: 'rgba(0, 0, 0, 0.5)',
                shadowBlur: 4
              }
            },
            tooltip: {
              show: true
            },
            sampling: 'average',
            itemStyle: {
              color: '#67C23A'
            },
            label: {
              show: false,
            },
            data: networkHistory.value.input
          },
          {
            name: '输出流量',
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 8,
            showSymbol: true,
            emphasis: {
              focus: 'series',
              scale: false,
              itemStyle: {
                color: '#F56C6C',
                borderColor: '#fff',
                borderWidth: 2,
                shadowColor: 'rgba(0, 0, 0, 0.5)',
                shadowBlur: 4
              }
            },
            tooltip: {
              show: true
            },
            sampling: 'average',
            itemStyle: {
              color: '#F56C6C'
            },
            label: {
              show: false,
            },
            data: networkHistory.value.output
          }
        ]
      };
      
      networkChart.value.setOption(option);
    };
    
    // 初始化磁盘和交换分区圆环图
    const initDiskSwapChart = () => {
      if (!diskSwapChartRef.value) return;
      
      // 使用自定义函数替代直接调用echarts.init
      diskSwapChart.value = initChartWithPassiveEvents(diskSwapChartRef.value);
      
      const option = {
        tooltip: {
          trigger: 'item',
          formatter: function(params) {
            if (params.seriesName === '硬盘使用情况') {
              const diskTotal = systemInfo.value.disk?.total || 0;
              const diskUsed = systemInfo.value.disk?.used || 0;
              const diskFree = systemInfo.value.disk?.free || 0;
              
              if (params.name === '硬盘已用空间') {
                return `
                  <div style="font-weight:bold;margin-bottom:3px">硬盘已用空间</div>
                  <div>使用率: ${params.value.toFixed(2)}%</div>
                  <div>已用: ${diskUsed.toFixed(2)} GB</div>
                  <div>总量: ${diskTotal.toFixed(2)} GB</div>
                `;
              } else {
                return `
                  <div style="font-weight:bold;margin-bottom:3px">硬盘可用空间</div>
                  <div>空闲率: ${params.value.toFixed(2)}%</div>
                  <div>可用: ${diskFree.toFixed(2)} GB</div>
                  <div>总量: ${diskTotal.toFixed(2)} GB</div>
                `;
              }
            } else if (params.seriesName === '交换分区使用情况') {
              const swapTotal = systemInfo.value.swap?.total || 0;
              const swapUsed = systemInfo.value.swap?.used || 0;
              const swapFree = systemInfo.value.swap?.free || 0;
              
              if (params.name === '交换分区已用空间') {
                return `
                  <div style="font-weight:bold;margin-bottom:3px">交换分区已用空间</div>
                  <div>使用率: ${params.value.toFixed(2)}%</div>
                  <div>已用: ${swapUsed.toFixed(2)} MB</div>
                  <div>总量: ${swapTotal.toFixed(2)} MB</div>
                `;
              } else {
                return `
                  <div style="font-weight:bold;margin-bottom:3px">交换分区可用空间</div>
                  <div>空闲率: ${params.value.toFixed(2)}%</div>
                  <div>可用: ${swapFree.toFixed(2)} MB</div>
                  <div>总量: ${swapTotal.toFixed(2)} MB</div>
                `;
              }
            }
            return params.name + ': ' + params.value + '%';
          },
          backgroundColor: 'rgba(30, 30, 30, 0.9)',
          borderColor: '#555',
          borderWidth: 0,
          padding: [8, 12],
          textStyle: {
            color: '#fff',
            fontSize: 12
          },
          extraCssText: 'box-shadow: 0 0 8px rgba(0, 0, 0, 0.3); border-radius: 4px;'
        },
        series: [
          {
            name: '硬盘使用情况',
            type: 'pie',
            radius: ['62%', '82%'],
            avoidLabelOverlap: false,
            silent: false,
            clockwise: true,
            startAngle: 90,
            label: {
              show: false
            },
            emphasis: {
              scale: false,
              scaleSize: 5
            },
            itemStyle: {
              borderRadius: 10,
              borderColor: '#1e1e1e',
              borderWidth: 3
            },
            data: [
              { 
                value: systemInfo.value.disk?.usedPercentage || 0, 
                name: '硬盘已用空间',
                itemStyle: {
                  color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: '#4facfe' },
                    { offset: 1, color: '#00f2fe' }
                  ])
                }
              },
              { 
                value: 100 - (systemInfo.value.disk?.usedPercentage || 0), 
                name: '硬盘可用空间',
                itemStyle: {
                  color: 'rgba(65, 65, 65, 0.2)',
                  borderColor: '#1e1e1e',
                  borderWidth: 1
                }
              }
            ],
            animationDuration: 1500,
            animationEasing: 'cubicOut'
          },
          {
            name: '交换分区使用情况',
            type: 'pie',
            radius: ['38%', '58%'],
            avoidLabelOverlap: false,
            silent: false,
            clockwise: true,
            startAngle: 90,
            label: {
              show: false
            },
            emphasis: {
              scale: false,
              scaleSize: 5
            },
            itemStyle: {
              borderRadius: 10,
              borderColor: '#1e1e1e',
              borderWidth: 3
            },
            data: [
              { 
                value: systemInfo.value.swap?.usedPercentage || 0, 
                name: '交换分区已用空间',
                itemStyle: {
                  color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                    { offset: 0, color: '#fa709a' },
                    { offset: 1, color: '#fee140' }
                  ])
                }
              },
              { 
                value: 100 - (systemInfo.value.swap?.usedPercentage || 0), 
                name: '交换分区可用空间',
                itemStyle: {
                  color: 'rgba(65, 65, 65, 0.2)',
                  borderColor: '#1e1e1e',
                  borderWidth: 1
                }
              }
            ],
            animationDuration: 1500,
            animationEasing: 'cubicOut',
            animationDelay: 300
          }
        ]
      };
      
      diskSwapChart.value.setOption(option);
    };
    
    // 更新所有图表
    const updateCharts = () => {
      // 检查图表实例是否存在且未被销毁
      if (cpuChart.value && !cpuChart.value.isDisposed()) {
        cpuChart.value.setOption({
          xAxis: {
            data: timePoints.value
          },
          series: [{
            data: cpuHistory.value
          }]
        });
      }
      
      // 检查图表实例是否存在且未被销毁
      if (memoryChart.value && !memoryChart.value.isDisposed()) {
        memoryChart.value.setOption({
          xAxis: {
            data: timePoints.value
          },
          series: [{
            data: memoryHistory.value
          }]
        });
      }
      
      // 检查图表实例是否存在且未被销毁
      if (networkChart.value && !networkChart.value.isDisposed()) {
        networkChart.value.setOption({
          xAxis: {
            data: timePoints.value
          },
          series: [
            {
              data: networkHistory.value.input
            },
            {
              data: networkHistory.value.output
            }
          ]
        });
      }
      
      // 更新磁盘和交换分区圆环图
      if (diskSwapChart.value && !diskSwapChart.value.isDisposed()) {
        diskSwapChart.value.setOption({
          series: [
            {
              data: [
                { 
                  value: systemInfo.value.disk?.usedPercentage || 0, 
                  name: '硬盘已用空间',
                  itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                      { offset: 0, color: '#4facfe' },
                      { offset: 1, color: '#00f2fe' }
                    ])
                  }
                },
                { 
                  value: 100 - (systemInfo.value.disk?.usedPercentage || 0), 
                  name: '硬盘可用空间',
                  itemStyle: {
                    color: 'rgba(65, 65, 65, 0.2)',
                    borderColor: '#1e1e1e',
                    borderWidth: 1
                  }
                }
              ]
            },
            {
              data: [
                { 
                  value: systemInfo.value.swap?.usedPercentage || 0, 
                  name: '交换分区已用空间',
                  itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                      { offset: 0, color: '#fa709a' },
                      { offset: 1, color: '#fee140' }
                    ])
                  }
                },
                { 
                  value: 100 - (systemInfo.value.swap?.usedPercentage || 0), 
                  name: '交换分区可用空间',
                  itemStyle: {
                    color: 'rgba(65, 65, 65, 0.2)',
                    borderColor: '#1e1e1e',
                    borderWidth: 1
                  }
                }
              ]
            }
          ]
        });
      }
    };
    
    // 格式化字节大小
    const formatBytes = (bytes) => {
      if (bytes === 0) return '0 B';
      
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // 格式化操作系统信息
    const formatOsInfo = computed(() => {
      if (!systemInfo.value.os) return '获取中...';
      return `${systemInfo.value.os.type || ''} ${systemInfo.value.os.platform || ''} ${systemInfo.value.os.release || ''}`;
    });

    // 格式化运行时间
    const formatUptime = computed(() => {
      if (!systemInfo.value.os?.uptime) return '获取中...';
      
      const uptime = systemInfo.value.os.uptime;
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      
      return `${days}天 ${hours}小时 ${minutes}分钟`;
    });
    
    // 获取CPU数值样式类
    const getCpuValueClass = computed(() => {
      const usage = systemInfo.value.cpu?.usage || 0;
      if (usage < 60) return 'value-normal';
      if (usage < 80) return 'value-warning';
      return 'value-danger';
    });
    
    // 获取内存数值样式类
    const getMemValueClass = computed(() => {
      const usage = systemInfo.value.memory?.usedPercentage || 0;
      if (usage < 60) return 'value-normal';
      if (usage < 80) return 'value-warning';
      return 'value-danger';
    });
    
    // 获取磁盘数值样式类
    const getDiskValueClass = computed(() => {
      const usage = systemInfo.value.disk?.usedPercentage || 0;
      if (usage < 60) return 'value-normal';
      if (usage < 80) return 'value-warning';
      return 'value-danger';
    });

    // 获取进度条样式类
    const getProgressBarClass = (percentage) => {
      if (percentage < 60) return 'progress-normal';
      if (percentage < 80) return 'progress-warning';
      return 'progress-danger';
    };

    // 处理关闭面板
    const closePanel = () => {
      // 移除消息监听器
      messageListenerIds.value.forEach(id => {
        // 检查ID前缀来确定监听器类型
        if (id.startsWith('system_stats')) {
        monitoringService.removeMessageListener('system_stats', id);
        } else if (id.startsWith('system-info')) {
          monitoringService.removeMessageListener('system-info', id);
        } else if (id.startsWith('*')) {
          monitoringService.removeMessageListener('*', id);
        } else {
          // 尝试移除其他可能的监听器
          monitoringService.removeMessageListener('system_stats', id);
          monitoringService.removeMessageListener('system-info', id);
          monitoringService.removeMessageListener('*', id);
        }
      });
      
      console.log('[监控面板] 组件卸载，已移除所有监听器');
      messageListenerIds.value = [];
      
      // 通知父组件关闭
      emit('close');
    };

    // 数据更新后刷新图表
    const dataUpdateInterval = ref(null);

    // 组件挂载时连接监控服务
    onMounted(async () => {
      console.log('[监控面板] 组件已挂载，准备接收监控数据');
      
      // 加载保存的宽度设置
      try {
        const savedWidth = localStorage.getItem('monitoringPanelWidth');
        if (savedWidth) {
          const width = parseInt(savedWidth, 10);
          const maxWidth = window.innerWidth * 0.9;
          if (!isNaN(width) && width >= 300 && width <= maxWidth) {
            emit('update:width', width);
          }
        }
      } catch (error) {
        console.error('加载监控面板宽度失败:', error);
      }
      
      try {
        // 首先检查监控服务是否已连接到相同的主机
        const isAlreadyConnected = monitoringService.state.connected && 
                                  monitoringService.state.targetHost === props.serverInfo.host;
        
        if (isAlreadyConnected) {
          console.log(`[监控面板] 监控服务已连接到 ${props.serverInfo.host}，直接使用现有连接`);
          // 已连接的情况下，立即请求刷新系统数据
          monitoringService.requestSystemStats();
        } else {
          // 如果没有连接到相同的主机，才建立新连接
          console.log(`[监控面板] 监控服务未连接到目标主机，建立新连接到 ${props.serverInfo.host}`);
          await monitoringService.connectToHost(props.serverInfo);
        }
        
        // 注册消息监听器以接收系统数据
        const statsListenerId = monitoringService.addMessageListener('system_stats', (message) => {
          if (message.payload && 
              (!message.targetHost || message.targetHost === props.serverInfo.host)) {
            // 将时间戳保存到systemInfo
            if (message.timestamp) {
              systemInfo.value.timestamp = message.timestamp;
            } else if (message.payload.timestamp) {
              systemInfo.value.timestamp = message.payload.timestamp;
            } else {
              // 如果没有时间戳，使用当前时间作为备用
              systemInfo.value.timestamp = new Date().getTime();
            }
            
            // 使用响应式方式更新数据
            Object.keys(message.payload).forEach(key => {
              if (systemInfo.value[key] !== undefined) {
                systemInfo.value[key] = message.payload[key];
              }
            });
            
            // 添加数据点到历史记录
            addDataPoint();
          }
        });
        messageListenerIds.value.push(statsListenerId);
        
        // 添加system-info消息类型的监听器
        const sysInfoListenerId = monitoringService.addMessageListener('system-info', (message) => {
          if (message.payload || message.data) {
            const data = message.payload || message.data;
            
            // 保存时间戳
            if (message.timestamp) {
              systemInfo.value.timestamp = message.timestamp;
            } else if (data.timestamp) {
              systemInfo.value.timestamp = data.timestamp;
            } else {
              // 如果没有时间戳，使用当前时间作为备用
              systemInfo.value.timestamp = new Date().getTime();
            }
            
            // 更新系统信息
            if (data.type === 'system-info' && data.data) {
              // 处理用户数据结构
              const userData = data.data;
              
              // 将各个数据部分更新到systemInfo中
              if (userData.cpu) {
                systemInfo.value.cpu = {
                  usage: userData.cpu.usage,
                  cores: userData.cpu.cores,
                  model: userData.cpu.model
                };
              }
              
              if (userData.memory) {
                systemInfo.value.memory = {
                  total: userData.memory.total,
                  used: userData.memory.used,
                  free: userData.memory.free,
                  usedPercentage: userData.memory.usedPercentage
                };
              }
              
              if (userData.swap) {
                systemInfo.value.swap = {
                  total: userData.swap.total,
                  used: userData.swap.used,
                  free: userData.swap.free,
                  usedPercentage: userData.swap.usedPercentage
                };
              }
              
              if (userData.disk) {
                systemInfo.value.disk = {
                  total: userData.disk.total,
                  used: userData.disk.used,
                  free: userData.disk.free,
                  usedPercentage: userData.disk.usedPercentage
                };
              }
              
              if (userData.network) {
                systemInfo.value.network = userData.network;
              }
              
              if (userData.os) {
                systemInfo.value.os = {
                  type: userData.os.type,
                  platform: userData.os.platform,
                  arch: userData.os.arch,
                  release: userData.os.release,
                  uptime: userData.os.uptime,
                  hostname: userData.os.hostname
                };
              }
              
              if (userData.ip) {
                systemInfo.value.ip = {
                  internal: userData.ip.internal,
                  public: userData.ip.public
                };
              }
              
              if (userData.location) {
                systemInfo.value.location = {
                  country: userData.location.country,
                  region: userData.location.region,
                  city: userData.location.city,
                  timezone: userData.location.timezone
                };
              }
              
              // 添加数据点到历史记录
              addDataPoint();
            } else {
              // 使用响应式方式更新数据
              Object.keys(data).forEach(key => {
                if (systemInfo.value[key] !== undefined) {
                  systemInfo.value[key] = data[key];
                }
              });
              
              // 添加数据点到历史记录
              addDataPoint();
            }
          }
        });
        messageListenerIds.value.push(sysInfoListenerId);
        
        // 请求最新的系统数据
        monitoringService.requestSystemStats();
        
        // 初始化图表
        nextTick(() => {
          initCpuChart();
          initMemoryChart();
          initNetworkChart();
          initDiskSwapChart();
          
          // 设置窗口大小变化时重新调整图表大小
          window.addEventListener('resize', () => {
            cpuChart.value && cpuChart.value.resize();
            memoryChart.value && memoryChart.value.resize();
            networkChart.value && networkChart.value.resize();
            diskSwapChart.value && diskSwapChart.value.resize();
          });
        });
      } catch (error) {
        console.error('[监控面板] 连接失败:', error);
        ElMessage.error('连接监控服务失败');
      }
      });

    // 组件卸载时清理
      onUnmounted(() => {
      console.log('[监控面板] 组件卸载，清理资源');
        
      // 销毁图表实例
      cpuChart.value && cpuChart.value.dispose();
      memoryChart.value && memoryChart.value.dispose();
      networkChart.value && networkChart.value.dispose();
      diskSwapChart.value && diskSwapChart.value.dispose();

      // 移除事件监听器
      window.removeEventListener('resize', () => {});
      
      // 清除数据更新定时器
      if (dataUpdateInterval.value) {
        clearInterval(dataUpdateInterval.value);
      }
    });

    return {
      systemInfo,
      isResizing,
      formatOsInfo,
      formatUptime,
      getProgressBarClass,
      formatBytes,
      cpuChartRef,
      memoryChartRef,
      networkChartRef,
      diskSwapChartRef,
      closePanel,
      startResizing,
      getCpuValueClass,
      getMemValueClass,
      getDiskValueClass
    };
  }
});
</script>

<style scoped>
.monitoring-panel {
  width: 450px;
  height: 100%;
  background-color: #1e1e1e;
  color: #f0f0f0;
  border-left: 1px solid #333;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: fixed;
  top: 45px; /* 保持在顶部工具栏下方的位置 */
  right: 0;
  bottom: 0;
  z-index: 9999; /* 高z-index确保在最上层 */
  box-shadow: -2px 0 10px rgba(0, 0, 0, 0.3);
  animation: slide-in 0.3s ease-out forwards;
  pointer-events: auto; /* 确保可以接收点击事件 */
  min-width: 300px; /* 确保最小宽度 */
}

.monitoring-panel.resizing {
  user-select: none;
}

.panel-resizer {
  width: 5px;
  height: 100%;
  background-color: transparent;
  cursor: col-resize;
  position: absolute;
  left: 0;
  top: 0;
  z-index: 10;
}

@keyframes slide-in {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

@keyframes slide-out {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(100%);
  }
}

.monitoring-panel.closing {
  animation: slide-out 0.3s ease-out forwards;
}

.panel-header {
  padding: 10px 16px;
  border-bottom: 1px solid #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #252525;
}

.panel-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
}

.close-button {
  background: none;
  border: none;
  cursor: pointer;
  color: #fff;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-right: -6px;
  transition: background-color 0.2s ease;
}

.close-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 14px 14px;
  scrollbar-width: thin;
  scrollbar-color: #444 #1e1e1e;
}

.panel-content::-webkit-scrollbar {
  width: 8px;
}

.panel-content::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.panel-content::-webkit-scrollbar-thumb {
  background-color: #444;
  border-radius: 4px;
}

/* 卡片样式 */
.dashboard-card {
  margin-top: 12px;
  padding: 14px;
  background-color: #252525;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.dashboard-card h3 {
  margin: 0 0 10px 0;
  font-size: 14px;
  font-weight: 500;
  color: #bbb;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.card-header.compact {
  margin-bottom: 8px;
}

.card-value {
  font-size: 16px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.value-normal {
  color: #409eff;
}

.value-warning {
  color: #e6a23c;
}

.value-danger {
  color: #f56c6c;
}

/* 系统信息样式 */
.system-info-container {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.info-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.disk-swap-chart-container {
  width: 160px;
  height: 160px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  flex-shrink: 0;
  padding-top: 5px;
}

.disk-swap-chart {
  width: 150px;
  height: 130px;
}

.chart-labels {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: 2px;
  gap: 5px;
  width: 100%;
  padding-left: 2px;
}

.chart-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  font-weight: 500;
  color: #eee;
  line-height: 1.2;
  width: 100%;
  white-space: nowrap;
}

.label-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 4px;
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

.disk-dot {
  background: linear-gradient(135deg, #4facfe, #00f2fe);
}

.swap-dot {
  background: linear-gradient(135deg, #fa709a, #fee140);
}

.label-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: calc(100% - 14px);
}

.info-item {
  display: flex;
}

.info-label {
  width: 80px;
  color: #aaa;
  flex-shrink: 0;
}

.info-value {
  flex: 1;
}

/* 图表容器样式 */
.chart-container {
  margin-top: 10px;
  height: 120px;
  width: 100%;
  border-radius: 4px;
  overflow: hidden;
}

.chart-container.compact {
  margin-top: 8px;
  height: 110px;
}

.chart {
  width: 100%;
  height: 100%;
}

/* 进度条样式 */
.progress-container {
  margin-bottom: 12px;
}

.progress-bar-container {
  width: 100%;
  height: 8px;
  background-color: #333;
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-normal {
  background-color: #409eff;
}

.progress-warning {
  background-color: #e6a23c;
}

.progress-danger {
  background-color: #f56c6c;
}

/* 内存详情样式 */
.memory-info, .memory-info.compact {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
}

.memory-info.compact {
  gap: 6px;
  margin-top: 5px;
}

.memory-item {
  flex: 1;
  min-width: calc(50% - 5px);
  display: flex;
}

.memory-label {
  color: #aaa;
  font-size: 12px;
}

.memory-value {
  margin-left: 4px;
  font-size: 12px;
}

.cpu-info, .cpu-cores {
  margin-bottom: 4px;
}

.network-stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.network-stats.compact {
  gap: 5px;
  margin-bottom: 8px;
}

.network-item {
  display: flex;
}

.network-label {
  width: 80px;
  color: #aaa;
  flex-shrink: 0;
}

.network-value {
  flex: 1;
}

/* CPU卡片样式 */
.card-header.compact {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.cpu-info-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-header h3 {
  margin: 0;
}
</style> 