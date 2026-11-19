
import React from 'react';
import { useTranslation } from "react-i18next"
import type { EChartsOption } from "echarts";
import type { MonitorPanelDensity, NetworkData, NetworkInterfaceData } from '../types/metrics';
import { EChartsView } from "@/components/ui/echarts-view";
import { cn } from "@/lib/utils";
import { useMonitorChartTheme } from "../hooks/useMonitorChartTheme";

interface NetworkChartProps {
  data: NetworkData[];
  current: { download: number; upload: number };
  interfaces: NetworkInterfaceData[];
  interfaceHistory: Record<string, NetworkData[]>;
  density?: MonitorPanelDensity;
  chartHeight?: number;
}

type Speed = { download: number; upload: number };

/**
 * 格式化速率 (自动转换单位)
 */
function formatSpeed(kbps: number): string {
  if (kbps >= 1024) {
    return `${(kbps / 1024).toFixed(1)}MB/s`;
  }
  return `${kbps.toFixed(0)}KB/s`;
}

const formatYAxisTick = (value: number): string => {
  if (value === 0) return '0';
  if (value >= 1024) return `${(value / 1024).toFixed(0)}M`;
  return `${value}K`;
};

// 只有一张网卡时标题直接用网卡名，多张时标题用"网络"、数值为合计。
const titleOf = (interfaces: NetworkInterfaceData[], fallback: string) =>
  interfaces.length === 1 ? interfaces[0].name : fallback;

const Speeds: React.FC<{ speed: Speed; className?: string }> = ({ speed, className }) => {
  const chartTheme = useMonitorChartTheme();
  return (
    <div className={cn("flex items-center gap-2 font-mono font-semibold tabular-nums", className)}>
      <span style={{ color: chartTheme.download }}>↓ {formatSpeed(speed.download)}</span>
      <span style={{ color: chartTheme.upload }}>↑ {formatSpeed(speed.upload)}</span>
    </div>
  );
};

const MiniNetworkChart: React.FC<Pick<NetworkChartProps, "interfaces" | "current">> = ({ interfaces, current }) => {
  const { t } = useTranslation("terminalMonitor");

  return (
    <div className="flex justify-between items-center h-6 gap-2">
      <span className="min-w-0 truncate text-xs font-semibold">{titleOf(interfaces, t("networkLabel"))}</span>
      <Speeds speed={current} className="text-[11px]" />
    </div>
  );
};

/**
 * 合计流量面积图（下行、上行各一层）；悬浮列出该时刻每张网卡的流量
 */
