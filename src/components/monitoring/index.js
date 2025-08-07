/**
 * 监控组件模块导出
 * 
 * 这个模块导出了EasySSH系统监控的所有组件：
 * - ResponsiveMonitoringPanel: 响应式监控面板主组件
 * - SystemInfo: 系统信息组件
 * - CpuMonitoring: CPU监控组件
 * - MemoryMonitoring: 内存监控组件
 * - NetworkMonitoring: 网络监控组件
 * - DiskMonitoring: 硬盘监控组件
 * - ToolbarMonitoring: 工具栏监控组件（现有）
 */

// 导入所有监控组件
import ResponsiveMonitoringPanel from './ResponsiveMonitoringPanel.vue'
import MobileMonitoringDrawer from './MobileMonitoringDrawer.vue'
import SystemInfo from './SystemInfo.vue'
import CpuMonitoring from './CpuMonitoring.vue'
import MemoryMonitoring from './MemoryMonitoring.vue'
import NetworkMonitoring from './NetworkMonitoring.vue'
import DiskMonitoring from './DiskMonitoring.vue'
import ToolbarMonitoring from './ToolbarMonitoring.vue'

// 默认导出主面板组件
export default ResponsiveMonitoringPanel

// 命名导出所有组件
export {
  ResponsiveMonitoringPanel,
  MobileMonitoringDrawer,
  SystemInfo,
  CpuMonitoring,
  MemoryMonitoring,
  NetworkMonitoring,
  DiskMonitoring,
  ToolbarMonitoring
}

// 组件安装函数（用于Vue插件）
export const install = (app) => {
  app.component('ResponsiveMonitoringPanel', ResponsiveMonitoringPanel)
  app.component('MobileMonitoringDrawer', MobileMonitoringDrawer)
  app.component('SystemInfo', SystemInfo)
  app.component('CpuMonitoring', CpuMonitoring)
  app.component('MemoryMonitoring', MemoryMonitoring)
  app.component('NetworkMonitoring', NetworkMonitoring)
  app.component('DiskMonitoring', DiskMonitoring)
  app.component('ToolbarMonitoring', ToolbarMonitoring)
}

// 组件信息
export const componentInfo = {
  name: 'EasySSH Monitoring Components',
  version: '1.0.0',
  description: '响应式系统监控组件集合',
  components: [
    {
      name: 'ResponsiveMonitoringPanel',
      description: '响应式监控面板主组件，集成所有监控功能',
      props: ['visible', 'monitoringData', 'terminalId', 'showHeader'],
      events: ['close', 'toggle-collapse']
    },
    {
      name: 'MobileMonitoringDrawer',
      description: '移动端监控抽屉组件，提供侧边滑入的监控面板',
      props: ['visible', 'monitoringData', 'terminalId'],
      events: ['close', 'update:visible'],
      features: ['侧边滑入动画', '触摸手势支持', '遮罩层交互', 'ESC键关闭']
    },
    {
      name: 'SystemInfo',
      description: '系统信息文字描述组件',
      props: ['monitoringData'],
      features: ['操作系统信息', 'CPU型号', '系统架构', '负载信息', '运行时间']
    },
    {
      name: 'CpuMonitoring',
      description: 'CPU使用率实时折线图组件',
      props: ['monitoringData'],
      features: ['实时CPU使用率', '历史数据图表', '核心数显示', '使用率警告']
    },
    {
      name: 'MemoryMonitoring',
      description: '内存监控双环图组件',
      props: ['monitoringData'],
      features: ['物理内存使用率', 'Swap使用率', '双环图显示', '容量信息']
    },
    {
      name: 'NetworkMonitoring',
      description: '网络流量实时折线图组件',
      props: ['monitoringData'],
      features: ['上传下载速度', '实时流量图表', '累计流量统计', '双线显示']
    },
    {
      name: 'DiskMonitoring',
      description: '硬盘监控3D圆柱图组件',
      props: ['monitoringData'],
      features: ['3D圆柱显示', '使用率可视化', '读写速度', '容量信息']
    },
    {
      name: 'ToolbarMonitoring',
      description: '工具栏监控组件（现有）',
      props: ['terminalId'],
      features: ['简化指标显示', '实时数据更新', '状态指示器']
    }
  ]
}
