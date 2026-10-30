import type { components } from "@/generated/openapi"
import type { SystemConfig } from "@/lib/api/settings"

type OwnerPublic = components["schemas"]["OwnerPublic"]

/**
 * 当前所有者的公开资料，对应契约中的 OwnerPublic。
 * 宿主可只提供身份字段，例如桌面的本机所有者。
 */
export type User = Pick<OwnerPublic, "id" | "username" | "email" | "created_at" | "updated_at"> &
  Partial<Omit<OwnerPublic, "id" | "username" | "email" | "created_at" | "updated_at">>

/**
 * 宿主组装的认证状态：Web 由所有者状态与系统设置组成，桌面使用本机所有者。
 */
export interface AuthStatusResponse {
  /** 实例尚未创建所有者。 */
  need_init: boolean
  is_authenticated: boolean
  user?: User
  /** 当前登录会话，用于在会话列表中标记本设备。 */
  session_id?: string
  system_config?: SystemConfig
}
