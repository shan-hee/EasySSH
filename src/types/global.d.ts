// Global type declarations for browser window augmentations
export {};

declare global {
  interface Window {
    // Expose the enhanced clipboard manager instance for debugging
    clipboardManager: import('../services/clipboard').default;
    TERMINAL_FONTS_LOADED?: boolean;
    // App-wide flags and service registry
    _isAuthFailed?: boolean;
    _isRemoteLogout?: boolean;
    services?: any;
    monitoringAPI?: any;
    // Dev tools for config manager (dev only)
    configManager?: any;
    autocompleteConfig?: any;
    // AI error handler for debugging
    aiErrorHandler?: import('../utils/ai-panel-error-handler').AIErrorHandler;
    // Terminal manager (if present)
    terminalManager?: any;
  }

  // Injected by build (vite define)
  const __EP_AUTO_ENABLED__: boolean;
}
