import { apiFetch } from "@/lib/api-client"
import type { SaveUserAIConfigRequest, UserAIConfig } from "@/lib/ai-agent-types"

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
 * 系统通用配置
 */
export interface SystemConfig {
  // 基本设置
  system_name: string
  system_logo: string
  system_favicon: string

  // 国际化设置
  default_language: "zh-CN" | "en-US"
  default_timezone: string
  date_format: string

  // 文件传输设置
  download_exclude_patterns: string
  default_download_mode: "fast" | "compatible"
  skip_excluded_on_upload: boolean
  max_file_upload_size: number
  transfer_storage_path?: string
  transfer_retention_days?: number
  transfer_max_storage_gb?: number
  transfer_max_concurrency?: number
  transfer_cleanup_enabled?: boolean

  tab_session?: WorkspaceConfig & LoginSessionConfig
  oauth_access_token_minutes?: number
  oauth_refresh_token_days?: number
  external_oauth_provider_enabled?: boolean
	external_oauth_provider_configured?: boolean
	external_oauth_issuer?: string
	external_oauth_login_url?: string
	external_oauth_redirect_uris?: string
	sftp_max_idle_time_seconds?: number
	sftp_cleanup_interval_seconds?: number
	sftp_max_life_time_minutes?: number
	sftp_conn_timeout_seconds?: number
	sftp_max_sessions_per_conn?: number
	geoip_database_path?: string

  // 注册配置
  allow_registration?: boolean
	default_role?: string

  // OAuth 配置
  oauth_enabled?: boolean
  google_client_id?: string
  google_client_secret?: string
  has_google_client_secret?: boolean
}

/**
 * 获取系统配置响应
 */
export interface GetSystemConfigResponse {
  config: SystemConfig
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
	password_pwned_check_enabled: boolean
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
 * 系统级 AI 配置
 */
export type AISystemProvider = "openai" | "openai-response" | "gemini" | "anthropic"

const VALID_AI_SYSTEM_PROVIDERS: AISystemProvider[] = [
  "openai",
  "openai-response",
  "gemini",
  "anthropic",
]

export interface AISystemConfig {
  system_enabled: boolean
  system_provider: AISystemProvider
  system_api_key?: string
  system_api_endpoint: string
  system_models: string
  has_api_key?: boolean
}

/**
 * 保存系统级 AI 配置请求
 */
export interface SaveAISystemConfigRequest {
  system_enabled?: boolean
  system_provider?: AISystemProvider
  system_api_key?: string
  system_api_endpoint?: string
  system_models?: string
}

/**
 * 探测系统 AI 模型请求
 */
export interface ProbeAISystemModelsRequest {
  system_provider?: AISystemProvider
  system_api_key?: string
  system_api_endpoint?: string
}

/**
 * 探测系统 AI 模型响应
 */
export interface ProbeAISystemModelsResponse {
  available: boolean
  models: string[]
  message?: string
}

export interface ProbeUserAIModelsRequest {
  custom_provider?: string
  custom_api_key?: string
  custom_endpoint?: string
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

  async saveRegistrationConfig(
    config: Pick<SystemConfig, "allow_registration" | "default_role">
  ): Promise<void> {
    return apiFetch<void>("/settings/system/registration", { method: "PATCH", body: config })
  },

  async saveGoogleAuthConfig(
    config: Pick<SystemConfig, "oauth_enabled" | "google_client_id" | "google_client_secret">
  ): Promise<void> {
    return apiFetch<void>("/settings/system/google-auth", { method: "PATCH", body: config })
  },

  async saveOAuthProviderConfig(
    config: Pick<
      SystemConfig,
      | "oauth_access_token_minutes"
      | "oauth_refresh_token_days"
      | "external_oauth_provider_enabled"
      | "external_oauth_issuer"
      | "external_oauth_login_url"
      | "external_oauth_redirect_uris"
    >
  ): Promise<void> {
    return apiFetch<void>("/settings/system/oauth-provider", { method: "PATCH", body: config })
  },

  async saveRuntimeConfig(config: Pick<SystemConfig, "geoip_database_path">): Promise<void> {
	return apiFetch<void>("/settings/system/runtime", { method: "PATCH", body: config })
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

  // === AI 配置相关 API ===

  /**
   * 获取系统级 AI 配置
   */
  async getAISystemConfig(): Promise<AISystemConfig> {
    const response = await apiFetch<
      Partial<Omit<AISystemConfig, "system_provider">> & { system_provider?: string }
    >("/settings/ai/system", { method: "GET" })
    const rawProvider = (response.system_provider || "").toLowerCase()
    const normalizedProvider: AISystemProvider =
      VALID_AI_SYSTEM_PROVIDERS.includes(rawProvider as AISystemProvider)
        ? (rawProvider as AISystemProvider)
        : "openai"
    return {
      system_enabled: response.system_enabled ?? false,
      system_provider: normalizedProvider,
      system_api_endpoint: response.system_api_endpoint ?? "",
      system_models: response.system_models ?? "",
      has_api_key: response.has_api_key ?? false,
      system_api_key: "",
    }
  },

  /**
   * 保存系统级 AI 配置
   */
  async saveAISystemConfig(config: SaveAISystemConfigRequest): Promise<void> {
    return apiFetch<void>("/settings/ai/system", {
      method: "POST",
      body: config,
    })
  },

  /**
   * 探测系统级 AI 可用模型
   */
  async probeAISystemModels(payload: ProbeAISystemModelsRequest): Promise<ProbeAISystemModelsResponse> {
    return apiFetch<ProbeAISystemModelsResponse>("/settings/ai/system/models", {
      method: "POST",
      body: payload,
    })
  },
}

export type { SaveUserAIConfigRequest, UserAIConfig } from "@/lib/ai-agent-types"

/**
 * 用户AI配置 API 服务
 */
export const userAIConfigApi = {
  /**
   * 获取当前用户的AI配置
   */
  async getUserAIConfig(): Promise<UserAIConfig> {
    return apiFetch<UserAIConfig>("/users/me/ai-config", {
      method: "GET",
    })
  },

  /**
   * 保存当前用户的AI配置
   */
  async saveUserAIConfig(config: SaveUserAIConfigRequest): Promise<void> {
    return apiFetch<void>("/users/me/ai-config", {
      method: "PUT",
      body: config,
    })
  },

  /**
   * 使用当前用户的自定义 AI 凭据获取可用模型
   */
  async probeModels(payload: ProbeUserAIModelsRequest): Promise<ProbeAISystemModelsResponse> {
    return apiFetch<ProbeAISystemModelsResponse>("/users/me/ai-config/models", {
      method: "POST",
      body: payload,
    })
  },

  /**
   * 删除当前用户的AI配置（恢复使用系统配置）
   */
  async deleteUserAIConfig(): Promise<void> {
    return apiFetch<void>("/users/me/ai-config", {
      method: "DELETE",
    })
  },
}
