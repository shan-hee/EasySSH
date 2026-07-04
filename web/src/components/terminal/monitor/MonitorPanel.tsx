/**
 * 系统监控主面板组件
 * 固定宽度 280px，高度跟随父容器
 * 整合所有监控子组件,实现紧凑美观的布局
 * 使用 WebSocket + Protobuf 二进制传输获取真实监控数据
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/format-utils';
import type { MonitorMetrics } from './hooks/useMonitorWebSocket';
import type { MonitorPanelDensity } from './types/metrics';
import { useMonitoringData } from './contexts/MonitorWebSocketContext';
import { SystemInfo } from './components/SystemInfo';
import { CPUChart } from './components/CPUChart';
import { MemoryChart } from './components/MemoryChart';
import { NetworkChart } from './components/NetworkChart';
import { DiskUsage } from './components/DiskUsage';
import { MonitorSkeleton } from './components/MonitorSkeleton';

const EMPTY_METRICS_HISTORY: MonitorMetrics[] = [];
const COMPACT_HEIGHT_THRESHOLD = 700;
// 这里读到的是终端内容区高度，不是桌面窗口外框高度；500px 能让 620px 桌面窗口落在 compact。
const MINI_HEIGHT_THRESHOLD = 500;

const DENSITY_LAYOUT: Record<MonitorPanelDensity, {
  contentClassName: string;
  cpuChartHeight: number;
  memoryChartHeight: number;
  networkChartHeight: number;
  diskChartHeight: number;
}> = {
  full: {
    contentClassName: "py-1.5 px-3 space-y-1.5",
    cpuChartHeight: 106,
    memoryChartHeight: 106,
    networkChartHeight: 106,
    diskChartHeight: 106,
  },
  compact: {
    contentClassName: "py-1.5 px-3 space-y-2",
    cpuChartHeight: 64,
    memoryChartHeight: 74,
    networkChartHeight: 64,
    diskChartHeight: 62,
  },
  mini: {
    contentClassName: "py-2 px-3 space-y-3",
    cpuChartHeight: 0,
    memoryChartHeight: 0,
    networkChartHeight: 0,
    diskChartHeight: 0,
  },
};

interface MonitorPanelProps {
  className?: string;
  isLive?: boolean;
}

/**
 * 监控面板主组件
 *
 * 从 MonitorWebSocketContext 获取监控数据
 * 必须在 MonitorWebSocketProvider 内部使用
 *
 * 性能优化：使用 useMonitoringData() 只订阅监控数据
 * 避免在延迟数据更新时不必要的重新渲染
 *
 * 宽度: 280px (固定宽度)
 * 高度: 跟随父容器，按可用高度切换 full / compact / mini 三档
 */
