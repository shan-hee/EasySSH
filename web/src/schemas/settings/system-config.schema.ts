import { z } from "zod"

// 基本信息 Schema（包含国际化设置）
export const basicInfoSchema = z.object({
  system_name: z
    .string()
    .min(1, "settingsValidation.systemNameRequired")
    .max(100, "settingsValidation.systemNameMax"),
  system_logo: z.string().url("settingsValidation.urlInvalid").or(z.literal("")),
  system_favicon: z.string().url("settingsValidation.urlInvalid").or(z.literal("")),
  default_language: z.enum(["zh-CN", "en-US"], {
    message: "settingsValidation.defaultLanguageInvalid",
  }),
  default_timezone: z.string().min(1, "settingsValidation.defaultTimezoneRequired"),
  date_format: z.string().min(1, "settingsValidation.dateFormatRequired"),
})

export const registrationConfigSchema = z.object({
  allow_registration: z.boolean().default(false),
  default_role: z.string().min(2).max(64).default("user"),
})

export const googleAuthConfigSchema = z.object({
  oauth_enabled: z.boolean().default(false),
  google_client_id: z.string().default(""),
  google_client_secret: z.string().default(""),
})

export const oauthProviderConfigSchema = z.object({
  oauth_access_token_minutes: z.number().min(5).max(1440),
  oauth_refresh_token_days: z.number().min(1).max(365),
  external_oauth_provider_enabled: z.boolean(),
  external_oauth_issuer: z.string().default(""),
  external_oauth_login_url: z.string().default(""),
  external_oauth_redirect_uris: z.string().default(""),
})

// 文件传输设置 Schema（包含上传大小限制）
export const fileTransferSchema = z.object({
  // 下载排除规则（每行一个）
  download_exclude_patterns: z.string().default(
    "node_modules\n.git\n.svn\n.hg\n__pycache__\n.pytest_cache\ndist\nbuild\ntarget\nvendor\n.DS_Store\nthumbs.db"
  ),
  // 默认下载模式
  default_download_mode: z
    .enum(["fast", "compatible"], {
      message: "settingsValidation.downloadModeInvalid",
    })
    .default("fast"),
  // 上传时自动跳过排除的文件
  skip_excluded_on_upload: z.boolean().default(true),
  // 最大文件上传大小
  max_file_upload_size: z
    .number()
    .min(1, "settingsValidation.fileUploadSizeMin")
    .max(1024, "settingsValidation.fileUploadSizeMax"),
})

// 导出类型
export type BasicInfoFormData = z.infer<typeof basicInfoSchema>
export type RegistrationConfigFormData = z.infer<typeof registrationConfigSchema>
export type GoogleAuthConfigFormData = z.infer<typeof googleAuthConfigSchema>
export type OAuthProviderConfigFormData = z.infer<typeof oauthProviderConfigSchema>
export type FileTransferFormData = z.infer<typeof fileTransferSchema>
