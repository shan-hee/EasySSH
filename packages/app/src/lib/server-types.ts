export type AuthMethod =
  | "password"
  | "key"
  | "password_keyboard"
  | "key_keyboard"
  | "key_password"
  | "key_password_keyboard"
  | "password_key"
  | "password_key_keyboard"
  | "keyboard_interactive"
  | "keyboard"

export type ServerStatus = "online" | "offline"

export interface Server {
  id: string
  name?: string
  host: string
  port: number
  username: string
  auth_method: AuthMethod
  ssh_key_id?: string | null
  has_password?: boolean
  has_private_key?: boolean
  /** 分组名称，仅用于展示；修改分组使用 group_id。 */
  group?: string
  group_id?: string
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
  private_key_passphrase?: string
  /** 已保存的密钥；省略表示不变，全零 UUID 表示解除。 */
  ssh_key_id?: string
  /** 空字符串表示移出分组。 */
  group_id?: string
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
  private_key_passphrase?: string
  ssh_key_id?: string
  group_id?: string
  tags?: string[]
  description?: string
  verified_connection_credential?: boolean
}

export interface ServerListResponse {
  data: Server[]
  total: number
  page: number
  limit: number
  total_pages?: number
}

export interface ServerListParams {
  page?: number
  limit?: number
  groupId?: string
  search?: string
  tag?: string
}

export interface ServerGroup {
  id: string
  name: string
  sort_order: number
}

/** 解除服务器已保存密钥时使用的空 UUID。 */
export const NO_SSH_KEY_ID = "00000000-0000-0000-0000-000000000000"

export interface ServerStatisticsResponse {
  total: number
  online?: number
  offline?: number
  connected_servers?: number
  /** 以分组名称为键。 */
  by_group: Record<string, number>
  by_tag: Record<string, number>
}
