declare module '../config/database' {
  export function connectDatabase(): any;
  export function getDatabaseStatus(): any;
  export function closeDatabase(): void;
  export function getCache(): {
    get: (key: string) => any;
    set: (key: string, value: any, ttl?: number) => void;
    del: (key: string) => void;
  };
}

declare module '../middleware/auth' {
  import type { RequestHandler } from 'express';
  export const authMiddleware: RequestHandler;
}