const FullNetworkChart: React.FC<NetworkChartProps> = ({
  data,
  current,
  interfaces,
  interfaceHistory,
  density = "full",
  chartHeight,
}) => {
  const { t } = useTranslation("terminalMonitor");
  const chartTheme = useMonitorChartTheme();
  const resolvedChartHeight = chartHeight ?? (density === "compact" ? 64 : 96);

  // 为 Y 轴添加一些上方留白（增加 20%），最小值为 1（避免除零）
  const dataMax = data.length > 0 ? Math.max(...data.map((d) => Math.max(d.download, d.upload))) : 0;
  const targetMaxValue = Math.max(Math.ceil(dataMax * 1.2), 1);
  const [maxValue, setMaxValue] = React.useState(targetMaxValue);

  // 让 Y 轴在峰值上升时快速跟随，下降时平滑回落，减少视觉抖动
  React.useEffect(() => {
    setMaxValue((prev) => {
      if (targetMaxValue >= prev) return targetMaxValue;
      return Math.max(targetMaxValue, prev - Math.max(1, Math.ceil((prev - targetMaxValue) * 0.25)));
    });
  }, [targetMaxValue, data]);

  const yAxisTicks = [0, Math.round(maxValue * 0.33), Math.round(maxValue * 0.66), Math.round(maxValue)];

  const option: EChartsOption = React.useMemo(() => {
    const area = (color: string, values: number[]) => ({
      type: "line" as const,
      smooth: true,
      smoothMonotone: "x" as const,
      showSymbol: false,
      lineStyle: { width: 1.5, color },
      areaStyle: { opacity: 0.22, color },
      emphasis: { disabled: true },
      data: values,
    });
    const speedCell = (value: number, color: string, arrow: string) =>
      `<span style="color:${color};font-family:var(--font-jetbrains-mono),ui-monospace;font-weight:600;text-align:right;">${arrow} ${formatSpeed(value)}</span>`;
    const row = (label: string, speed: Speed, strong = false) => `
      <span style="${strong ? "font-weight:600;" : ""}">${label}</span>
      ${speedCell(speed.download, chartTheme.download, "↓")}
      ${speedCell(speed.upload, chartTheme.upload, "↑")}`;

    return {
      animation: true,
      animationDuration: 220,
      animationEasing: "cubicOut",
      animationDurationUpdate: 150,
      animationEasingUpdate: "cubicOut",
      grid: { left: 28, right: 8, top: 8, bottom: 16 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line", animation: false },
        borderRadius: 6,
        padding: 8,
        backgroundColor: chartTheme.tooltipBackground,
        borderColor: chartTheme.tooltipBorder,
        borderWidth: 1,
        textStyle: { fontSize: 11, color: chartTheme.tooltipText },
        formatter: (params) => {
          const first = (Array.isArray(params) ? params[0] : params) as { dataIndex?: number } | undefined;
          const point = first?.dataIndex === undefined ? undefined : data[first.dataIndex];
          if (!point) return "";
          // 按时间戳对齐每张网卡的采样（网卡可能晚于合计出现）
          const perInterface = interfaces.length > 1
            ? interfaces
              .map((iface) => ({ name: iface.name, row: interfaceHistory[iface.name]?.find((item) => item.timestamp === point.timestamp) }))
              .filter((item): item is { name: string; row: NetworkData } => Boolean(item.row))
            : [];
          return `
            <div style="font-size:11px;color:${chartTheme.tooltipText};">
              <div style="margin-bottom:4px;">${point.time}</div>
              <div style="display:grid;grid-template-columns:auto auto auto;column-gap:10px;row-gap:2px;">
                ${perInterface.length > 0
                  ? row(t("networkTotalLabel"), point, true) + perInterface.map((item) => row(item.name, item.row)).join("")
                  : row(titleOf(interfaces, t("networkLabel")), point)}
              </div>
            </div>
          `;
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: data.map((item) => item.time.slice(3, 8)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: chartTheme.axisLabel, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: maxValue,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: true, lineStyle: { color: chartTheme.gridLine, type: "dashed" } },
      },
      series: [
        area(chartTheme.download, data.map((item) => item.download)),
        area(chartTheme.upload, data.map((item) => item.upload)),
      ],
    };
  }, [data, interfaces, interfaceHistory, maxValue, t, chartTheme]);

  return (
    <div className="space-y-1">
      <div className={cn("flex items-center justify-between gap-2", density === "full" ? "h-7" : "h-6")}>
        <span className="min-w-0 truncate text-xs font-semibold">{titleOf(interfaces, t("networkLabel"))}</span>
        <Speeds speed={current} className="text-xs" />
      </div>

      <div className="w-full relative" style={{ height: resolvedChartHeight }}>
        <div className="absolute left-1 top-2 bottom-4 flex flex-col justify-between text-[9px] text-muted-foreground/70 pointer-events-none z-10">
          {[...yAxisTicks].reverse().map((value, idx) => (
            <span key={idx} className="leading-none">
              {value === 0 ? '' : formatYAxisTick(value)}
            </span>
          ))}
        </div>

        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            {t("waitingData")}
          </div>
        ) : (
          <EChartsView className="h-full w-full" option={option} notMerge={false} lazyUpdate />
        )}
      </div>
    </div>
  );
};

export const NetworkChart: React.FC<NetworkChartProps> = React.memo((props) => (
  props.density === "mini"
    ? <MiniNetworkChart interfaces={props.interfaces} current={props.current} />
    : <FullNetworkChart {...props} />
));

NetworkChart.displayName = 'NetworkChart';
