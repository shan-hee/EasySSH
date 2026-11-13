import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"

/**
 * 通知渠道：读取只返回密钥与地址是否已保存（has_*），
 * 写入时省略字段保持原值，显式空字符串清空。
 */
export type WebhookMethod = "POST" | "GET"
export type RetentionConfig = components["schemas"]["RetentionConfig"]
export type NotificationConfigView = components["schemas"]["NotificationConfigView"]
export type NotificationConfigUpdate = components["schemas"]["NotificationConfigUpdate"]
export type SMTPConfigUpdate = components["schemas"]["SMTPConfigUpdate"]
export type WebhookConfigUpdate = components["schemas"]["WebhookConfigUpdate"]
export type DingTalkConfigUpdate = components["schemas"]["DingTalkConfigUpdate"]
export type WeComConfigUpdate = components["schemas"]["WeComConfigUpdate"]

/**
 * 系统通用配置：契约中的基础、文件传输与计划任务设置，
 * 加上前端从工作区与登录会话设置组合进来的 tab_session。
 */
export type SystemConfig = components["schemas"]["SystemConfig"] & {
  tab_session?: WorkspaceConfig & LoginSessionConfig
}

/**
 * 获取系统配置响应
 */
export interface GetSystemConfigResponse {
  config: SystemConfig
}

export interface ScheduledTaskRuntimeStatus {
  max_concurrency: number
  active: number
  queued: number
  scaling_down: boolean
}

export interface ScheduledTaskSettingsResponse {
  config: {
    job_queue_max_concurrency: number
  }
  status: ScheduledTaskRuntimeStatus
}

export interface WorkspaceConfig {
  max_tabs: number
  inactive_minutes: number
  hibernate: boolean
}

export interface LoginSessionConfig {
  session_timeout: number
  remember_login: boolean
}

export interface LoginSecurityConfig {
	login_limit: number
	api_limit: number
	two_fa_limit: number
}

export interface WebSecurityConfig {
	trusted_proxies: string
	cookie_secure_mode: "auto" | "always" | "never"
	cookie_domain: string
	cookie_same_site: "lax" | "strict" | "none"
	content_security_policy: string
}

/**
 * IP 访问控制配置
 */
export interface IPWhitelistConfig {
  allowlist_ips: string
  blocklist_ips: string
}

/**
 * 获取 IP 访问控制配置响应
 */
export interface GetIPWhitelistConfigResponse {
  config: IPWhitelistConfig
}

// === 高级配置类型定义 ===

/**
 * CORS 配置
 */
export interface CORSConfig {
  allowed_origins: string[]
}

/**
 * 获取 CORS 配置响应
 */
export interface GetCORSConfigResponse {
  config: CORSConfig
}

interface ConfigResponse<T> {
  config: T
}

/**
 * 系统设置 API 服务
 */
