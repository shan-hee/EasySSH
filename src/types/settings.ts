export interface ConnectionSettings {
  connectionTimeout?: number; // seconds
  autoReconnect?: boolean;
  reconnectInterval?: number; // attempts or seconds depending on app (existing code interprets as attempts)
  keepAliveInterval?: number; // seconds
}

export interface TerminalOptions {
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  theme?: any;
  cursorBlink?: boolean;
  cursorStyle?: string;
  scrollback?: number;
  rendererType?: string;
  fallbackRenderer?: string;
  copyOnSelect?: boolean;
  rightClickSelectsWord?: boolean;
}

