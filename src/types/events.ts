import type { ConnectionConfig } from './ssh';

export interface SshConnectedDetail {
  sessionId: string;
  host: string;
  terminalId?: string | null;
  connection: ConnectionConfig;
}

export interface SshSessionCreationFailedDetail {
  sessionId: string | null;
  terminalId: string | null;
  error: string;
  message?: string;
  reason?: string;
  status: 'failed' | 'cancelled' | string;
}

export interface NetworkLatencyDetailEvent {
  sessionId: string;
  terminalId?: string | null;
  clientLatency?: number;
  serverLatency?: number;
  totalLatency?: number;
  timestamp: string | number;
}

