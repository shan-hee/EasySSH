import type { AuthStatusResponse } from "@easyssh/app/lib/api/auth"
import { settingsApi } from "@easyssh/app/lib/api/settings"
import { DEFAULT_SYSTEM_CONFIG } from "@easyssh/app/contexts/system-config-context"
import { ownerApi } from "../lib/api/owner"
import { ownerSession } from "./owner-session"

/**
 * 浏览器所有者会话的认证状态：所有者状态加上登录后才能读取的系统、工作区与登录会话设置；
 * 未登录时只有公开的品牌信息。
 */
export const authSession = {
  async checkStatus(): Promise<AuthStatusResponse> {
    const status = await ownerApi.status()
    if (!status.authenticated || !status.owner) {
      ownerSession.end()
      // 品牌信息只用于展示，读取失败时沿用默认值，不影响进入登录页。
      const branding = await ownerApi.branding().catch(() => null)
      return {
        need_init: !status.initialized,
        is_authenticated: false,
        system_config: branding ? { ...DEFAULT_SYSTEM_CONFIG, ...branding } : DEFAULT_SYSTEM_CONFIG,
      }
    }

    ownerSession.begin()
    const [system, workspace, loginSession] = await Promise.all([
      settingsApi.getSystemConfig(),
      settingsApi.getWorkspaceConfig(),
      settingsApi.getLoginSessionConfig(),
    ])
    return {
      need_init: false,
      is_authenticated: true,
      user: status.owner,
      session_id: status.session_id,
      system_config: { ...system, tab_session: { ...workspace, ...loginSession } },
    }
  },
}
