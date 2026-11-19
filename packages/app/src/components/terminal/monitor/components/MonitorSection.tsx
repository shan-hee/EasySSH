import React from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MonitorPanelDensity } from '../types/metrics';

export type MonitorSectionKey = 'disk';

// 展开状态全局记住一份，不区分服务器；默认全部折叠，只显示每类一个对象。
const useMonitorSections = create<{
  expanded: Partial<Record<MonitorSectionKey, boolean>>;
  toggle: (section: MonitorSectionKey) => void;
}>()(
  persist(
    (set) => ({
      expanded: {},
      toggle: (section) => set((state) => ({ expanded: { ...state.expanded, [section]: !state.expanded[section] } })),
    }),
    { name: 'monitor-sections', partialize: (state) => ({ expanded: state.expanded }) },
  ),
);

export function useSectionExpanded(section: MonitorSectionKey, expandable: boolean) {
  return useMonitorSections((state) => expandable && Boolean(state.expanded[section]));
}

interface MonitorSectionHeaderProps {
  section: MonitorSectionKey;
  title: React.ReactNode;
  expandable: boolean;
  density: MonitorPanelDensity;
  children?: React.ReactNode;
}

export const MonitorSectionHeader: React.FC<MonitorSectionHeaderProps> = ({
  section,
  title,
  expandable,
  density,
  children,
}) => {
  const expanded = useSectionExpanded(section, expandable);
  const toggle = useMonitorSections((state) => state.toggle);

  return (
    <div className={cn('flex items-center justify-between gap-2', density === 'full' ? 'h-7' : 'h-6')}>
      {expandable ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => toggle(section)}
          className="-ml-1 flex min-w-0 items-center gap-1 rounded px-1 text-xs font-semibold hover:bg-muted/60"
        >
          <span className="truncate">{title}</span>
          <ChevronDown className={cn('size-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </button>
      ) : (
        <span className="min-w-0 truncate text-xs font-semibold">{title}</span>
      )}
      {children}
    </div>
  );
};
