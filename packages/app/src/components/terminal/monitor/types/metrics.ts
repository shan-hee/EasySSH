/**
 * 系统监控数据类型定义
 */

export type MonitorPanelDensity = "full" | "compact" | "mini";

/**
 * 系统基础信息
 */
export interface SystemInfo {
  os: string;          // 操作系统 "Ubuntu 22.04 LTS"
  hostname: string;    // 主机名 "web-server-01"
  cpu: string;         // CPU型号 "Intel Core i7-9700K"
  arch: string;        // 架构 "x86_64"
  load: string;        // 系统负载 "0.45, 0.32, 0.28"
  uptime: string;      // 运行时间 "15d 6h 23m"
}

/**
 * CPU 小图数据：cores[核心][采样] 与 times[采样] 对齐；perCore 为 false 时只有一格总使用率
 */
export interface CPUHistory {
  perCore: boolean;
  times: string[];     // "14:23:45"
  cores: number[][];   // 使用率 0-100
}

interface MemoryValue {
  value: number;       // 数值（根据 unit 决定单位）
  unit: string;        // 单位 "B" | "KB" | "MB" | "GB"
  formatted: string;   // 格式化字符串 "3.28 GB"
  total: number;       // 总容量（数值）
  totalUnit: string;   // 总容量单位
  percent: number;     // 使用率 0-100
}

/**
 * 内存使用数据
 */
export interface MemoryData {
  ram: MemoryValue & {
    cacheBytes: number;   // 可回收缓存
    cachePercent: number;
  };
  swap: MemoryValue;
}

/**
 * 网络流量数据点
 */
export interface NetworkData {
  time: string;        // 时间
  download: number;    // 下行速率 KB/s
  upload: number;      // 上行速率 KB/s
  timestamp?: number;  // 时间戳（毫秒），用于 ECharts time 轴
}

/**
 * 单个网卡当前速率
 */
export interface NetworkInterfaceData {
  name: string;
  download: number;    // KB/s
  upload: number;      // KB/s
}

/**
 * 磁盘使用数据
 */
export interface DiskData extends MemoryValue {
  name: string;        // 挂载点名称 "/" 或 "/home"
  device: string;      // 设备 "/dev/sda1"
  fsType: string;      // 文件系统类型
  usedBytes: number;   // 已使用字节数
  totalBytes: number;  // 总容量字节数
  inodePercent: number | null; // inode 使用率，文件系统不支持时为 null
}

/**
 * 完整的系统指标数据
 */
export interface SystemMetrics {
  systemInfo: SystemInfo;
  cpuHistory: CPUHistory;
  currentCPU: number;
  currentCPUWait: number;
  peakCore: { index: number; usage: number } | null; // 使用率最高的核心，单核时为 null
  memory: MemoryData;
  currentNetwork: { download: number; upload: number };
  networkHistory: NetworkData[];                   // 合计（物理网卡 + 默认路由网卡）
  interfaces: NetworkInterfaceData[];              // 默认路由网卡在前；桌面轮询时为空
  interfaceHistory: Record<string, NetworkData[]>; // 按网卡名索引
  disks: DiskData[];
}
