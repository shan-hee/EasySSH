export type SystemInfoKind = "processes" | "ports" | "services"

export interface SystemSnapshot {
  rows: Record<string, string>[]
  truncated: boolean
}

export interface SystemInfoApi {
  snapshot: (serverId: string, kind: SystemInfoKind) => Promise<SystemSnapshot>
}
