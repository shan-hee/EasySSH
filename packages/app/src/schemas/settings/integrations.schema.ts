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
const optionalUrl = (message: string) => z.string().url(message).or(z.literal(""))

// 通知配置：密码、密钥与 Webhook 地址只写，has_* 表示已保存，留空保持不变
export const notificationConfigSchema = z
  .object({
    enabled: z.boolean(),
    host: z.string(),
    port: z.number(),
    username: z.string(),
    password: z.string(),
    has_password: z.boolean(),
    from_email: z.string(),
    from_name: z.string(),
    use_tls: z.boolean(),
    webhook_enabled: z.boolean(),
    webhook_url: optionalUrl("settingsValidation.webhookUrlInvalid"),
    has_webhook_url: z.boolean(),
    webhook_method: z.enum(["POST", "GET"]),
    webhook_secret: z.string(),
    has_webhook_secret: z.boolean(),
    dingtalk_enabled: z.boolean(),
    dingtalk_webhook_url: optionalUrl("settingsValidation.dingtalkWebhookUrlInvalid"),
    has_dingtalk_webhook_url: z.boolean(),
    dingtalk_secret: z.string(),
    has_dingtalk_secret: z.boolean(),
    wecom_enabled: z.boolean(),
    wecom_webhook_url: optionalUrl("settingsValidation.wecomWebhookUrlInvalid"),
    has_wecom_webhook_url: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const require = (missing: boolean, path: string, message: string) => {
      if (missing) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] })
    }
    if (data.enabled) {
      require(!data.host, "host", "settingsValidation.smtpHostRequired")
      require(!data.port || data.port < 1 || data.port > 65535, "port", "settingsValidation.smtpPortMin")
      require(!data.username, "username", "settingsValidation.smtpUsernameRequired")
      require(!data.password && !data.has_password, "password", "settingsValidation.smtpPasswordRequired")
      require(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.from_email), "from_email", "settingsValidation.smtpFromEmailInvalid")
      require(!data.from_name, "from_name", "settingsValidation.smtpFromNameRequired")
    }
    require(data.webhook_enabled && !data.webhook_url && !data.has_webhook_url, "webhook_url", "settingsValidation.webhookUrlInvalid")
    require(data.dingtalk_enabled && !data.dingtalk_webhook_url && !data.has_dingtalk_webhook_url, "dingtalk_webhook_url", "settingsValidation.dingtalkWebhookUrlInvalid")
    require(data.wecom_enabled && !data.wecom_webhook_url && !data.has_wecom_webhook_url, "wecom_webhook_url", "settingsValidation.wecomWebhookUrlInvalid")
  })

export type NotificationConfigFormData = z.infer<typeof notificationConfigSchema>
