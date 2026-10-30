import { z } from "zod"

// AI 服务配置 Schema
export const aiConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["openai", "openai-response", "gemini", "anthropic"]),
  api_key: z.string().optional(), // 只写：留空保留原有密钥
  endpoint: z
    .string()
    .url("settingsValidation.systemApiEndpointInvalid")
    .or(z.literal("")),
  models: z.string(), // 模型列表（逗号分隔）
  has_api_key: z.boolean().optional(),
})

export type AIConfigFormValues = z.infer<typeof aiConfigSchema>

// SMTP配置 Schema
export const smtpConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    host: z.string().optional(),
    port: z.number().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    from_email: z.string().optional(),
    from_name: z.string().optional(),
    use_tls: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    // 如果启用了邮件通知，则所有字段都必填
    if (data.enabled) {
      if (!data.host || data.host.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "settingsValidation.smtpHostRequired",
          path: ["host"],
        })
      }
      if (!data.port || data.port < 1 || data.port > 65535) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "settingsValidation.smtpPortMin",
          path: ["port"],
        })
      }
      if (!data.username || data.username.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "settingsValidation.smtpUsernameRequired",
          path: ["username"],
        })
      }
      if (!data.password || data.password.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "settingsValidation.smtpPasswordRequired",
          path: ["password"],
        })
      }
      if (!data.from_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.from_email)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "settingsValidation.smtpFromEmailInvalid",
          path: ["from_email"],
        })
      }
      if (!data.from_name || data.from_name.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "settingsValidation.smtpFromNameRequired",
          path: ["from_name"],
        })
      }
    }
  })

// 钉钉配置 Schema
export const dingTalkConfigSchema = z.object({
  dingtalk_enabled: z.boolean(),
  dingtalk_webhook_url: z
    .string()
    .url("settingsValidation.dingtalkWebhookUrlInvalid")
    .or(z.literal("")),
  dingtalk_secret: z.string().optional(),
})

// 企业微信配置 Schema
export const weComConfigSchema = z.object({
  wecom_enabled: z.boolean(),
  wecom_webhook_url: z
    .string()
    .url("settingsValidation.wecomWebhookUrlInvalid")
    .or(z.literal("")),
})

// Webhook配置 Schema
export const webhookConfigSchema = z.object({
  webhook_enabled: z.boolean(),
  webhook_url: z.string().url("settingsValidation.webhookUrlInvalid").or(z.literal("")),
  webhook_method: z.enum(["POST", "GET"]),
  webhook_secret: z.string().optional(),
})

// 通知配置 Schema（仅包含通知相关的配置）
export const notificationConfigSchema = smtpConfigSchema
  .safeExtend(dingTalkConfigSchema.shape)
  .safeExtend(weComConfigSchema.shape)
  .safeExtend(webhookConfigSchema.shape)

// 导出类型
export type SMTPConfigFormData = z.infer<typeof smtpConfigSchema>
export type DingTalkConfigFormData = z.infer<typeof dingTalkConfigSchema>
export type WeComConfigFormData = z.infer<typeof weComConfigSchema>
export type WebhookConfigFormData = z.infer<typeof webhookConfigSchema>
