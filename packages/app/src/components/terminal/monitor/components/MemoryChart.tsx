
import React from 'react';
import { useTranslation } from "react-i18next"
import type { EChartsOption } from "echarts";
import type { MemoryData, MonitorPanelDensity } from '../types/metrics';
import { EChartsView } from "@/components/ui/echarts-view";
import { formatBytes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useMonitorChartTheme } from "../hooks/useMonitorChartTheme";

interface MemoryChartProps {
  data: MemoryData;
  density?: MonitorPanelDensity;
  chartHeight?: number;
}

const MiniMemoryChart: React.FC<Pick<MemoryChartProps, "data">> = ({ data }) => {
  const { t } = useTranslation("terminalMonitor");
  const chartTheme = useMonitorChartTheme();

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center h-6">
        <span className="text-xs font-semibold">{t("memoryLabel")}</span>
      </div>
      <div className="space-y-2">
        {[
          { label: "RAM", value: data.ram, color: chartTheme.ram },
          { label: "Swap", value: data.swap, color: chartTheme.swap },
        ].map((item) => (
          <div key={item.label} className="space-y-1">
            <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="font-medium" style={{ color: item.color }}>{item.label}</span>
              </div>
              <span className="min-w-0 truncate font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                {item.value.percent}% · {item.value.value} {item.value.unit}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(0, Math.min(100, item.value.percent))}%`, backgroundColor: item.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const MemoryLegend: React.FC<{
  label: string;
  color: string;
  value: MemoryData["ram"] | MemoryData["swap"];
  children?: React.ReactNode;
}> = ({ label, color, value, children }) => (
  <div className="space-y-0.5">
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="font-medium" style={{ color }}>{label}</span>
      <span className="text-xs font-mono font-semibold tabular-nums" style={{ color }}>{value.percent}%</span>
    </div>
    <div className="truncate whitespace-nowrap text-muted-foreground font-mono tabular-nums text-[11px] pl-3.5">
      {value.value} {value.unit} / {value.total} {value.totalUnit}
    </div>
    {children}
  </div>
);

const FullMemoryChart: React.FC<MemoryChartProps> = ({
  data,
  density = "full",
  chartHeight,
}) => {
  const { t } = useTranslation("terminalMonitor");
  const chartTheme = useMonitorChartTheme();
  const resolvedChartHeight = chartHeight ?? (density === "compact" ? 84 : 96);
  const ringSize = Math.min(density === "compact" ? 72 : 96, resolvedChartHeight);
  const cacheColor = chartTheme.ramCache;

  const option: EChartsOption = React.useMemo(() => {
    const clamp = (value: number) => Math.max(0, Math.min(100, value));
    const ramUsed = clamp(data.ram.percent);
    const ramCache = clamp(Math.min(data.ram.cachePercent, 100 - ramUsed));
    const swapUsed = clamp(data.swap.percent);
    const ring = (name: string, radius: [string, string]) => ({
      name,
      type: "pie" as const,
      radius,
      center: ["50%", "50%"],
      emphasis: { disabled: true },
      itemStyle: { borderRadius: 8, shadowColor: chartTheme.shadow, shadowBlur: 8, shadowOffsetY: 2 },
      label: { show: false },
      labelLine: { show: false },
    });
    const segment = (name: string, value: number, color: string, detail?: string) => ({
      name,
      value,
      detail,
      itemStyle: { color },
      ...(detail ? {} : { tooltip: { show: false } }),
    });

    return {
      animation: true,
      animationDuration: 220,
      animationEasing: "cubicOut",
      animationDurationUpdate: 300,
      animationEasingUpdate: "cubicOut",
      tooltip: {
        trigger: "item",
        borderRadius: 6,
        padding: 8,
        backgroundColor: chartTheme.tooltipBackground,
        borderColor: chartTheme.tooltipBorder,
        borderWidth: 1,
        textStyle: { fontSize: 11, color: chartTheme.tooltipText },
        formatter: (params) => {
          const point = (Array.isArray(params) ? params[0] : params) as { name?: string; color?: string; data?: { detail?: string } } | undefined;
          if (!point?.data?.detail) return "";
          return `
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:${chartTheme.tooltipText};">
              <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${point.color};"></span>
              <span>${point.name}</span>
              <span style="font-family:var(--font-jetbrains-mono),ui-monospace;font-weight:600;">${point.data.detail}</span>
            </div>
          `;
        },
      },
      series: [
        {
          ...ring("RAM", ["62%", "80%"]),
          data: [
            segment(t("memoryAppLabel"), ramUsed, chartTheme.ram, `${data.ram.formatted} · ${data.ram.percent}%`),
            segment(t("memoryCacheLabel"), ramCache, cacheColor, `${formatBytes(data.ram.cacheBytes).formatted} · ${data.ram.cachePercent}%`),
            segment("rest", Math.max(0, 100 - ramUsed - ramCache), chartTheme.freeSegment),
          ],
        },
        {
          ...ring("Swap", ["40%", "56%"]),
          data: [
            segment("Swap", swapUsed, chartTheme.swap, `${data.swap.formatted} · ${data.swap.percent}%`),
            segment("rest", Math.max(0, 100 - swapUsed), chartTheme.freeSegmentStrong),
          ],
        },
      ],
    };
  }, [data, t, chartTheme, cacheColor]);

  return (
    <div className="space-y-1">
      <div className={cn("flex items-center", density === "full" ? "h-7" : "h-6")}>
        <span className="text-xs font-semibold">{t("memoryLabel")}</span>
      </div>

      <div className={cn("flex items-center", density === "compact" ? "gap-2" : "gap-3")} style={{ height: resolvedChartHeight }}>
        <div className={cn("flex-1 text-xs min-w-0", density === "compact" ? "space-y-1.5" : "space-y-2.5")}>
          {/* RAM = 应用（已用）+ 缓存（可回收）；百分比只计应用 */}
          <MemoryLegend label="RAM" color={chartTheme.ram} value={data.ram}>
            {data.ram.cacheBytes > 0 && (
              <div className="flex items-center gap-1.5 pl-3.5 text-[11px] text-muted-foreground">
                <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: cacheColor }} />
                <span>{t("memoryCacheLabel")}</span>
                <span className="font-mono tabular-nums">{formatBytes(data.ram.cacheBytes).formatted}</span>
              </div>
            )}
          </MemoryLegend>
          <MemoryLegend label="Swap" color={chartTheme.swap} value={data.swap} />
        </div>
        <div className="relative flex-shrink-0" style={{ width: ringSize, height: ringSize }}>
          <EChartsView className="h-full w-full" option={option} notMerge={false} lazyUpdate />
        </div>
      </div>
    </div>
  );
};

export const MemoryChart: React.FC<MemoryChartProps> = React.memo((props) => (
  props.density === "mini"
    ? <MiniMemoryChart data={props.data} />
    : <FullMemoryChart {...props} />
));

MemoryChart.displayName = 'MemoryChart';
