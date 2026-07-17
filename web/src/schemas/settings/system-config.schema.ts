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
  // 注册配置
  allow_registration: z.boolean().default(false),
	default_role: z.string().min(2).max(64).default("user"),
  // OAuth 配置
  oauth_enabled: z.boolean().default(false),
  google_client_id: z.string().optional(),
  google_client_secret: z.string().optional(),
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
  transfer_storage_path: z.string().default(""),
  transfer_retention_days: z.number().min(1).max(30).default(3),
  transfer_max_storage_gb: z.number().min(1).max(1024).default(10),
  transfer_max_concurrency: z.number().min(1).max(16).default(2),
  transfer_cleanup_enabled: z.boolean().default(true),
})

// 导出类型
export type BasicInfoFormData = z.infer<typeof basicInfoSchema>
export type FileTransferFormData = z.infer<typeof fileTransferSchema>
