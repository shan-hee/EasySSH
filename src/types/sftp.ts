export interface SftpSuccessHeader {
  sessionId?: string;
  operationId: string;
  message?: string;
  canceled?: boolean;
  filename?: string;
  size?: number;
  checksum?: string;
  mimeType?: string;
  responseType?: string;
}

export interface SftpErrorHeader {
  sessionId?: string;
  operationId: string;
  errorMessage?: string;
  error?: string;
}

export interface SftpProgressHeader {
  sessionId?: string;
  operationId: string;
  progress?: number;
  bytesTransferred?: number;
  totalBytes?: number;
  estimatedSize?: number;
  phase?: string;
  direction?: 'upload' | 'download' | string;
  speedBytes?: number;
  etaSeconds?: number;
}

export interface SftpFileDataHeader {
  sessionId?: string;
  operationId: string;
  filename?: string;
  size?: number;
  checksum?: string;
  mimeType?: string;
}

export interface SftpFolderDataHeader {
  sessionId?: string;
  operationId: string;
  isChunked?: boolean;
  final?: boolean;
  filename?: string;
  summary?: any;
  skippedFiles?: string[];
  errorFiles?: any[];
  checksum?: string;
  size?: number;
  mimeType?: string;
}

export interface SftpBinaryEventDetail {
  messageType: number;
  headerData: any;
  payloadData: ArrayBuffer | null;
}

