export enum DesktopActivityLogStatus {
  $zero = "",
  DesktopActivityLogSuccess = "success",
  DesktopActivityLogFailure = "failure",
  DesktopActivityLogWarning = "warning",
}

export enum DesktopServerAuthMethod {
  $zero = "",
  DesktopServerAuthPassword = "password",
  DesktopServerAuthKey = "key",
}

export enum DesktopServerStatus {
  $zero = "",
  DesktopServerOnline = "online",
  DesktopServerOffline = "offline",
}

export type DesktopCapability = string

export interface DesktopActivityLogItem {
  id: string
  action: string
  resource: string
  status: DesktopActivityLogStatus
  serverId?: string
  durationMs?: number
  detail?: string
  createdAt: string
}

export interface DesktopActivityLogListParams {
  page?: number
  limit?: number
  action?: string
  serverId?: string
  status?: DesktopActivityLogStatus
  startDate?: string
  endDate?: string
}

export interface DesktopActivityLogListResult {
  items: DesktopActivityLogItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface DesktopActivityLogRecordInput {
  action: string
  resource: string
  status: DesktopActivityLogStatus
  serverId?: string
  durationMs?: number
  detail?: string
}

export interface DesktopActivityLogStatistics {
  total: number
  successCount: number
  failureCount: number
  byAction: Record<string, number | undefined>
}

export type DesktopPreferenceSnapshot = Record<string, string | undefined>

export interface DesktopRuntimeInfo {
  profile: string
  version: string
  platform: string
  arch: string
  dataDir: string
  capabilities: Record<DesktopCapability, boolean | undefined>
}

export interface DesktopServer {
  id: string
  user_id: string
  name?: string
  host: string
  port: number
  username: string
  auth_method: DesktopServerAuthMethod
  password?: string
  private_key?: string
  group?: string
  tags?: string[]
  status: DesktopServerStatus
  last_connected?: string
  description?: string
  created_at: string
  updated_at: string
}

export interface DesktopServerInput {
  name?: string
  host: string
  port: number
  username: string
  auth_method: DesktopServerAuthMethod
  password?: string
  private_key?: string
  group?: string
  tags?: string[]
  description?: string
}

export interface DesktopServerListParams {
  page?: number
  limit?: number
  search?: string
  group?: string
}

export interface DesktopServerListResult {
  data: DesktopServer[]
  total: number
  page: number
  limit: number
}

export interface DesktopServerCommandInput {
  serverId: string
  command: string
  timeoutMs?: number
}

export interface DesktopServerCommandResult {
  serverId: string
  command: string
  output: string
  exitCode: number
  durationMs: number
  startedAt: string
  completedAt: string
}

export interface DesktopTerminalStartInput {
  clientId: string
  serverId: string
  cols: number
  rows: number
}

export interface DesktopTerminalWriteInput {
  clientId: string
  data: string
}

export interface DesktopTerminalResizeInput {
  clientId: string
  cols: number
  rows: number
}

export interface DesktopTerminalCloseInput {
  clientId: string
}
