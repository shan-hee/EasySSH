/**
 * 系统监控主面板组件
 * 跟随停靠区域尺寸，底部停靠时横向展示图表
 * 整合所有监控子组件,实现紧凑美观的布局
 * 使用 WebSocket + Protobuf 二进制传输获取真实监控数据
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { createMonitorViewData } from './monitor-view-data';
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
  horizontal?: boolean;
  headerActions?: React.ReactNode;
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
const MonitorPanelComponent: React.FC<MonitorPanelProps> = ({
  className,
  isLive = true,
  horizontal = false,
  headerActions,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const { metrics, getMetricsHistory } = useMonitoringData();
  const frozenSnapshotRef = useRef<{
    metrics: typeof metrics;
    history: ReturnType<typeof getMetricsHistory>;
  }>({
    metrics: null,
    history: [],
  });
  const liveHistory = isLive ? getMetricsHistory() : EMPTY_METRICS_HISTORY;

  useEffect(() => {
    if (!isLive) return;

    frozenSnapshotRef.current = {
      metrics,
      history: [...liveHistory],
    };
  }, [isLive, liveHistory, metrics]);

  const displayMetrics = isLive ? metrics : frozenSnapshotRef.current.metrics;
  const displayHistory = isLive ? liveHistory : frozenSnapshotRef.current.history;
  const density = useMemo<MonitorPanelDensity>(() => {
    if (horizontal) return "compact";
    if (panelHeight === null) return "full";
    if (panelHeight < MINI_HEIGHT_THRESHOLD) return "mini";
    if (panelHeight < COMPACT_HEIGHT_THRESHOLD) return "compact";
    return "full";
  }, [horizontal, panelHeight]);
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

  const projectMetrics = useMemo(() => createMonitorViewData(), []);
  const formattedMetrics = useMemo(
    () => projectMetrics(displayMetrics, displayHistory, density),
    [projectMetrics, displayMetrics, displayHistory, density],
  );

  const panelContent = useMemo(() => {
    if (!formattedMetrics) {
      return <MonitorSkeleton density={density} headerActions={headerActions} />;
    }

    return (
      <>
        <SystemInfo data={formattedMetrics.systemInfo} density={density} headerActions={headerActions} />

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
  }, [formattedMetrics, density, layout, headerActions]);

  return (
    <div
      ref={panelRef}
      data-monitor-density={density}
      className={cn(
        "w-full h-full min-h-0 min-w-0 overflow-hidden",
        className
      )}
    >
      <div
        className={cn(
          "h-full min-h-0 overflow-y-auto monitor-panel-scrollbar",
          horizontal ? "grid grid-cols-[repeat(5,minmax(200px,1fr))] items-start gap-4 overflow-x-auto px-3 py-2" : layout.contentClassName
        )}
      >
        {panelContent}
      </div>
    </div>
  );
};

export const MonitorPanel = React.memo(MonitorPanelComponent);
MonitorPanel.displayName = 'MonitorPanel';