export const settingsApi = {
  // === 统一的通知配置 API ===

  /**
   * 获取所有通知配置（统一接口）
   */
  async getNotificationConfig(): Promise<NotificationConfigView> {
    const response = await apiFetch<components["schemas"]["NotificationConfigResponse"]>("/settings/notifications", {
      method: "GET",
      retry: false, // 禁用重试，减少错误日志
    })
    return response.config
  },

  /**
   * 保存所有通知配置（统一接口）
   */
  async saveNotificationConfig(config: NotificationConfigUpdate): Promise<void> {
    return apiFetch<void>("/settings/notifications", {
      method: "POST",
      body: config,
    })
  },

  // === 通知测试连接 API ===

  /**
   * 测试 SMTP 连接
   */
  async testSMTPConnection(config: SMTPConfigUpdate): Promise<void> {
    return apiFetch<void>("/settings/smtp/test", {
      method: "POST",
      body: config,
    })
  },

  /**
   * 测试 Webhook 连接
   */
  async testWebhookConnection(config: WebhookConfigUpdate): Promise<void> {
    return apiFetch<void>("/settings/webhook/test", {
      method: "POST",
      body: config,
    })
  },

  /**
   * 测试钉钉连接
   */
  async testDingTalkConnection(config: DingTalkConfigUpdate): Promise<void> {
    return apiFetch<void>("/settings/dingtalk/test", {
      method: "POST",
      body: config,
    })
  },

  /**
   * 测试企业微信连接
   */
  async testWeComConnection(config: WeComConfigUpdate): Promise<void> {
    return apiFetch<void>("/settings/wecom/test", {
      method: "POST",
      body: config,
    })
  },

  /**
   * 获取系统配置
   */
  async getSystemConfig(): Promise<SystemConfig> {
    const response = await apiFetch<GetSystemConfigResponse>("/settings/system", {
      method: "GET",
    })
    return response.config
  },

  /**
   * 保存系统配置
   */
  async saveBasicInfo(config: Partial<SystemConfig>): Promise<void> {
    return apiFetch<void>("/settings/system/basic", {
      method: "PATCH",
      body: config,
    })
  },

  /**
   * 保存文件传输配置
   */
  async saveFileTransferConfig(config: Partial<SystemConfig>): Promise<void> {
    return apiFetch<void>("/settings/system/file-transfer", {
      method: "PATCH",
      body: config,
    })
  },

  async getScheduledTaskSettings(): Promise<ScheduledTaskSettingsResponse> {
    return apiFetch<ScheduledTaskSettingsResponse>("/settings/system/scheduled-tasks", {
      method: "GET",
    })
  },

  async saveScheduledTaskSettings(config: {
    job_queue_max_concurrency: number
  }): Promise<ScheduledTaskSettingsResponse> {
    return apiFetch<ScheduledTaskSettingsResponse>("/settings/system/scheduled-tasks", {
      method: "PATCH",
      body: config,
    })
  },

  async getRetentionSettings(): Promise<RetentionConfig> {
    return apiFetch<RetentionConfig>("/settings/system/retention", { method: "GET" })
  },

  async saveRetentionSettings(config: RetentionConfig): Promise<RetentionConfig> {
    return apiFetch<RetentionConfig>("/settings/system/retention", { method: "PATCH", body: config })
  },

  async runRetention(): Promise<components["schemas"]["RetentionRunResult"]> {
    return apiFetch<components["schemas"]["RetentionRunResult"]>("/settings/system/retention/run", { method: "POST", retry: false })
  },

  async listRecycleBin(): Promise<components["schemas"]["RecycleBinEntry"][]> {
    return apiFetch<components["schemas"]["RecycleBinEntry"][]>("/settings/recycle-bin", { method: "GET" })
  },

  async restoreRecycleBinEntry(id: string): Promise<components["schemas"]["RecycleBinEntry"]> {
    return apiFetch<components["schemas"]["RecycleBinEntry"]>(`/settings/recycle-bin/${id}/restore`, { method: "POST", retry: false })
  },

  async deleteRecycleBinEntry(id: string): Promise<void> {
    await apiFetch<void>(`/settings/recycle-bin/${id}`, { method: "DELETE", retry: false })
  },

  async getWorkspaceConfig(): Promise<WorkspaceConfig> {
	const response = await apiFetch<ConfigResponse<WorkspaceConfig>>("/settings/workspace", {
		method: "GET",
	})
	return response.config
  },

  async saveWorkspaceConfig(config: WorkspaceConfig): Promise<void> {
	return apiFetch<void>("/settings/workspace", { method: "POST", body: config })
  },

  async getLoginSessionConfig(): Promise<LoginSessionConfig> {
	const response = await apiFetch<ConfigResponse<LoginSessionConfig>>("/settings/login-session", { method: "GET" })
	return response.config
  },

  async saveLoginSessionConfig(config: LoginSessionConfig): Promise<void> {
	return apiFetch<void>("/settings/login-session", { method: "POST", body: config })
  },

  async getLoginSecurityConfig(): Promise<LoginSecurityConfig> {
	const response = await apiFetch<ConfigResponse<LoginSecurityConfig>>("/settings/login-security", { method: "GET" })
	return response.config
  },

  async saveLoginSecurityConfig(config: LoginSecurityConfig): Promise<void> {
	return apiFetch<void>("/settings/login-security", { method: "POST", body: config })
  },

  async getWebSecurityConfig(): Promise<WebSecurityConfig> {
	const response = await apiFetch<ConfigResponse<WebSecurityConfig>>("/settings/web-security", { method: "GET" })
	return response.config
  },

  async saveWebSecurityConfig(config: WebSecurityConfig): Promise<void> {
	return apiFetch<void>("/settings/web-security", { method: "POST", body: config })
  },

  // === IP 白名单相关 API ===

  /**
   * 获取 IP 访问控制配置
   */
  async getIPWhitelistConfig(): Promise<IPWhitelistConfig> {
    const response = await apiFetch<GetIPWhitelistConfigResponse>("/settings/access-control", {
      method: "GET",
    })
    return response.config
  },

  /**
   * 保存 IP 访问控制配置
   */
  async saveIPWhitelistConfig(config: Partial<IPWhitelistConfig>): Promise<void> {
    return apiFetch<void>("/settings/access-control", {
      method: "POST",
      body: config,
    })
  },

  // === 高级配置相关 API ===

  /**
   * 获取 CORS 配置
   */
  async getCORSConfig(): Promise<CORSConfig> {
	const response = await apiFetch<GetCORSConfigResponse>("/settings/cors", {
      method: "GET",
    })
    return response.config
  },

  /**
   * 保存 CORS 配置
   */
  async saveCORSConfig(config: CORSConfig): Promise<void> {
	return apiFetch<void>("/settings/cors", {
      method: "POST",
      body: config,
    })
  },
}
