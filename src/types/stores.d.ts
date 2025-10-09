// Minimal store typings to allow removing @ts-nocheck from consumers
declare module '@/store/user' {
  export interface UserStoreLike {
    token: string;
    isLoggedIn: boolean;
    setToken: (t: string) => void;
    setUserInfo: (info: any) => void;
    performCompleteCleanup: () => Promise<void>;
    // Optional flags used by smart refresh
    connectionsLoaded?: boolean;
    historyLoaded?: boolean;
    favoritesLoaded?: boolean;
    ensureConnectionsData?: (force?: boolean) => Promise<void>;
  }
  export function useUserStore(): UserStoreLike;
}

// Minimal store typings for other Pinia stores used across TS consumers
declare module '@/store/connection' {
  export interface ConnectionStoreLike {
    getConnectionById: (id: string) => any | undefined;
  }
  export function useConnectionStore(): ConnectionStoreLike;
}

declare module '@/store/localConnections' {
  export interface LocalConnectionsStoreLike {
    getConnectionById: (id: string) => any | undefined;
    getAllConnections?: () => any[];
  }
  export function useLocalConnectionsStore(): LocalConnectionsStoreLike;
}

declare module '@/store/session' {
  export interface SessionStoreLike {
    getSession: (id: string) => any | undefined;
    registerSession: (id: string, info: any) => void;
    removeSession: (id: string) => void;
    getActiveSession: () => string | undefined;
    setActiveSession: (id: string) => void;
  }
  export function useSessionStore(): SessionStoreLike;
}

declare module '@/store/terminal' {
  export interface TerminalStoreLike {
    hasTerminal: (id: string) => boolean;
    focusTerminal: (id: string) => void;
    disconnectTerminal: (id: string) => Promise<void> | void;
    // Optional internal map for session references used by cleanup paths
    sessions?: Record<string, any>;
  }
  export function useTerminalStore(): TerminalStoreLike;
}
