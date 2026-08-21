/**
 * 系统信息组件
 * 显示OS、主机名、CPU、架构、负载、运行时间等基础信息
 * 支持点击复制功能
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from "react-i18next"
import { Check, Copy } from 'lucide-react';
import type { MonitorPanelDensity, SystemInfo as SystemInfoType } from '../types/metrics';
import { cn } from '@/lib/utils';

interface SystemInfoProps {
  data: SystemInfoType;
  density?: MonitorPanelDensity;
}

/**
 * 信息行组件
 */
const InfoRow = React.memo(function InfoRow({
  label,
  value,
  monospace = false,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  const { t } = useTranslation("terminalMonitor");
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, 1500);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <button
      type="button"
      className={cn(
        "group flex w-[calc(100%+0.75rem)] justify-between items-center h-5 leading-5 text-xs cursor-pointer border-0 bg-transparent text-left",
        "transition-colors duration-300 ease-in-out",
        "hover:bg-accent/50 rounded px-1.5 -mx-1.5",
        copied && "bg-status-connected/10"
      )}
      onClick={handleCopy}
      title={t("copyTooltip", { value })}
      aria-label={copied ? t("copyCopied") : t("copyTooltip", { value })}
    >
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="ml-2 flex min-w-0 items-center gap-1.5">
        <span className={cn(
          "font-medium truncate",
          "transition-colors duration-300",
          monospace && "font-mono text-[11px]",
          copied && "text-status-connected"
        )}>
          {value}
        </span>
        {copied ? (
          <Check className="size-3 shrink-0 text-status-connected" aria-hidden="true" />
        ) : (
          <Copy
            className="size-3 shrink-0 text-muted-foreground/35 transition-colors group-hover:text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <span className="sr-only" aria-live="polite">
          {copied ? t("copyCopied") : ""}
        </span>
      </span>
    </button>
  );
});

/**
 * 系统信息组件
 */
export const SystemInfo: React.FC<SystemInfoProps> = React.memo(({ data, density = "full" }) => {
  const { t } = useTranslation("terminalMonitor");
  const rows = React.useMemo(() => {
    if (density === "mini") {
      return [
        { label: t("labelHost"), value: data.hostname, monospace: true },
        { label: "OS", value: data.os },
      ];
    }

    if (density === "compact") {
      return [
        { label: t("labelHost"), value: data.hostname, monospace: true },
        { label: "OS", value: data.os },
        { label: t("labelUptime"), value: data.uptime, monospace: true },
      ];
    }

    return [
      { label: "OS", value: data.os },
      { label: t("labelHost"), value: data.hostname, monospace: true },
      { label: "CPU", value: data.cpu },
      { label: t("labelArch"), value: data.arch, monospace: true },
      { label: t("labelLoad"), value: data.load, monospace: true },
      { label: t("labelUptime"), value: data.uptime, monospace: true },
    ];
  }, [data, density, t]);

  return (
    <div className="space-y-1">
      {/* 模块标题 - 高度 28px */}
      <div className={cn("flex items-center", density === "full" ? "h-7" : "h-6")}>
        <span className="text-xs font-semibold">{t("systemInfoTitle")}</span>
      </div>

      <div className="space-y-0">
        {rows.map((row) => (
          <InfoRow
            key={row.label}
            label={row.label}
            value={row.value}
            monospace={row.monospace}
          />
        ))}
      </div>
    </div>
  );
});

SystemInfo.displayName = 'SystemInfo';
