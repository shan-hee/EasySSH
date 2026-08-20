export const queryKeys = {
  dashboard: {
    overview: ["dashboard", "overview"] as const,
  },
  notifications: {
    inbox: ["notifications", "inbox"] as const,
  },
  settings: {
    form: (cacheKey: string) => ["settings", "form", cacheKey] as const,
  },
  users: {
    administration: ["users", "administration"] as const,
    resourceGrants: (subjectType: "role" | "user", subjectId: string) =>
      ["users", "resource-grants", subjectType, subjectId] as const,
  },
  roles: {
    list: ["roles", "list"] as const,
  },
  scripts: {
    all: ["scripts"] as const,
    list: (page: number, pageSize: number) => ["scripts", "list", page, pageSize] as const,
    servers: ["scripts", "servers"] as const,
  },
  scheduledTasks: {
    administration: ["scheduled-tasks", "administration"] as const,
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
    operations: (params: unknown) => ["logs", "operations", params] as const,
  },
} as const
