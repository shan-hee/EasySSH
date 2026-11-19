/**
 * 监控面板骨架屏
 * 在数据加载时显示优雅的占位符
 * 使用 shadcn/ui 的 Skeleton 组件
 */

import React from 'react';
import { useTranslation } from "react-i18next";
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { MonitorPanelDensity } from '../types/metrics';

/**
 * 系统信息骨架
 */
const SystemInfoSkeleton: React.FC<{ density: MonitorPanelDensity; headerActions?: React.ReactNode }> = ({ density, headerActions }) => {
  const { t } = useTranslation("terminalMonitor");
  return (
  <div className="space-y-1">
    <div className={cn("flex items-center justify-between gap-1", density === "full" ? "h-7" : "h-6")}>
      {headerActions ? <span className="text-xs font-semibold">{t("systemInfoTitle")}</span> : <Skeleton className="h-3 w-16" />}
      {headerActions}
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
};

/**
 * CPU/网络 曲线图骨架（Area/Line Chart）
 */
function getLineSkeletonHeight(index: number): number {
  return 32 + Math.sin(index * 0.5) * 22 + (index % 4) * 4
}


const LineChartSkeleton: React.FC<{ density: MonitorPanelDensity }> = ({ density }) => (
  <div className="space-y-1">
    {/* 标题行 */}
    <div className={cn("flex justify-between items-center", density === "compact" ? "h-6" : "h-7")}>
      <Skeleton className="h-3 w-12" />
      <div className="flex gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>

    {/* 曲线图区域 */}
    <div className="relative px-2" style={{ height: density === "compact" ? 64 : 96 }}>
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

const MiniMetricSkeleton: React.FC<{ withBar?: boolean }> = ({ withBar = true }) => (
  <div className="space-y-2">
    <div className="flex justify-between items-center h-6">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-3 w-12" />
    </div>
    {withBar && <Skeleton className="h-1.5 w-full" />}
  </div>
);

/**
 * 内存 径向图骨架（Radial Chart）
 */
const RadialChartSkeleton: React.FC<{ density: MonitorPanelDensity }> = ({ density }) => {
  const chartHeight = density === "compact" ? 72 : 96;
  const ringSize = density === "compact" ? 72 : 96;

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
 * 磁盘 方格骨架（20 × 5）
 */
const WaffleSkeleton: React.FC<{ density: MonitorPanelDensity }> = ({ density }) => (
  <div className="space-y-1">
    <div className={cn("flex justify-between items-center", density === "compact" ? "h-6" : "h-7")}>
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-3 w-24" />
    </div>
    <Skeleton className="w-full aspect-[4/1]" />
  </div>
);

/**
 * 监控面板完整骨架屏
 */
export const MonitorSkeleton: React.FC<{ density?: MonitorPanelDensity; headerActions?: React.ReactNode }> = ({
  density = "full",
  headerActions,
}) => {
  if (density === "mini") {
    return (
      <div className="space-y-3">
        <SystemInfoSkeleton density={density} headerActions={headerActions} />
        <MiniMetricSkeleton />
        <MiniMetricSkeleton />
        <MiniMetricSkeleton withBar={false} />
        <MiniMetricSkeleton />
      </div>
    );
  }

  return (
    <div className={cn("w-full", density === "compact" ? "space-y-2" : "space-y-1.5")}>
      {/* 系统信息骨架 */}
      <div>
        <SystemInfoSkeleton density={density} headerActions={headerActions} />
      </div>

      {/* CPU 曲线图骨架 */}
      <div>
        <LineChartSkeleton density={density} />
      </div>

      {/* 内存 径向图骨架 */}
      <div>
        <RadialChartSkeleton density={density} />
      </div>

      {/* 网络 曲线图骨架 */}
      <div>
        <LineChartSkeleton density={density} />
      </div>

      {/* 磁盘 方格骨架 */}
      <div>
        <WaffleSkeleton density={density} />
      </div>
    </div>
  );
};
