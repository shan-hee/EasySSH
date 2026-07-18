import { apiFetch } from "@/lib/api-client"
import {
  isTerminalRefreshTokenError,
  refreshAccessToken,
  suspendSessionRefresh,
} from "@/lib/session-refresh"
import {
  hasAuthActivityTimedOut,
  isAuthIdleExpired,
  markAuthIdleExpired,
} from "@/lib/auth-session-activity"

// 内置登录不会导航到此地址；它只作为 Fosite 授权码与 PKCE 交换的一致性标识。
// 使用保留的 .invalid 域名可避免本地端口、真实域名和反向代理差异影响登录。
export const INTERNAL_OAUTH_REDIRECT_URI = "https://internal.easyssh.invalid/auth/callback"

/**
 * 用户基础信息
 */
export interface User {
  id: string
  username: string
  email: string
  role: string  // 基础类型使用string,UserDetail中会强化为UserRole
	permissions?: string[]
  avatar?: string
  language?: string
  timezone?: string
  two_factor_enabled?: boolean
  google_linked?: boolean
  // 通知设置
  notify_email_login?: boolean
  notify_email_alert?: boolean
  notify_browser?: boolean
  notify_new_device?: boolean      // 新设备登录通知
  notify_new_location?: boolean    // 新地点登录通知
  notify_suspicious?: boolean      // 可疑登录通知
  notify_task_in_app?: boolean
  notify_task_success?: boolean
  notify_task_failure?: boolean
  notify_task_partial?: boolean
  notify_task_external?: boolean
  // 监控数据源设置（支持独立配置每个数据源，但只选择一个生效）
  monitor_data_source?: string  // 当前选中的数据源: easyssh, nezha, komari
  // Nezha 配置
  nezha_api_endpoint?: string
  nezha_api_token_set?: boolean
  // Komari 配置
  komari_api_endpoint?: string
  komari_api_token_set?: boolean
  created_at: string
  updated_at: string
}

/**
 * 注册请求
 */
export interface RegisterRequest {
  email: string
  password: string
  verification_code: string
}

export interface InitializeAdminRequest {
  username: string
  email: string
  password: string
  run_mode?: "demo" | "development" | "production"
  verification_code?: string
}

/**
 * 发送验证码请求
 */
export interface SendVerificationCodeRequest {
  email: string
  type?: "register" | "password_reset" | "email_change" // 验证码类型
}

/**
 * 发送验证码响应
 */
export interface SendVerificationCodeResponse {
  message: string
  expires_in: number
}

/**
 * 重置密码请求
 */
export interface ResetPasswordRequest {
  email: string
  verification_code: string
  new_password: string
}

/**
 * 注册响应
 */
export interface RegisterResponse {
  user: User
}

export interface AuthSessionResponse {
  user: User
  access_token: string
  token_type: string
  expires_in: number
}

/**
 * 系统和认证状态响应
 */
export interface AuthStatusResponse {
  need_init: boolean        // 是否需要初始化（无管理员）
  is_authenticated: boolean // 是否已登录
  user?: User               // 已登录时返回用户信息
  system_config?: import("@/lib/api/settings").SystemConfig // 系统公共配置（可选）
  access_token_ttl_seconds?: number // Access Token 统一配置的有效期(秒)
  access_token_expires_in?: number  // 当前 Bearer Token 剩余有效期(秒)，仅用于状态描述
  account_locked?: boolean  // 账户是否被锁定
  locked_until?: string     // 锁定解除时间
  lock_reason?: string      // 锁定原因
}

/**
 * 认证 API 服务
 */
