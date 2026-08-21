/**
 * 页签级监控数据 Context。
 * WebSocket 连接由全局 Store 复用，Context 只向面板暴露实际消费的监控数据。
 */

import React, { createContext, useContext, type ReactNode, useMemo } from 'react';
import { useMonitorWebSocket, type MonitorMetrics } from '../hooks/useMonitorWebSocket';
import type { WorkspaceMonitorApi } from '@/lib/session/workspace';

export interface MonitoringData {
  metrics: MonitorMetrics | null;
  getMetricsHistory: () => MonitorMetrics[];
}

const MonitoringContext = createContext<MonitoringData | null>(null);

interface MonitorWebSocketProviderProps {
  children: ReactNode;
  serverId: string;
  enabled?: boolean;
  interval?: number;
  monitorApi?: WorkspaceMonitorApi;
}

export const MonitorWebSocketProvider: React.FC<MonitorWebSocketProviderProps> = ({
  children,
  serverId,
  enabled = true,
  interval = 2,
  monitorApi,
}) => {
  const monitorData = useMonitorWebSocket({
    serverId,
    enabled,
    interval,
    monitorApi,
  });

  const contextValue = useMemo<MonitoringData>(() => ({
    metrics: monitorData.metrics,
    getMetricsHistory: monitorData.getMetricsHistory,
  }), [monitorData.getMetricsHistory, monitorData.metrics]);

  return (
    <MonitoringContext.Provider value={contextValue}>
      {children}
    </MonitoringContext.Provider>
  );
};

export const useMonitoringData = (): MonitoringData => {
  const context = useContext(MonitoringContext);

  if (!context) {
    throw new Error(
      'useMonitoringData must be used within MonitorWebSocketProvider. ' +
      'Make sure your component is wrapped with <MonitorWebSocketProvider>.'
    );
  }

  return context;
};
