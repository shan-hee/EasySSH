
import React from 'react';
import { useTranslation } from "react-i18next"
import type { EChartsOption } from "echarts";
import type { CPUHistory, MonitorPanelDensity } from '../types/metrics';
import { EChartsView } from "@/components/ui/echarts-view";
import { cn } from "@/lib/utils";
import { useMonitorChartTheme } from "../hooks/useMonitorChartTheme";

interface CPUChartProps {
  history: CPUHistory;
  currentUsage: number;
  currentWait: number;
  peakCore: { index: number; usage: number } | null;
  density?: MonitorPanelDensity;
  chartHeight?: number;
}

// 悬浮提示列出全部核心，核心多时分列排布，避免提示框过长
const tooltipColumns = (cores: number) => (cores <= 8 ? 1 : cores <= 32 ? 2 : 4);

const usageClassName = (usage: number) =>
  usage > 80 ? 'text-destructive' : usage > 60 ? 'text-status-warning' : 'text-muted-foreground';

const Usage: React.FC<Omit<CPUChartProps, "history" | "density" | "chartHeight">> = ({
  currentUsage,
  currentWait,
  peakCore,
}) => {
  const { t } = useTranslation("terminalMonitor");
  const chartTheme = useMonitorChartTheme();

  return (
    <div className="flex items-center gap-2 text-xs font-mono font-semibold tabular-nums">
      {currentWait > 0 && (
        <span className="flex items-center gap-1 text-muted-foreground" title={`${t("cpuIowaitLabel")} + ${t("cpuStealLabel")}`}>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: chartTheme.cpuWait }} />
          {t("cpuWaitLabel")} {currentWait}%
        </span>
      )}
      {peakCore && (
        <span className={cn("flex items-center gap-1", usageClassName(peakCore.usage))} title={t("cpuPeakCoreLabel")}>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: chartTheme.cpu }} />
          C{peakCore.index} {peakCore.usage}%
        </span>
      )}
      <span className={cn("transition-colors duration-500", usageClassName(currentUsage))}>
        {currentUsage}%
      </span>
    </div>
  );
};

const MiniCPUChart: React.FC<Omit<CPUChartProps, "history" | "density" | "chartHeight">> = (props) => {
  const { t } = useTranslation("terminalMonitor");
  const chartTheme = useMonitorChartTheme();

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center h-6">
        <span className="text-xs font-semibold">{t("cpuLabel")}</span>
        <Usage {...props} />
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(0, Math.min(100, props.currentUsage))}%`,
            backgroundColor: chartTheme.cpu,
          }}
        />
      </div>
    </div>
  );
};

/**
 * 一张图里每个核心一条线：最忙的核心用主色高亮（核号见标题栏），其余核心为浅灰细线。
 * 悬浮按时间列出该时刻各核数值（从高到低）。没有每核数据时退化为一条总使用率面积线。
 */
const FullCPUChart: React.FC<CPUChartProps> = ({
  history,
  currentUsage,
  currentWait,
  peakCore,
  density = "full",
  chartHeight,
}) => {
  const { t } = useTranslation("terminalMonitor");
  const chartTheme = useMonitorChartTheme();
  const resolvedChartHeight = chartHeight ?? (density === "compact" ? 64 : 96);
  const highlighted = history.perCore ? peakCore?.index ?? -1 : 0;

  // 动态 Y 轴上限：根据所有核心的最大值自适应，并限制在 [20, 100] 区间内
  const dataMax = Math.max(0, ...history.cores.flat());
  const maxValue = React.useMemo(() => {
    if (dataMax <= 0) return 100;
    // 取 20 的倍数，四等分刻度都是 5 的倍数
    const stepped = Math.ceil((dataMax * 1.2) / 20) * 20;
    return Math.min(100, Math.max(20, stepped));
  }, [dataMax]);

  const yAxisTicks = React.useMemo(() => [
    0,
    Math.round(maxValue * 0.25),
    Math.round(maxValue * 0.5),
    Math.round(maxValue * 0.75),
    Math.round(maxValue),
  ], [maxValue]);

  const option: EChartsOption = React.useMemo(() => {
    const coreName = (core: number) => (history.perCore ? `C${core}` : t("cpuLabel"));

    return {
      animation: true,
      animationDuration: 200,
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
          const index = first?.dataIndex;
          if (index === undefined) return "";
          const ranked = history.cores
            .map((samples, core) => ({ core, usage: samples[index] ?? 0 }))
            .sort((a, b) => b.usage - a.usage);
          const rows = ranked.map(({ core, usage }) => `
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${core === highlighted ? chartTheme.cpu : chartTheme.cpuOther};"></span>
              <span>${coreName(core)}</span>
              <span style="margin-left:auto;padding-left:12px;font-family:var(--font-jetbrains-mono),ui-monospace;font-weight:600;">${usage}%</span>
            </div>`).join("");
          return `
            <div style="font-size:11px;color:${chartTheme.tooltipText};">
              <div style="margin-bottom:4px;">${history.times[index] ?? ""}</div>
              <div style="display:grid;grid-template-columns:repeat(${tooltipColumns(ranked.length)},minmax(80px,auto));column-gap:14px;row-gap:2px;">
                ${rows}
              </div>
            </div>
          `;
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        // 显示用的时间（mm:ss），保持与网络图一致
        data: history.times.map((time) => time.slice(3, 8)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: chartTheme.axisLabel, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: maxValue,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: true, lineStyle: { color: chartTheme.gridLine, type: "dashed" } },
      },
      series: history.cores.map((samples, core) => {
        const active = core === highlighted;
        const color = active ? chartTheme.cpu : chartTheme.cpuOther;
        return {
          name: coreName(core),
          type: "line" as const,
          smooth: true,
          smoothMonotone: "x" as const,
          showSymbol: false,
          // 高亮线画在最上层
          z: active ? 3 : 2,
          lineStyle: { width: active ? 2 : 1, color },
          ...(history.perCore ? {} : { areaStyle: { opacity: 0.25, color } }),
          emphasis: { disabled: true },
          data: samples,
        };
      }),
    };
  }, [history, highlighted, maxValue, t, chartTheme]);

  return (
    <div className="space-y-1">
      <div className={cn("flex items-center justify-between gap-2", density === "full" ? "h-7" : "h-6")}>
        <span className="text-xs font-semibold">{t("cpuLabel")}</span>
        <Usage currentUsage={currentUsage} currentWait={currentWait} peakCore={peakCore} />
      </div>

      <div className="w-full relative" style={{ height: resolvedChartHeight }}>
        <div className="absolute left-1 top-2 bottom-4 flex flex-col justify-between text-[9px] text-muted-foreground/70 pointer-events-none z-10">
          {[...yAxisTicks].reverse().map((value, idx) => (
            <span key={idx} className="leading-none">
              {value === 0 ? '' : value}
            </span>
          ))}
        </div>

        {history.cores.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            {t("waitingData")}
          </div>
        ) : (
          // 核心数变化（热插拔、换回退数据）时重建图表，避免合并后残留旧核心的线
          <EChartsView key={history.cores.length} className="h-full w-full" option={option} notMerge={false} lazyUpdate />
        )}
      </div>
    </div>
  );
};

export const CPUChart: React.FC<CPUChartProps> = React.memo((props) => (
  props.density === "mini"
    ? <MiniCPUChart currentUsage={props.currentUsage} currentWait={props.currentWait} peakCore={props.peakCore} />
    : <FullCPUChart {...props} />
));

CPUChart.displayName = 'CPUChart';
