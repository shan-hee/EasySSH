/**
 * 系统信息组件
 * 显示OS、主机名、CPU、架构、负载、运行时间等基础信息
 * 支持点击复制功能
 */

import React, { useState } from 'react';
import { useTranslation } from "react-i18next"
import type { MonitorPanelDensity, SystemInfo as SystemInfoType } from '../types/metrics';
import { cn } from '@/lib/utils';

interface SystemInfoProps {
  data: SystemInfoType;
  density?: MonitorPanelDensity;
}

/**
 * 信息行组件
 */
const InfoRow: React.FC<{
  label: string;
  value: string;
  monospace?: boolean;
}> = ({ label, value, monospace = false }) => {
  const { t } = useTranslation("terminalMonitor");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <div
      className={cn(
        "flex justify-between items-center h-5 leading-5 text-xs cursor-pointer",
        "transition-all duration-300 ease-in-out",
        "hover:bg-accent/50 rounded px-1.5 -mx-1.5",
        copied && "bg-status-connected/10"
      )}
      onClick={handleCopy}
      title={t("copyTooltip", { value })}
    >
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn(
        "font-medium truncate ml-2",
        "transition-colors duration-300",
        monospace && "font-mono text-[11px]",
        copied && "text-status-connected"
      )}>
        {copied ? t("copyCopied") : value}
      </span>
    </div>
  );
};

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