export const MonitorPanel: React.FC<MonitorPanelProps> = ({
  className,
  isLive = true,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  // 【性能优化】只订阅监控数据，不订阅延迟数据
  const { metrics, getMetricsHistory } = useMonitoringData();
  const [frozenSnapshot, setFrozenSnapshot] = useState<{
    metrics: typeof metrics;
    history: ReturnType<typeof getMetricsHistory>;
  }>(() => ({
    metrics: null,
    history: [],
  }));
  const liveHistory = isLive ? getMetricsHistory() : EMPTY_METRICS_HISTORY;

  useEffect(() => {
    if (!isLive) return;

    const frame = window.requestAnimationFrame(() => {
      setFrozenSnapshot({
        metrics,
        history: liveHistory,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isLive, metrics, liveHistory]);

  const displayMetrics = isLive ? metrics : frozenSnapshot.metrics;
  const displayHistory = isLive ? liveHistory : frozenSnapshot.history;
  const density = useMemo<MonitorPanelDensity>(() => {
    if (panelHeight === null) return "full";
    if (panelHeight < MINI_HEIGHT_THRESHOLD) return "mini";
    if (panelHeight < COMPACT_HEIGHT_THRESHOLD) return "compact";
    return "full";
  }, [panelHeight]);
  const layout = DENSITY_LAYOUT[density];

  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const nextHeight = Math.round(node.getBoundingClientRect().height);
        setPanelHeight((currentHeight) => (
          currentHeight === nextHeight ? currentHeight : nextHeight
        ));
      });
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(node);

      return () => {
        window.cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }

    window.addEventListener("resize", measure);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, []);

  // 转换数据格式以适配现有组件
  const formattedMetrics = useMemo(() => {
    if (!displayMetrics) return null;

    // 格式化运行时间
    const formatUptime = (seconds: number): string => {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${days}d ${hours}h ${minutes}m`;
    };

    // 构建历史数据（用于图表）
    // 使用历史数据队列，而不是单个数据点
    const cpuHistory = displayHistory.map((m) => {
      const time = new Date(m.timestamp * 1000);
      return {
        time: time.toTimeString().split(' ')[0],
        usage: Math.round(m.cpu.usagePercent),
        timestamp: time.getTime(),
      };
    });

    const networkHistory = displayHistory.map((m) => {
      const time = new Date(m.timestamp * 1000);
      return {
        time: time.toTimeString().split(' ')[0],
        download: Math.round(m.network.bytesRecvPerSec / 1024), // bytes to KB
        upload: Math.round(m.network.bytesSentPerSec / 1024),
        timestamp: time.getTime(),
      };
    });

    return {
      systemInfo: {
        os: displayMetrics.systemInfo.os,
        hostname: displayMetrics.systemInfo.hostname,
        cpu: displayMetrics.systemInfo.cpuModel,
        arch: displayMetrics.systemInfo.arch,
        load: displayMetrics.systemInfo.loadAvg,
        uptime: formatUptime(displayMetrics.systemInfo.uptimeSeconds),
      },
      cpuHistory: cpuHistory,
      currentCPU: Math.round(displayMetrics.cpu.usagePercent),
      memory: {
        ram: {
          ...formatBytes(displayMetrics.memory.ramUsedBytes),
          total: formatBytes(displayMetrics.memory.ramTotalBytes).value,
          totalUnit: formatBytes(displayMetrics.memory.ramTotalBytes).unit,
          percent: displayMetrics.memory.ramTotalBytes > 0
            ? Math.round((displayMetrics.memory.ramUsedBytes / displayMetrics.memory.ramTotalBytes) * 100)
            : 0,
        },
        swap: {
          ...formatBytes(displayMetrics.memory.swapUsedBytes),
          total: formatBytes(displayMetrics.memory.swapTotalBytes).value,
          totalUnit: formatBytes(displayMetrics.memory.swapTotalBytes).unit,
          percent: displayMetrics.memory.swapTotalBytes > 0
            ? Math.round((displayMetrics.memory.swapUsedBytes / displayMetrics.memory.swapTotalBytes) * 100)
            : 0,
        },
      },
      networkHistory: networkHistory,
      currentNetwork: {
        download: Math.round(displayMetrics.network.bytesRecvPerSec / 1024),
        upload: Math.round(displayMetrics.network.bytesSentPerSec / 1024),
      },
      disks: displayMetrics.disks.map(disk => ({
        name: disk.mountPoint,
        usedBytes: disk.usedBytes,
        totalBytes: disk.totalBytes,
        ...formatBytes(disk.usedBytes),
        total: formatBytes(disk.totalBytes).value,
        totalUnit: formatBytes(disk.totalBytes).unit,
        percent: disk.totalBytes > 0
          ? Math.round((disk.usedBytes / disk.totalBytes) * 100)
          : 0,
      })),
      diskTotalPercent: Math.round(displayMetrics.diskTotalPercent),
    };
  }, [displayMetrics, displayHistory]);

  const panelContent = useMemo(() => {
    if (!formattedMetrics) {
      return <MonitorSkeleton density={density} />;
    }

    return (
      <>
        <SystemInfo data={formattedMetrics.systemInfo} density={density} />

        <CPUChart
          data={formattedMetrics.cpuHistory}
          currentUsage={formattedMetrics.currentCPU}
          density={density}
          chartHeight={layout.cpuChartHeight}
        />

        <MemoryChart
          data={formattedMetrics.memory}
          density={density}
          chartHeight={layout.memoryChartHeight}
        />

        <NetworkChart
          data={formattedMetrics.networkHistory}
          currentDownload={formattedMetrics.currentNetwork.download}
          currentUpload={formattedMetrics.currentNetwork.upload}
          density={density}
          chartHeight={layout.networkChartHeight}
        />

        <DiskUsage
          data={formattedMetrics.disks}
          totalPercent={formattedMetrics.diskTotalPercent}
          density={density}
          chartHeight={layout.diskChartHeight}
        />
      </>
    );
  }, [formattedMetrics, density, layout]);

  return (
    <div
      ref={panelRef}
      data-monitor-density={density}
      className={cn(
        "w-[280px] h-full min-h-0 flex-shrink-0 overflow-hidden",
        className
      )}
    >
      <div
        className={cn(
          "h-full min-h-0 overflow-y-auto monitor-panel-scrollbar",
          layout.contentClassName
        )}
      >
        {panelContent}
      </div>
    </div>
  );
};

MonitorPanel.displayName = 'MonitorPanel';
