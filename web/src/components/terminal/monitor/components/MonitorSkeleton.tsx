/**
 * 监控面板骨架屏
 * 在数据加载时显示优雅的占位符
 * 使用 shadcn/ui 的 Skeleton 组件
 */

import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { MonitorPanelDensity } from '../types/metrics';

/**
 * 系统信息骨架
 */
const SystemInfoSkeleton: React.FC<{ density: MonitorPanelDensity }> = ({ density }) => (
  <div className="space-y-1">
    <div className={cn("flex items-center", density === "full" ? "h-7" : "h-6")}>
      <Skeleton className="h-3 w-16" />
    </div>
    <div className="space-y-0">
      {Array.from({ length: density === "full" ? 6 : density === "compact" ? 3 : 2 }).map((_, i) => (
        <div key={i} className="flex justify-between items-center h-5 px-1.5">
          <Skeleton className="h-2.5 w-12" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      ))}
    </div>
  </div>
);

/**
 * CPU/网络 曲线图骨架（Area/Line Chart）
 */
function getLineSkeletonHeight(index: number): number {
  return 32 + Math.sin(index * 0.5) * 22 + (index % 4) * 4
}

function getBarSkeletonWidth(index: number): string {
  return `${62 + index * 16}%`
}

const LineChartSkeleton: React.FC<{
  showPercentage?: boolean;
  density: MonitorPanelDensity;
}> = ({
  showPercentage = true,
  density,
}) => (
  <div className="space-y-1">
    {/* 标题行 */}
    <div className={cn("flex justify-between items-center", density === "compact" ? "h-6" : "h-7")}>
      <Skeleton className="h-3 w-12" />
      {showPercentage ? (
        <Skeleton className="h-3 w-10" />
      ) : (
        <div className="flex gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
      )}
    </div>

    {/* 曲线图区域 */}
    <div className="relative px-2" style={{ height: density === "compact" ? 64 : 106 }}>
      {/* Y轴刻度 */}
      <div className="absolute left-1 top-2 bottom-4 flex flex-col justify-between">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-2 w-4" />
        ))}
      </div>

      {/* 模拟曲线 */}
      <div className="h-full flex items-end justify-between gap-0.5 pl-6 pr-1 pb-2">
        {Array.from({ length: 20 }).map((_, i) => {
          const height = getLineSkeletonHeight(i);
          return (
            <Skeleton
              key={i}
              className="flex-1"
              style={{
                height: `${height}%`,
                minWidth: '2px',
              }}
            />
          );
        })}
      </div>

      {/* X轴刻度 */}
      <div className="absolute bottom-0 left-6 right-1 flex justify-between">
        <Skeleton className="h-2 w-8" />
        <Skeleton className="h-2 w-8" />
      </div>
    </div>
  </div>
);

const MiniMetricSkeleton: React.FC<{ twoColumns?: boolean }> = ({ twoColumns = false }) => (
  <div className="space-y-2">
    <div className="flex justify-between items-center h-6">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-3 w-12" />
    </div>
    {twoColumns ? (
      <div className="grid grid-cols-2 gap-1.5">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    ) : (
      <Skeleton className="h-1.5 w-full" />
    )}
  </div>
);

/**
 * 内存 径向图骨架（Radial Chart）
 */
const RadialChartSkeleton: React.FC<{ density: MonitorPanelDensity }> = ({ density }) => {
  const chartHeight = density === "compact" ? 74 : 106;
  const ringSize = density === "compact" ? 72 : 100;

  return (
  <div className="space-y-1">
    {/* 标题行 */}
    <div className={cn("flex justify-between items-center", density === "compact" ? "h-6" : "h-7")}>
      <Skeleton className="h-3 w-12" />
    </div>

    {/* 径向图区域 */}
    <div className={cn("flex items-center", density === "compact" ? "gap-2" : "gap-3")} style={{ height: chartHeight }}>
      {/* 左侧：文字信息 */}
      <div className="flex-1 space-y-3">
        {/* RAM */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Skeleton className="w-2 h-2 rounded-full" />
            <Skeleton className="h-2.5 w-10" />
            <Skeleton className="h-2.5 w-8" />
          </div>
          <Skeleton className="h-2 w-24 ml-3.5" />
        </div>

        {/* Swap */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Skeleton className="w-2 h-2 rounded-full" />
            <Skeleton className="h-2.5 w-10" />
            <Skeleton className="h-2.5 w-8" />
          </div>
          <Skeleton className="h-2 w-24 ml-3.5" />
        </div>
      </div>

      {/* 右侧：圆形图 */}
      <div className="flex-shrink-0 flex items-center justify-center" style={{ width: ringSize, height: ringSize }}>
        <Skeleton className="w-20 h-20 rounded-full" />
      </div>
    </div>
  </div>
  );
};

/**
 * 磁盘 柱状图骨架（Bar Chart）
 */
const BarChartSkeleton: React.FC<{ density: MonitorPanelDensity }> = ({ density }) => (
  <div className="space-y-1">
    {/* 标题行 */}
    <div className={cn("flex justify-between items-center", density === "compact" ? "h-6" : "h-7")}>
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-3 w-10" />
    </div>

    {/* 柱状图区域 */}
    <div className="flex flex-col justify-center gap-2 px-2" style={{ height: density === "compact" ? 70 : 106 }}>
      {/* 水平柱状条 */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          {/* 标签 */}
          <Skeleton className="h-3 w-12 flex-shrink-0" />
          {/* 柱状条 */}
          <Skeleton
            className="h-6 flex-1"
            style={{
              width: getBarSkeletonWidth(i),
            }}
          />
        </div>
      ))}
    </div>
  </div>
);

/**
 * 监控面板完整骨架屏
 */
export const MonitorSkeleton: React.FC<{ density?: MonitorPanelDensity }> = ({
  density = "full",
}) => {
  if (density === "mini") {
    return (
      <div className="space-y-3">
        <SystemInfoSkeleton density={density} />
        <MiniMetricSkeleton />
        <MiniMetricSkeleton />
        <MiniMetricSkeleton twoColumns />
        <MiniMetricSkeleton />
      </div>
    );
  }

  return (
    <div className={cn("w-full", density === "compact" ? "space-y-2" : "space-y-1.5")}>
      {/* 系统信息骨架 - 148px */}
      <div>
        <SystemInfoSkeleton density={density} />
      </div>

      {/* CPU 曲线图骨架 - 134px */}
      <div>
        <LineChartSkeleton showPercentage={true} density={density} />
      </div>

      {/* 内存 径向图骨架 - 134px */}
      <div>
        <RadialChartSkeleton density={density} />
      </div>

      {/* 网络 曲线图骨架 - 134px */}
      <div>
        <LineChartSkeleton showPercentage={false} density={density} />
      </div>

      {/* 磁盘 柱状图骨架 - 134px */}
      <div>
        <BarChartSkeleton density={density} />
      </div>
    </div>
  );
};
