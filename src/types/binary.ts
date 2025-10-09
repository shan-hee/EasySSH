import { BINARY_MESSAGE_TYPES } from '@/services/constants';

// Minimal header shapes used by front-end consumers

export interface PingHeader {
  sessionId?: string;
  requestId?: string;
  timestamp?: number;
  clientSendTime?: number;
  measureLatency?: boolean;
  immediate?: boolean;
  client?: string;
  webSocketLatency?: number;
}

export interface PongHeader {
  sessionId: string;
  requestId?: string;
  timestamp?: number;
  serverTime?: number;
  latency?: number;
  originalTimestamp?: number;
}

export interface ConnectionRegisteredHeader {
  connectionId: string;
  sessionId: string;
  status?: number | string;
}

export interface ConnectedHeader {
  sessionId: string;
  connectionId?: string;
  status?: number | string;
  serverInfo?: { host?: string };
}

export interface NetworkLatencyHeader {
  sessionId: string;
  clientLatency?: number;
  serverLatency?: number;
  totalLatency?: number;
  timestamp: number | string;
}

export interface SSHDataHeader {
  sessionId: string;
}

export interface SSHDataAckHeader {
  sessionId: string;
  bytesProcessed?: number;
}

export interface SftpHeaderBase {
  sessionId: string;
  operationId?: string | number;
}

export interface SftpBinaryMessageDetail {
  messageType: (typeof BINARY_MESSAGE_TYPES)[keyof typeof BINARY_MESSAGE_TYPES] | number;
  headerData: any; // header varies widely per operation; consumers narrow at use-sites
  payloadData: ArrayBuffer | null;
}

