// Centralized UI event names to avoid string drift across components
export const EVENTS = {
  // Terminal session lifecycle / routing
  TERMINAL_SESSION_CHANGE: 'terminal:session-change',
  TERMINAL_STATUS_UPDATE: 'terminal-status-update',
  SSH_SESSION_CREATION_FAILED: 'ssh-session-creation-failed',
  SSH_CONNECTED: 'ssh-connected',
  SSH_CONNECTING: 'ssh-connecting',

  // Toolbar sync/reset
  TERMINAL_TOOLBAR_RESET: 'terminal:toolbar-reset',
  TERMINAL_TOOLBAR_SYNC: 'terminal:toolbar-sync',
  MONITORING_STATUS_CHANGE: 'monitoring-status-change',
  AI_SERVICE_STATUS_CHANGE: 'ai-service-status-change',
  TERMINAL_NEW_SESSION: 'terminal:new-session',

  // Theme and settings
  TERMINAL_THEME_UPDATE: 'terminal-theme-update',
  TERMINAL_SETTINGS_UPDATED: 'terminal-settings-updated',
  SETTINGS_READY: 'settings:ready',
  UI_SERVICES_READY: 'ui-services:ready',
  SERVICES_READY: 'services:ready',

  // SFTP panel requests routed via layout
  REQUEST_TOGGLE_SFTP_PANEL: 'request-toggle-sftp-panel',
  CLOSE_SFTP_PANEL: 'close-sftp-panel',
  CLOSE_MONITORING_PANEL: 'close-monitoring-panel',
  SFTP_SESSION_CHANGED: 'sftp:session-changed',

  // Misc
  TERMINAL_TITLE_CHANGE: 'terminal:title-change',
  SSH_SESSION_CREATED: 'ssh:session-created',
  TERMINAL_BG_STATUS: 'terminal-bg-status',
  TERMINAL_BG_CHANGED: 'terminal-bg-changed',

  // Terminal external controls
  TERMINAL_SEND_COMMAND: 'terminal:send-command',
  TERMINAL_CLEAR: 'terminal:clear',
  TERMINAL_DISCONNECT: 'terminal:disconnect',
  TERMINAL_EXECUTE_COMMAND: 'terminal:execute-command',
  TERMINAL_COMMAND: 'terminal-command',
  TERMINAL_REFRESH_STATUS: 'terminal:refresh-status'
  ,
  // Terminal monitoring controls
  TERMINAL_MONITORING_HIDE: 'terminal:monitoring-hide'
};

export default EVENTS;
