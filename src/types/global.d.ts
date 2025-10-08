/// <reference types="vite/client" />

declare global {
  interface Window {
    _isRemoteLogout?: boolean;
  }
}

export {};