export const authApi = {
  /**
   * 发送邮箱验证码
   * @param email 邮箱地址
   * @param type 验证码类型：register(注册), password_reset(重置密码), email_change(修改邮箱)
   */
  async sendVerificationCode(email: string, type: "register" | "password_reset" | "email_change" = "register"): Promise<SendVerificationCodeResponse> {
    return apiFetch<SendVerificationCodeResponse>("/auth/send-verification-code", {
      method: "POST",
      body: { email, type },
    })
  },

  /**
   * 发送密码重置验证码
   */
  async sendPasswordResetCode(data: SendVerificationCodeRequest): Promise<SendVerificationCodeResponse> {
    return apiFetch<SendVerificationCodeResponse>("/auth/send-password-reset-code", {
      method: "POST",
      body: data,
    })
  },

  /**
   * 重置密码
   */
  async resetPassword(data: ResetPasswordRequest): Promise<void> {
    return apiFetch<void>("/auth/reset-password", {
      method: "POST",
      body: data,
    })
  },

  /**
   * 用户注册
   */
  async register(data: RegisterRequest): Promise<RegisterResponse> {
    return apiFetch<RegisterResponse>("/auth/register", {
      method: "POST",
      body: data,
    })
  },

  /**
   * 用户登出
   * 调用 /oauth/logout，同时撤销服务端会话并清理 refresh_token Cookie
   */
  async logout(): Promise<void> {
    return apiFetch<void>("/oauth/logout", {
      method: "POST",
    })
  },

  /**
   * 获取当前用户信息
   * 通过 Authorization Bearer 获取当前用户
   */
  async getCurrentUser(): Promise<User> {
    return apiFetch<User>("/users/me")
  },

  /**
   * 更新用户资料
   * 通过 Authorization Bearer 更新用户资料
   */
  async updateProfile(data: Partial<User> & { verification_code?: string }): Promise<void> {
    return apiFetch<void>("/users/me", {
      method: "PUT",
      body: data,
    })
  },

  /**
   * 修改密码
   * 通过 Authorization Bearer 修改密码
   */
  async changePassword(data: { old_password: string; new_password: string }): Promise<void> {
    return apiFetch<void>("/users/me/password", {
      method: "PUT",
      body: data,
    })
  },

  /**
   * 检查系统和认证状态
   */
  async checkStatus(options: { refresh?: boolean } = {}): Promise<AuthStatusResponse> {
    // 第一步：直接查询当前状态（如果已有有效 access_token，会被视为已认证）
    let status = await apiFetch<AuthStatusResponse>("/auth/status", {
      method: "GET",
    })

    const sessionTimeout = status.system_config?.tab_session?.session_timeout ?? 30
    if (hasAuthActivityTimedOut(sessionTimeout)) {
      markAuthIdleExpired()
    }
    if (isAuthIdleExpired()) {
      await suspendSessionRefresh()
      void apiFetch<void>("/oauth/logout", { method: "POST" }).catch(() => undefined)
      return {
        ...status,
        is_authenticated: false,
        user: undefined,
      }
    }

    if (
      status.is_authenticated ||
      status.account_locked ||
      !options.refresh
    ) {
      return status
    }

    // 未认证（可能仅存在 refresh_token Cookie），尝试静默刷新一次
    // 注意：refresh_token 保存在 HttpOnly 且 Path=/api/v1/oauth 的 Cookie 中，
    // 无法通过 document.cookie 在 /login 或 /dashboard 等路径检测是否存在，
    // 因此这里不再依赖前端读取 Cookie，而是直接尝试调用统一的 refresh 工具。
    try {
      await refreshAccessToken()

      // 第二步：在拥有新的 access_token 情况下再次查询状态
      status = await apiFetch<AuthStatusResponse>("/auth/status", {
        method: "GET",
      })
      return status
    } catch (error) {
      // Refresh Token 明确无效时按未认证处理；网络或服务异常保留错误语义。
      if (isTerminalRefreshTokenError(error)) {
        return status
      }
      throw error
    }
  },

  /**
   * 初始化管理员账户
   */
  async initializeAdmin(data: InitializeAdminRequest): Promise<AuthSessionResponse> {
    return apiFetch<AuthSessionResponse>("/auth/initialize-admin", {
      method: "POST",
      body: data,
    })
  },

  /**
   * 向 Provider 登录交互端点提交凭证；标准 GET 授权入口会先跳转到该登录页。
   */
  async authorizeWithPkce(params: {
    email: string
    password: string
    response_type?: string
    client_id: string
    redirect_uri: string
    scope?: string
    code_challenge: string
    code_challenge_method: string
    state?: string
    nonce?: string
    remember_login: boolean
  }): Promise<{ code?: string; state?: string; requires_2fa?: boolean; temp_token?: string }> {
    return apiFetch<{ code?: string; state?: string; requires_2fa?: boolean; temp_token?: string }>("/oauth/authorize", {
      method: "POST",
      body: {
        response_type: params.response_type ?? "code",
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        scope: params.scope ?? "openid profile easyssh",
        code_challenge: params.code_challenge,
        code_challenge_method: params.code_challenge_method,
        state: params.state ?? "",
        nonce: params.nonce ?? "",
        email: params.email,
        password: params.password,
        remember_login: params.remember_login,
      },
    })
  },

  /**
   * 使用授权码和 PKCE code_verifier 换取 access_token
   */
  async exchangeCodeForToken(params: {
    code: string
    client_id: string
    redirect_uri: string
    code_verifier: string
  }): Promise<{ access_token: string; token_type: string; expires_in: number }> {
    return apiFetch<{ access_token: string; token_type: string; expires_in: number }>("/oauth/token", {
      method: "POST",
      body: {
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirect_uri,
        client_id: params.client_id,
        code_verifier: params.code_verifier,
      },
    })
  },

  /**
   * 使用 Google Authorization Code + PKCE 登录/注册
   */
  async verifyGoogleCode(params: {
    code: string
    code_verifier: string
    redirect_uri: string
    remember_login: boolean
  }): Promise<{
    access_token: string
    token_type: string
    expires_in: number
    user: User
  }> {
    return apiFetch<{
      access_token: string
      token_type: string
      expires_in: number
      user: User
    }>("/oauth/google/verify", {
      method: "POST",
      body: {
        code: params.code,
        code_verifier: params.code_verifier,
        redirect_uri: params.redirect_uri,
        remember_login: params.remember_login,
      },
    })
  },

  /**
   * 将当前已登录用户与 Google 账号绑定
   */
  async linkGoogleCode(params: {
    code: string
    code_verifier: string
    redirect_uri: string
  }): Promise<{ linked: boolean; user: User }> {
    return apiFetch<{ linked: boolean; user: User }>("/users/me/oauth/google/link", {
      method: "POST",
      body: {
        code: params.code,
        code_verifier: params.code_verifier,
        redirect_uri: params.redirect_uri,
      },
    })
  },

  /**
   * 解除当前已登录用户的 Google 账号绑定
   */
  async unlinkGoogle(): Promise<{ linked: boolean; user: User }> {
    return apiFetch<{ linked: boolean; user: User }>("/users/me/oauth/google/link", {
      method: "DELETE",
    })
  },

  /**
   * 更新监控数据源设置
   * @param data_source 数据源类型: easyssh, nezha, komari
   * @param endpoint API 端点地址（nezha/komari 需要）
   * @param token API Token（nezha/komari 需要）
   * @param set_active 是否设为当前激活的数据源（必须显式传入）
   */
  async updateMonitorDataSource(data: {
    data_source: string   // easyssh, nezha, komari
    endpoint?: string     // API 端点
    token?: string        // API Token
    set_active: boolean   // 是否设为当前激活的数据源
  }): Promise<{ message: string }> {
    return apiFetch<{ message: string }>("/users/me/monitor-datasource", {
      method: "PUT",
      body: data,
    })
  },

  /**
   * 测试监控数据源连接
   */
  async testMonitorDataSourceConnection(data: {
    type: string       // easyssh, nezha, komari
    endpoint?: string  // API 端点
    token?: string     // API Token
  }): Promise<{ message: string }> {
    return apiFetch<{ message: string }>("/monitoring/datasource/test", {
      method: "POST",
      body: data,
    })
  },
}
