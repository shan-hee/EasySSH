export type SyncScopes = { credentials: boolean; ai_config: boolean; sessions: boolean }
export const emptySyncScopes: SyncScopes = { credentials: false, ai_config: false, sessions: false }
export type SyncVersionPreview = {
  source?: string
  updated_at?: string
  deleted?: boolean
  title?: string
  messages?: number
  last_message_at?: string
  has_password?: boolean
  fingerprint?: string
  provider?: string
  has_api_key?: boolean
}
export type SyncConflict = {
  key: string
  field: string
  values: string[]
  previews?: Record<string, SyncVersionPreview>
}
export type SyncDevice = {
  id: string
  name: string
  scopes: SyncScopes
  created_at: string
  expires_at: string
  last_used_at: string | null
}
export type SyncStatus = {
  account_name?: string
  can_sync?: boolean
  connected: boolean
  enabled: boolean
  server_url?: string
  space_id?: string
  last_sync?: string
  error?: string
  records?: number
  conflicts: SyncConflict[]
  devices?: SyncDevice[]
  scopes?: SyncScopes
  grants?: SyncScopes
}
export interface SyncAdapter {
  status(): Promise<SyncStatus>
  sync(): Promise<void>
  resolve(key: string, field: string, value: string): Promise<void>
  beginLogin?(url: string, name: string): Promise<SyncLogin>
  pollLogin?(): Promise<boolean>
  cancelLogin?(): Promise<void>
  candidates?(): Promise<SyncCandidate[]>
  enroll?(spaceID: string, keys: string[]): Promise<void>
  setScopes?(scopes: SyncScopes): Promise<void>
  enrollAIConfig?(spaceID: string): Promise<void>
  forkSession?(key: string, ref: string): Promise<void>
  setEnabled?(enabled: boolean): Promise<void>
  disconnect?(): Promise<boolean>
  revokeDevice?(id: string): Promise<void>
}

export type SyncLogin = { url: string; code: string; expires_at: string }
export type SyncCandidate = {
  key: string
  name: string
  space_id: string
  account_name: string
  server_url: string
}
