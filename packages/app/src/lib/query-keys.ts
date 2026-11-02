export const queryKeys = {
  dashboard: {
    overview: ["dashboard", "overview"] as const,
  },
  settings: {
    form: (cacheKey: string) => ["settings", "form", cacheKey] as const,
    scheduledTaskRuntime: ["settings", "scheduled-tasks", "runtime"] as const,
  },
  scripts: {
    all: ["scripts"] as const,
    list: (page: number, pageSize: number) => ["scripts", "list", page, pageSize] as const,
    servers: ["scripts", "servers"] as const,
  },
  scheduledTasks: {
    administration: ["scheduled-tasks", "administration"] as const,
  },
  chatConnections: {
    root: ["chat-connections"] as const,
    list: ["chat-connections", "list"] as const,
    detail: (id: string) => ["chat-connections", "detail", id] as const,
    servers: ["chat-connections", "servers"] as const,
    sessions: (id: string) => ["chat-connections", "sessions", id] as const,
    transcript: (id: string, sessionId: string) => ["chat-connections", "transcript", id, sessionId] as const,
  },
  automation: {
    tokens: ["automation", "tokens"] as const,
    tokenSources: ["automation", "token-sources"] as const,
    tools: ["automation", "tools"] as const,
    grant: (id: string) => ["automation", "grant", id] as const,
  },
  taskCenter: {
    root: ["task-center"] as const,
    runs: (params: unknown) => ["task-center", "runs", params] as const,
    statistics: ["task-center", "statistics"] as const,
    detail: (id: string) => ["task-center", "detail", id] as const,
  },
  logs: {
    auditRoot: ["logs", "audit"] as const,
    audit: (params: unknown) => ["logs", "audit", params] as const,
    auditDetail: (id: string) => ["logs", "audit", "detail", id] as const,
    operations: (params: unknown) => ["logs", "operations", params] as const,
    operationDetail: (id: string) => ["logs", "operations", "detail", id] as const,
    servers: ["logs", "servers"] as const,
  },
} as const
