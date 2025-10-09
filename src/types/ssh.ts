// Lightweight shared types for SSH/SFTP front-end services.

export type AuthType = 'password' | 'key' | 'privateKey';

export interface ConnectionConfig {
  host: string;
  port?: number;
  username?: string;
  authType?: AuthType;
  name?: string;
  password?: string;
  keyFile?: string;
  passphrase?: string;
  terminalId?: string;
  sessionId?: string;
}

export type ConnectionStatus =
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'disconnecting'
  | 'disconnected'
  | 'cancelled'
  | 'closed'
  | 'error'
  | 'unknown';

export interface ConnectionState {
  status: ConnectionStatus;
  message: string;
  error?: string | null;
  startTime?: Date;
}

export interface TerminalLike {
  write: (data: string) => void;
  dispose?: () => void;
  off?: (eventName: string) => void;
  _events?: Record<string, unknown>;
}

export interface SSHSessionLatency {
  total?: number;
  client?: number;
  server?: number;
  lastUpdate?: Date;
}

export interface SSHSession {
  id: string;
  socket: WebSocket | null;
  connection: ConnectionConfig;
  connectionState: ConnectionState;
  terminal: TerminalLike | null;
  terminalId?: string;
  buffer?: string;
  bufferSize?: number;
  _bufferingNotified?: boolean;
  retryCount: number;
  isReconnecting?: boolean;
  userInitiatedClose?: boolean;
  userCloseReason?: string;
  createdAt?: Date;
  lastActivity?: Date;
  disconnectNotified?: boolean;
  onData?: ((data: string) => void) | null;
  onClose?: (() => void) | null;
  onError?: ((e: unknown) => void) | null;
  latency?: SSHSessionLatency;
  // Some code paths attach a destroy hook on the session for cleanup
  destroy?: () => void;
}

export interface KeepAliveRequestMeta {
  timestamp: Date;
  sessionId: string;
  clientSendTime?: number;
  isParallelPingMeasurement?: boolean;
  isTimedLatencyMeasurement?: boolean;
}

export interface KeepAliveData {
  interval: number | ReturnType<typeof setInterval>;
  pingRequests: Map<string, KeepAliveRequestMeta>;
}

export interface PendingTerminalCancel {
  reason: string;
  timestamp: number;
}

export interface PendingConnectionRecord {
  connection: ConnectionConfig;
  terminalId: string | null;
  sessionId: string;
  createdAt: number;
  socket: WebSocket;
  resolve: (sessionId: string) => void;
  reject: (err: Error) => void;
}

export interface LatencyDetail {
  sessionId: string;
  clientLatency?: number;
  serverLatency?: number;
  totalLatency?: number;
  timestamp: string | number;
  terminalId?: string | null;
  updatedAt?: Date;
  lastUpdate?: Date;
}
