
import React from 'react';
import { useTranslation } from "react-i18next"
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import type { DiskData } from '../types/metrics';
import { formatBytes } from "@/lib/format-utils";
import {
  ChartConfig,
  ChartContainer,
} from "@/components/ui/chart";
import { useEchartsColors } from "@/lib/echarts-theme";
import { MONITOR_COLORS } from "../constants/colors";
import { useMonitorChartTheme } from "../hooks/useMonitorChartTheme";

interface DiskUsageProps {
  data: DiskData[];
  totalPercent: number;
}

const DISK_COLOR_VARS = MONITOR_COLORS.disk.usedPalette;

function formatCompactBytes(bytes: number): string {
  const formatted = formatBytes(Math.max(0, bytes));
  return `${formatted.value}${formatted.unit}`;
}

/**
 * 磁盘使用组件
 * 使用 ECharts 堆叠条形图显示磁盘使用情况
 * 固定高度 142px
 */
export const DiskUsage: React.FC<DiskUsageProps> = React.memo(({ data, totalPercent }) => {
  const { t } = useTranslation("terminalMonitor");
  // 转换数据格式为图表需要的格式
  const chartData = React.useMemo(
    () =>
      data.map((disk) => ({
        name: disk.name,
        used: disk.usedBytes,
        free: Math.max(0, disk.totalBytes - disk.usedBytes),
        total: disk.totalBytes,
        percent: disk.percent,
        usedLabel: `${disk.value} ${disk.unit}`,
        freeLabel: formatBytes(Math.max(0, disk.totalBytes - disk.usedBytes)).formatted,
        totalLabel: `${disk.total} ${disk.totalUnit}`,
      })),
    [data]
  );
  const axis = React.useMemo(() => {
    const totals = chartData
      .map((item) => Number.isFinite(item.total) ? item.total : 0);
    const maxTotal = totals.length > 0 ? Math.max(...totals) : undefined;

    return { maxTotal };
  }, [chartData]);

  const colorConfig = React.useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    const count = Math.max(chartData.length, 1);
    for (let i = 0; i < count; i += 1) {
      config[`disk_${i}`] = {
        label: `disk_${i}`,
        color: DISK_COLOR_VARS[i % DISK_COLOR_VARS.length],
      };
    }
    return config;
  }, [chartData.length]);

  const colors = useEchartsColors(colorConfig);
  const chartTheme = useMonitorChartTheme();
  const diskColors = React.useMemo(
    () =>
      chartData.map(
        (_, index) =>
          colors[`disk_${index}`] ||
          chartTheme.diskPalette[index % chartTheme.diskPalette.length]
      ),
    [chartData, colors, chartTheme.diskPalette]
  );
  const freeSegmentColor = chartTheme.freeSegmentStrong;

  const option: EChartsOption = React.useMemo(() => {
    const names = chartData.map((item) => item.name);
    // 使用当前数据中的最大容量作为 X 轴上限，兼容汇总盘与多挂载点两种数据形态
    const maxTotal = axis.maxTotal;

    return {
      animation: true,
      animationDuration: 220,
      animationEasing: "cubicOut",
      // 慢速变化数据使用更慢的动画
      animationDurationUpdate: 300,
      animationEasingUpdate: "cubicOut",
      grid: {
        // 与上方图表对齐, 不再给左侧名称预留空间
        left: 12,
        right: 12,
        top: 8,
        bottom: 8,
      },
      legend: { show: false },
      tooltip: {
        // 仅针对当前条形项显示 tooltip，不使用轴高亮阴影
        trigger: "item",
        axisPointer: { type: "none" },
        borderRadius: 6,
        padding: 8,
        backgroundColor: chartTheme.tooltipBackground,
        borderColor: chartTheme.tooltipBorder,
        borderWidth: 1,
        textStyle: {
          fontSize: 11,
          color: chartTheme.tooltipText,
        },
        formatter: (params) => {
          const list = (Array.isArray(params) ? params : [params]) as Array<{
            color?: string
            data?: {
              used?: number
              value?: number
              free?: number
              total?: number
              usedLabel?: string
              freeLabel?: string
              totalLabel?: string
              usedColor?: string
              freeColor?: string
              percent?: number
            }
          }>;
          if (!list.length) return "";
          const base = list[0];
          const data = base.data || {};
          const used = data.used ?? data.value ?? 0;
          const free = data.free ?? 0;
          const total = data.total ?? (used + free);
          const usedColor =
            data.usedColor ??
            base.color ??
            chartTheme.diskPalette[0];
          const freeColor =
            data.freeColor ??
            freeSegmentColor;
          const percent = data.percent ?? 0;
          const usedDisplay = data.usedLabel || formatBytes(used).formatted;
          const freeDisplay = data.freeLabel || formatBytes(free).formatted;
          const totalDisplay = data.totalLabel || formatBytes(total).formatted;

          const percentColor =
            percent > 90
              ? chartTheme.danger
              : percent > 80
              ? chartTheme.warning
              : chartTheme.tooltipText;

          return `
            <div style="font-size:11px;color:${chartTheme.tooltipText};">
              <div style="margin-bottom:4px;">${t("diskTooltipTotal")}: ${totalDisplay}</div>
              <div style="margin-bottom:2px;display:flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${usedColor};"></span>
                <span>${t("diskTooltipUsed")}:</span>
                <span style="font-family:var(--font-jetbrains-mono),ui-monospace;font-weight:600;">
                  ${usedDisplay}
                </span>
              </div>
              <div style="margin-bottom:2px;display:flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${freeColor};"></span>
                <span>${t("diskTooltipFree")}:</span>
                <span style="font-family:var(--font-jetbrains-mono),ui-monospace;font-weight:600;">
                  ${freeDisplay}
                </span>
              </div>
              <div style="padding-left:14px;font-weight:600;color:${percentColor};">
                ${percent}%
              </div>
            </div>
          `;
        },
      },
      xAxis: {
        type: "value",
        max: maxTotal,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: chartTheme.axisLabel,
          fontSize: 9,
          // 强制显示最大值标签
          showMaxLabel: true,
          showMinLabel: true,
          formatter: (value: number) => {
            // 对于最大值，显示2位小数
            if (maxTotal && Math.abs(value - maxTotal) < 0.01) {
              return formatCompactBytes(maxTotal);
            }
            // 其他刻度显示整数
            return formatCompactBytes(value);
          },
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: chartTheme.gridLine,
            type: "dashed",
          },
        },
      },
      yAxis: {
        type: "category",
        data: names,
        axisLine: { show: false },
        axisTick: { show: false },
        // 不显示左侧挂载点名称, 只保留进度条
        axisLabel: { show: false },
      },
      series: [
        {
          name: "used",
          type: "bar",
          stack: "total",
          barWidth: chartData.length === 1 ? 30 : 18,
          itemStyle: {
            borderRadius: [4, 0, 0, 4],
          },
          // 悬浮时仅显示 tooltip，不改变条形样式
          emphasis: {
            disabled: true,
          },
          data: chartData.map((item, index) => ({
            value: item.used,
            ...item,
            usedColor: diskColors[index],
            freeColor: freeSegmentColor,
            itemStyle: {
              color: diskColors[index],
              borderRadius: [4, 0, 0, 4],
            },
          })),
        },
        {
          name: "free",
          type: "bar",
          stack: "total",
          barWidth: chartData.length === 1 ? 30 : 18,
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
          },
          emphasis: {
            disabled: true,
          },
          data: chartData.map((item, index) => ({
            value: item.free,
            ...item,
            usedColor: diskColors[index],
            freeColor: freeSegmentColor,
            itemStyle: {
              color: freeSegmentColor,
              borderRadius: [0, 4, 4, 0],
            },
          })),
        },
      ],
    };
  }, [axis, chartData, diskColors, t, chartTheme, freeSegmentColor]);

  return (
    <div className="space-y-1">
      {/* 标题栏 - 高度 28px */}
      <div className="flex justify-between items-center h-7">
        <span className="text-xs font-semibold">{t("diskLabel")}</span>
        <span className={`text-xs font-mono font-semibold tabular-nums transition-colors duration-500 ${
          totalPercent > 90 ? 'text-destructive' : totalPercent > 80 ? 'text-status-warning' : 'text-muted-foreground'
        }`}>
          {totalPercent}%
        </span>
      </div>

      {/* 图表区域 - 固定高度 106px */}
      <div className="h-[106px] w-full">
        <ChartContainer config={colorConfig} className="h-full w-full aspect-auto">
          {() => (
            <ReactECharts
              option={option}
              style={{ width: "100%", height: "100%" }}
              notMerge={false}
              lazyUpdate={true}
            />
          )}
        </ChartContainer>
      </div>
    </div>
  );
});

DiskUsage.displayName = 'DiskUsage';
