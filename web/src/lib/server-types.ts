export type AuthMethod = "password" | "key"

export type ServerStatus = "online" | "offline"

export interface Server {
  id: string
  user_id: string
  name?: string
  host: string
  port: number
  username: string
  auth_method: AuthMethod
  password?: string
  private_key?: string
  has_password?: boolean
  has_private_key?: boolean
  group?: string
  tags?: string[]
  status: ServerStatus
  last_connected?: string
  description?: string
  os?: string
  country?: string
  country_code?: string
  region?: string
  city?: string
  created_at: string
  updated_at: string
}

export interface CreateServerRequest {
  name?: string
  host: string
  port: number
  username: string
  auth_method: AuthMethod
  password?: string
  private_key?: string
  group?: string
  tags?: string[]
  description?: string
}

export interface UpdateServerRequest {
  name?: string
  host?: string
  port?: number
  username?: string
  auth_method?: AuthMethod
  password?: string
  private_key?: string
  group?: string
  tags?: string[]
  description?: string
  verified_connection_credential?: boolean
}

export interface ServerListResponse {
  data: Server[]
  total: number
  page: number
  limit: number
}

export interface ServerStatisticsResponse {
  total: number
  online: number
  offline: number
  by_group: Record<string, number>
  by_tag: Record<string, number>
}
