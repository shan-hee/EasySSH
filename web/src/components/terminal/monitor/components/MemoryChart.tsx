
import React from 'react';
import { useTranslation } from "react-i18next"
import type { EChartsOption } from "echarts";
import type { MemoryData, MonitorPanelDensity } from '../types/metrics';
import { EChartsView } from "@/components/ui/echarts-view";
import { cn } from "@/lib/utils";
import { useEchartsColors, type ChartConfig } from "@/lib/echarts-theme";
import { MONITOR_COLORS } from "../constants/colors";
import { useMonitorChartTheme } from "../hooks/useMonitorChartTheme";

interface MemoryChartProps {
  data: MemoryData;
  density?: MonitorPanelDensity;
  chartHeight?: number;
}

/**
 * 图表配置
 */
const chartConfig = {
  ram: {
    label: "RAM",
    color: MONITOR_COLORS.memory.ram,
  },
  swap: {
    label: "Swap",
    color: MONITOR_COLORS.memory.swap,
  },
} satisfies ChartConfig;

/**
 * 内存使用图表组件
 * 使用 ECharts 同心环形图显示 RAM 和 Swap
 * 图表高度由监控面板密度控制
 */
export const MemoryChart: React.FC<MemoryChartProps> = React.memo(({
  data,
  density = "full",
  chartHeight,
}) => {
  const { t } = useTranslation("terminalMonitor");
  const memoryTooltipUsedLabel = t("memoryTooltipUsed");
  const chartData = React.useMemo(
    () => ({
      ramPercent: data.ram.percent,
      swapPercent: data.swap.percent,
    }),
    [data]
  );

  const colors = useEchartsColors(chartConfig);
  const chartTheme = useMonitorChartTheme();
  const ramColor = colors.ram || chartTheme.ram;
  const swapColor = colors.swap || chartTheme.swap;
  const resolvedChartHeight = chartHeight ?? (density === "compact" ? 82 : 106);
  const ringSize = density === "compact" ? Math.min(72, resolvedChartHeight) : 100;

  const option: EChartsOption = React.useMemo(() => {
    const ramPercent = Math.max(0, Math.min(100, chartData.ramPercent));
    const swapPercent = Math.max(0, Math.min(100, chartData.swapPercent));

    const ramRest = Math.max(0, 100 - ramPercent);
    const swapRest = Math.max(0, 100 - swapPercent);

    const ramBgColor = chartTheme.freeSegment;
    const swapBgColor = chartTheme.freeSegmentStrong;

    return {
      animation: true,
      animationDuration: 220,
      animationEasing: "cubicOut",
      // 慢速变化数据使用更慢的动画
      animationDurationUpdate: 300,
      animationEasingUpdate: "cubicOut",
      tooltip: {
        trigger: "item",
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
          const point = (
            Array.isArray(params) ? params[0] : params
          ) as {
            seriesName?: string
            color?: string
          } | undefined;
          if (!point) return ""
          const isRam = point.seriesName === "RAM";
          const mem = isRam ? data.ram : data.swap;
          return `
            <div style="font-size:11px;color:${chartTheme.tooltipText};">
              <div style="margin-bottom:4px;">${isRam ? "RAM" : "Swap"}</div>
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${point.color};"></span>
                <span>${memoryTooltipUsedLabel}</span>
                <span style="font-family:var(--font-jetbrains-mono),ui-monospace;font-weight:600;">
                  ${mem.value} ${mem.unit}
                </span>
              </div>
              <div style="padding-left:14px;font-weight:600;">
                ${mem.percent}%
              </div>
            </div>
          `;
        },
      },
      series: [
        {
          name: "RAM",
          type: "pie",
          // 外圈：RAM
          radius: ["62%", "80%"],
          center: ["50%", "50%"],
          silent: false,
          // 为避免悬浮时颜色丢失，完全关闭高亮，只保留 tooltip
          emphasis: {
            disabled: true,
          },
          // 圆角环形效果（添加微妙阴影）
          itemStyle: {
            borderRadius: 8,
            shadowColor: chartTheme.shadow,
            shadowBlur: 8,
            shadowOffsetY: 2,
          },
          label: { show: false },
          labelLine: { show: false },
          data: [
            {
              value: ramPercent,
              name: "used",
              itemStyle: { color: ramColor },
            },
            {
              value: ramRest,
              name: "rest",
              itemStyle: { color: ramBgColor },
              tooltip: { show: false },
            },
          ],
        },
        {
          name: "Swap",
          type: "pie",
          // 内圈：Swap
          radius: ["40%", "56%"],
          center: ["50%", "50%"],
          silent: false,
          emphasis: {
            disabled: true,
          },
          itemStyle: {
            borderRadius: 8,
            shadowColor: chartTheme.shadow,
            shadowBlur: 8,
            shadowOffsetY: 2,
          },
          label: { show: false },
          labelLine: { show: false },
          data: [
            {
              value: swapPercent,
              name: "used",
              itemStyle: { color: swapColor },
            },
            {
              value: swapRest,
              name: "rest",
              itemStyle: { color: swapBgColor },
              tooltip: { show: false },
            },
          ],
        },
      ],
    };
  }, [chartData, ramColor, swapColor, data, memoryTooltipUsedLabel, chartTheme]);

  if (density === "mini") {
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-center h-6">
          <span className="text-xs font-semibold">{t("memoryLabel")}</span>
        </div>
        <div className="space-y-2">
          {[
            { label: "RAM", value: data.ram, color: ramColor },
            { label: "Swap", value: data.swap, color: swapColor },
          ].map((item) => (
            <div key={item.label} className="space-y-1">
              <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="font-medium" style={{ color: item.color }}>
                    {item.label}
                  </span>
                </div>
                <span className="min-w-0 truncate font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {item.value.percent}% · {item.value.value} {item.value.unit}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max(0, Math.min(100, item.value.percent))}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* 标题栏 - 高度 28px */}
      <div className={cn("flex justify-between items-center", density === "compact" ? "h-6" : "h-7")}>
        <span className="text-xs font-semibold">{t("memoryLabel")}</span>
      </div>

      {/* 图表区域 - 高度由监控面板密度控制,左文右图 */}
      <div className={cn("flex items-center", density === "compact" ? "gap-2" : "gap-3")} style={{ height: resolvedChartHeight }}>
        {/* 左侧:文字信息 */}
        <div className={cn("flex-1 text-xs min-w-0", density === "compact" ? "space-y-2" : "space-y-3")}>
          {/* RAM 信息 */}
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: ramColor }}
              />
              <span
                className="font-medium"
                style={{ color: ramColor }}
              >
                RAM
              </span>
              <span
                className="text-xs font-mono font-semibold tabular-nums"
                style={{ color: ramColor }}
              >
                {data.ram.percent}%
              </span>
            </div>
            <div className="text-muted-foreground font-mono tabular-nums text-[11px] pl-3.5">
              {data.ram.value} {data.ram.unit} / {data.ram.total} {data.ram.totalUnit}
            </div>
          </div>

          {/* Swap 信息 */}
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: swapColor }}
              />
              <span
                className="font-medium"
                style={{ color: swapColor }}
              >
                Swap
              </span>
              <span
                className="text-xs font-mono font-semibold tabular-nums"
                style={{ color: swapColor }}
              >
                {data.swap.percent}%
              </span>
            </div>
            <div className="text-muted-foreground font-mono tabular-nums text-[11px] pl-3.5">
              {data.swap.value} {data.swap.unit} / {data.swap.total} {data.swap.totalUnit}
            </div>
          </div>
        </div>

        {/* 右侧:径向条形图 */}
        <div className="relative flex-shrink-0" style={{ width: ringSize, height: ringSize }}>
          <EChartsView
            className="h-full w-full"
            option={option}
            notMerge={false}
            lazyUpdate
          />
        </div>
      </div>
    </div>
  );
});

MemoryChart.displayName = 'MemoryChart';
