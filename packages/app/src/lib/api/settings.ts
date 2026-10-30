import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"

/**
 * SMTP 配置
 */
export interface SMTPConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  password: string
  from_email: string
  from_name: string
  use_tls: boolean
}

/**
 * Webhook 配置
 */
export type WebhookMethod = "POST" | "GET"

export interface WebhookConfig {
  enabled: boolean
  url: string
  secret: string
  method: WebhookMethod
}

/**
 * 钉钉配置
 */
export interface DingTalkConfig {
  enabled: boolean
  webhook_url: string
  secret: string
}

/**
 * 企业微信配置
 */
export interface WeComConfig {
  enabled: boolean
  webhook_url: string
}

/**
 * 统一的通知配置（包含所有通知方式）
 */
export interface NotificationConfig {
  // SMTP 邮件通知
  smtp: SMTPConfig
  // Webhook 通知
  webhook: WebhookConfig
  // 钉钉通知
  dingtalk: DingTalkConfig
  // 企业微信通知
  wecom: WeComConfig
}

/**
 * 获取通知配置响应
 */
export interface GetNotificationConfigResponse {
  config: NotificationConfig
}

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
	csrf_trusted_origins: string
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
  async getNotificationConfig(): Promise<NotificationConfig> {
    const response = await apiFetch<GetNotificationConfigResponse>("/settings/notifications", {
      method: "GET",
      retry: false, // 禁用重试，减少错误日志
    })
    return {
      ...response.config,
      webhook: {
        ...response.config.webhook,
        method: response.config.webhook.method === "GET" ? "GET" : "POST",
      },
    }
  },

  /**
   * 保存所有通知配置（统一接口）
   */
  async saveNotificationConfig(config: NotificationConfig): Promise<void> {
    return apiFetch<void>("/settings/notifications", {
      method: "POST",
      body: config,
    })
  },

  // === 通知配置分组 API ===

  /**
   * 保存 SMTP 配置
   */
  async saveSMTPConfigOnly(config: SMTPConfig): Promise<void> {
    return apiFetch<void>("/settings/smtp", {
      method: "POST",
      body: config,
    })
  },

  /**
   * 保存 Webhook 配置
   */
  async saveWebhookConfigOnly(config: WebhookConfig): Promise<void> {
    return apiFetch<void>("/settings/webhook", {
      method: "POST",
      body: config,
    })
  },

  /**
   * 保存钉钉配置
   */
  async saveDingTalkConfigOnly(config: DingTalkConfig): Promise<void> {
    return apiFetch<void>("/settings/dingtalk", {
      method: "POST",
      body: config,
    })
  },

  /**
   * 保存企业微信配置
   */
  async saveWeComConfigOnly(config: WeComConfig): Promise<void> {
    return apiFetch<void>("/settings/wecom", {
      method: "POST",
      body: config,
    })
  },

  // === 通知测试连接 API ===

  /**
   * 测试 SMTP 连接
   */
  async testSMTPConnection(config: SMTPConfig): Promise<void> {
    return apiFetch<void>("/settings/smtp/test", {
      method: "POST",
      body: config,
    })
  },

  /**
   * 测试 Webhook 连接
   */
  async testWebhookConnection(config: WebhookConfig): Promise<void> {
    return apiFetch<void>("/settings/webhook/test", {
      method: "POST",
      body: config,
    })
  },

  /**
   * 测试钉钉连接
   */
  async testDingTalkConnection(config: DingTalkConfig): Promise<void> {
    return apiFetch<void>("/settings/dingtalk/test", {
      method: "POST",
      body: config,
    })
  },

  /**
   * 测试企业微信连接
   */
  async testWeComConnection(config: WeComConfig): Promise<void> {
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
