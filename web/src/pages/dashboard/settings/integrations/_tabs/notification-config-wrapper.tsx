
import { EmailNotificationTab } from "./email-notification-tab"
import { WebhookNotificationTab } from "./webhook-notification-tab"
import { DingTalkNotificationTab } from "./dingtalk-notification-tab"
import { WeComNotificationTab } from "./wecom-notification-tab"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { notificationConfigSchema } from "@/schemas/settings/integrations.schema"
import { settingsApi } from "@/lib/api/settings"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { SettingsFormActions } from "@/components/settings/settings-form-actions"

export function NotificationConfigWrapper() {
  const { form, isLoading, isSaving, handleSave } = useSettingsForm({
    schema: notificationConfigSchema,
    loadFn: async () => {
      // 使用统一的通知配置 API
      const config = await settingsApi.getNotificationConfig()

      // 将嵌套结构转换为扁平结构（匹配表单字段名）
      return {
        // SMTP 配置
        enabled: config.smtp.enabled,
        host: config.smtp.host,
        port: config.smtp.port,
        username: config.smtp.username,
        password: config.smtp.password,
        from_email: config.smtp.from_email,
        from_name: config.smtp.from_name,
        use_tls: config.smtp.use_tls,

        // Webhook 配置
        webhook_enabled: config.webhook.enabled,
        webhook_url: config.webhook.url,
        webhook_method: config.webhook.method,
        webhook_secret: config.webhook.secret,

        // 钉钉配置
        dingtalk_enabled: config.dingtalk.enabled,
        dingtalk_webhook_url: config.dingtalk.webhook_url,
        dingtalk_secret: config.dingtalk.secret,

        // 企业微信配置
        wecom_enabled: config.wecom.enabled,
        wecom_webhook_url: config.wecom.webhook_url,
      }
    },
    saveFn: async (data) => {
      // 将扁平结构转换为嵌套结构（匹配 API 格式）
      const config = {
        smtp: {
          enabled: data.enabled ?? false,
          host: data.host ?? "",
          port: data.port ?? 587,
          username: data.username ?? "",
          password: data.password ?? "",
          from_email: data.from_email ?? "",
          from_name: data.from_name ?? "",
          use_tls: data.use_tls ?? true,
        },
        webhook: {
          enabled: data.webhook_enabled ?? false,
          url: data.webhook_url ?? "",
          method: data.webhook_method ?? "POST",
          secret: data.webhook_secret ?? "",
        },
        dingtalk: {
          enabled: data.dingtalk_enabled ?? false,
          webhook_url: data.dingtalk_webhook_url ?? "",
          secret: data.dingtalk_secret ?? "",
        },
        wecom: {
          enabled: data.wecom_enabled ?? false,
          webhook_url: data.wecom_webhook_url ?? "",
        },
      }

      // 使用统一的通知配置 API 保存
      await settingsApi.saveNotificationConfig(config)
    },
  })

  if (isLoading) {
    return <SettingsLoading />
  }

  const dirtyFields = form.formState.dirtyFields
  const emailDirty = Boolean(
    dirtyFields.enabled ||
    dirtyFields.host ||
    dirtyFields.port ||
    dirtyFields.username ||
    dirtyFields.password ||
    dirtyFields.from_email ||
    dirtyFields.from_name ||
    dirtyFields.use_tls,
  )
  const webhookDirty = Boolean(
    dirtyFields.webhook_enabled ||
    dirtyFields.webhook_url ||
    dirtyFields.webhook_method ||
    dirtyFields.webhook_secret,
  )
  const dingTalkDirty = Boolean(
    dirtyFields.dingtalk_enabled ||
    dirtyFields.dingtalk_webhook_url ||
    dirtyFields.dingtalk_secret,
  )
  const weComDirty = Boolean(dirtyFields.wecom_enabled || dirtyFields.wecom_webhook_url)

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* 可滚动内容区 - flex-1 + min-h-0 确保正确收缩 */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom p-4">
        <div className="space-y-6">
          {/* 邮件通知 */}
          <EmailNotificationTab
            form={form}
            actions={<SettingsFormActions visible={emailDirty} isSaving={isSaving} onReset={() => {
              form.resetField("enabled")
              form.resetField("host")
              form.resetField("port")
              form.resetField("username")
              form.resetField("password")
              form.resetField("from_email")
              form.resetField("from_name")
              form.resetField("use_tls")
            }} onSave={handleSave} />}
          />

          {/* Webhook 通知 */}
          <WebhookNotificationTab
            form={form}
            actions={<SettingsFormActions visible={webhookDirty} isSaving={isSaving} onReset={() => {
              form.resetField("webhook_enabled")
              form.resetField("webhook_url")
              form.resetField("webhook_method")
              form.resetField("webhook_secret")
            }} onSave={handleSave} />}
          />

          {/* 钉钉通知 */}
          <DingTalkNotificationTab
            form={form}
            actions={<SettingsFormActions visible={dingTalkDirty} isSaving={isSaving} onReset={() => {
              form.resetField("dingtalk_enabled")
              form.resetField("dingtalk_webhook_url")
              form.resetField("dingtalk_secret")
            }} onSave={handleSave} />}
          />

          {/* 企业微信通知 */}
          <WeComNotificationTab
            form={form}
            actions={<SettingsFormActions visible={weComDirty} isSaving={isSaving} onReset={() => {
              form.resetField("wecom_enabled")
              form.resetField("wecom_webhook_url")
            }} onSave={handleSave} />}
          />
        </div>
      </div>
    </div>
  )
}
