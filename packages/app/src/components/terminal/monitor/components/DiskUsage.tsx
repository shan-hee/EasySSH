
import React from 'react';
import { useTranslation } from "react-i18next"
import type { DiskData, MonitorPanelDensity } from '../types/metrics';
import { formatBytes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMonitorChartTheme } from "../hooks/useMonitorChartTheme";
import { MonitorSectionHeader, useSectionExpanded } from "./MonitorSection";

interface DiskUsageProps {
  data: DiskData[];
  density?: MonitorPanelDensity;
}

const WAFFLE_COLUMNS = 20;
const INODE_WARNING_PERCENT = 80;

const percentClassName = (percent: number) =>
  percent > 90 ? 'text-destructive' : percent > 80 ? 'text-status-warning' : 'text-muted-foreground';

const shortBytes = (bytes: number) => formatBytes(bytes, 1).formatted;

const MiniDiskUsage: React.FC<{ disk?: DiskData }> = ({ disk }) => {
  const { t } = useTranslation("terminalMonitor");
  const chartTheme = useMonitorChartTheme();
  const percent = disk?.percent ?? 0;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center h-6 gap-2">
        <span className="min-w-0 truncate text-xs font-semibold">{disk?.name ?? t("diskLabel")}</span>
        <span className={cn("text-xs font-mono font-semibold tabular-nums transition-colors duration-500", percentClassName(percent))}>
          {percent}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: chartTheme.disk }}
        />
      </div>
    </div>
  );
};

const DiskDetails: React.FC<{ disk: DiskData }> = ({ disk }) => {
  const { t } = useTranslation("terminalMonitor");
  const rows: Array<[string, string]> = [
    [t("diskTooltipUsed"), `${disk.formatted} · ${disk.percent}%`],
    [t("diskTooltipFree"), formatBytes(Math.max(0, disk.totalBytes - disk.usedBytes)).formatted],
    [t("diskTooltipTotal"), `${disk.total} ${disk.totalUnit}`],
  ];
  if (disk.inodePercent !== null) rows.push(["inode", `${disk.inodePercent}%`]);

  return (
    <div className="space-y-0.5">
      <div className="font-semibold">{disk.name}</div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono tabular-nums">{value}</span>
        </div>
      ))}
      {(disk.fsType || disk.device) && (
        <div className="text-muted-foreground">{[disk.fsType, disk.device].filter(Boolean).join(" · ")}</div>
      )}
    </div>
  );
};

/**
 * 100 个方格，每格 1%，已用部分着色；悬浮显示容量、文件系统和 inode
 */
const DiskWaffle: React.FC<{ disk: DiskData }> = ({ disk }) => {
  const chartTheme = useMonitorChartTheme();
  const filled = disk.percent > 0 ? Math.max(1, Math.round(disk.percent)) : 0;
  const color = disk.percent > 90 ? chartTheme.danger : disk.percent > 80 ? chartTheme.warning : chartTheme.disk;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${WAFFLE_COLUMNS}, minmax(0, 1fr))` }}>
          {Array.from({ length: 100 }, (_, index) => (
            <div
              key={index}
              className="aspect-square rounded-[2px] transition-colors duration-500"
              style={{ backgroundColor: index < filled ? color : chartTheme.freeSegmentStrong }}
            />
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="px-2 py-1.5">
        <DiskDetails disk={disk} />
      </TooltipContent>
    </Tooltip>
  );
};

const inodeWarning = (disk: DiskData) =>
  disk.inodePercent !== null && disk.inodePercent >= INODE_WARNING_PERCENT ? disk.inodePercent : null;

// 默认显示根目录（后端已把 "/" 排在第一位）；选中的挂载点消失后回到第一个。
function pickDisk(disks: DiskData[], selected: string | null) {
  return disks.find((disk) => disk.name === selected) ?? disks[0];
}

const FullDiskUsage: React.FC<DiskUsageProps> = ({
  data,
  density = "full",
}) => {
  const { t } = useTranslation("terminalMonitor");
  const [selected, setSelected] = React.useState<string | null>(null);
  const disk = pickDisk(data, selected);
  const expandable = data.length > 1;
  const expanded = useSectionExpanded("disk", expandable);
  const diskInode = disk ? inodeWarning(disk) : null;

  return (
    <div className="space-y-1">
      <MonitorSectionHeader section="disk" title={disk?.name ?? t("diskLabel")} expandable={expandable} density={density}>
        {disk && (
          <div className="flex items-center gap-2 text-xs font-mono font-semibold tabular-nums">
            <span className="text-muted-foreground">{shortBytes(disk.usedBytes)} / {shortBytes(disk.totalBytes)}</span>
            <span className={cn("transition-colors duration-500", percentClassName(disk.percent))}>{disk.percent}%</span>
          </div>
        )}
      </MonitorSectionHeader>

      {disk ? (
        <>
          <DiskWaffle disk={disk} />
          {diskInode !== null && (
            <div className={cn("text-[11px] font-mono tabular-nums", percentClassName(diskInode))}>inode {diskInode}%</div>
          )}
        </>
      ) : (
        <div className="flex h-12 items-center justify-center text-xs text-muted-foreground">{t("waitingData")}</div>
      )}

      {expanded && (
        <div className="space-y-px pt-1">
          {data.map((item) => {
            const itemInode = inodeWarning(item);
            return (
              <button
                key={item.name}
                type="button"
                aria-pressed={item.name === disk?.name}
                onClick={() => setSelected(item.name)}
                className={cn(
                  "flex h-6 w-full items-center gap-2 rounded px-1.5 text-[11px] hover:bg-muted/60",
                  item.name === disk?.name && "bg-muted",
                )}
              >
                <span className="min-w-0 truncate" title={item.name}>{item.name}</span>
                {itemInode !== null && (
                  <span className={cn("shrink-0 font-mono tabular-nums", percentClassName(itemInode))}>inode {itemInode}%</span>
                )}
                <span className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground">
                  {shortBytes(item.usedBytes)} / {shortBytes(item.totalBytes)}
                </span>
                <span className={cn("w-8 shrink-0 text-right font-mono font-semibold tabular-nums", percentClassName(item.percent))}>
                  {item.percent}%
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const DiskUsage: React.FC<DiskUsageProps> = React.memo((props) => (
  props.density === "mini"
    ? <MiniDiskUsage disk={props.data[0]} />
    : <FullDiskUsage {...props} />
));

DiskUsage.displayName = 'DiskUsage';
