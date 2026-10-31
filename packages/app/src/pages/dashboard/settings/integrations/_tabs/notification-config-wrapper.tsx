import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { Path, UseFormReturn } from "react-hook-form"
import type { z } from "zod"
import { ChevronRight, Mail, MessageCircle, MessageSquare, Send, Webhook } from "lucide-react"
import { toast } from "sonner"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { useSettingsAPI } from "@/hooks/settings/use-settings-api"
import { notificationConfigSchema } from "@/schemas/settings/integrations.schema"
import { settingsApi, type NotificationConfig } from "@/lib/api/settings"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { SettingsFormActions } from "@/components/settings/settings-form-actions"
import { FormInput, FormSelect } from "@/components/settings/form-field"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

type NotificationForm = z.input<typeof notificationConfigSchema>

// The API nests each channel; the form keeps the historical flat field names.
function fromConfig(config: NotificationConfig): NotificationForm {
  return {
    enabled: config.smtp.enabled,
    host: config.smtp.host,
    port: config.smtp.port,
    username: config.smtp.username,
    password: config.smtp.password,
    from_email: config.smtp.from_email,
    from_name: config.smtp.from_name,
    use_tls: config.smtp.use_tls,
    webhook_enabled: config.webhook.enabled,
    webhook_url: config.webhook.url,
    webhook_method: config.webhook.method,
    webhook_secret: config.webhook.secret,
    dingtalk_enabled: config.dingtalk.enabled,
    dingtalk_webhook_url: config.dingtalk.webhook_url,
    dingtalk_secret: config.dingtalk.secret,
    wecom_enabled: config.wecom.enabled,
    wecom_webhook_url: config.wecom.webhook_url,
  }
}

function toConfig(data: NotificationForm): NotificationConfig {
  return {
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
}

// The first field of each channel is its enable switch.
const channelFields = {
  email: ["enabled", "host", "port", "username", "password", "from_email", "from_name", "use_tls"],
  webhook: ["webhook_enabled", "webhook_url", "webhook_method", "webhook_secret"],
  dingtalk: ["dingtalk_enabled", "dingtalk_webhook_url", "dingtalk_secret"],
  wecom: ["wecom_enabled", "wecom_webhook_url"],
} satisfies Record<string, Path<NotificationForm>[]>

type Channel = keyof typeof channelFields

const methodOptions = [
  { label: "POST", value: "POST" },
  { label: "GET", value: "GET" },
]

const webhookSample = `{
  "event": "task.failed",
  "timestamp": 1767225600,
  "data": {
    "event_id": "…",
    "notification": { "event_type": "task.failed", "severity": "error", "title": "…", "message": "…" },
    "task": { "id": "…", … }
  }
}`

// Node.js verification against the raw request body.
const signatureSample = `const expected = Buffer.from("sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex"))
const received = Buffer.from(req.headers["x-easyssh-signature"] ?? "")
const valid = received.length === expected.length && crypto.timingSafeEqual(received, expected)`

export function NotificationConfigWrapper() {
  const { t } = useTranslation("settingsNotifications")
  const { form, isLoading, isSaving, handleSave } = useSettingsForm({
    cacheKey: "notifications",
    schema: notificationConfigSchema,
    loadFn: async () => fromConfig(await settingsApi.getNotificationConfig()),
    saveFn: data => settingsApi.saveNotificationConfig(toConfig(data)),
  })

  if (isLoading) {
    return <SettingsLoading />
  }

  const card = { form, isSaving, onSave: handleSave }
  const current = () => toConfig(form.getValues())

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <ChannelCard {...card} channel="email" icon={<Mail className="size-4" />} onTest={() => settingsApi.testSMTPConnection(current().smtp)}>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <FormInput form={form} name="host" label={t("email.host")} placeholder="smtp.example.com" required />
          <FormInput form={form} name="port" label={t("email.port")} type="number" placeholder="465" min={1} max={65535} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput form={form} name="username" label={t("email.username")} placeholder="name@example.com" required />
          <FormInput form={form} name="password" label={t("email.password")} type="password" required />
          <FormInput form={form} name="from_email" label={t("email.fromEmail")} type="email" placeholder="noreply@example.com" required />
          <FormInput form={form} name="from_name" label={t("email.fromName")} placeholder="EasySSH" required />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.watch("use_tls")} onCheckedChange={checked => form.setValue("use_tls", checked, { shouldDirty: true })} />
          {t("email.useTls")}
        </label>
      </ChannelCard>

      <ChannelCard {...card} channel="webhook" icon={<Webhook className="size-4" />} onTest={() => settingsApi.testWebhookConnection(current().webhook)} help={<WebhookFormat />}>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <FormInput form={form} name="webhook_url" label={t("webhook.url")} type="url" placeholder="https://example.com/webhook/easyssh" required />
          <FormSelect form={form} name="webhook_method" label={t("webhook.method")} options={methodOptions} required />
        </div>
        <FormInput form={form} name="webhook_secret" label={t("webhook.secret")} type="password" placeholder={t("webhook.secretPlaceholder")} />
      </ChannelCard>

      <ChannelCard {...card} channel="dingtalk" icon={<MessageSquare className="size-4" />} onTest={() => settingsApi.testDingTalkConnection(current().dingtalk)}>
        <FormInput form={form} name="dingtalk_webhook_url" label={t("chatbot.url")} type="url" placeholder="https://oapi.dingtalk.com/robot/send?access_token=…" required />
        <FormInput form={form} name="dingtalk_secret" label={t("dingtalk.secret")} type="password" placeholder="SEC…" />
      </ChannelCard>

      <ChannelCard {...card} channel="wecom" icon={<MessageCircle className="size-4" />} onTest={() => settingsApi.testWeComConnection(current().wecom)}>
        <FormInput form={form} name="wecom_webhook_url" label={t("chatbot.url")} type="url" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" required />
      </ChannelCard>
    </div>
  )
}

function ChannelCard({ channel, icon, form, isSaving, onSave, onTest, help, children }: {
  channel: Channel
  icon: ReactNode
  form: UseFormReturn<NotificationForm>
  isSaving: boolean
  onSave: () => void | Promise<void>
  onTest: () => Promise<void>
  help?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation("settingsNotifications")
  const { execute, isLoading: testing } = useSettingsAPI()
  const fields = channelFields[channel]
  const enabledField = fields[0]
  const enabled = !!form.watch(enabledField)
  const dirty = fields.some(field => form.formState.dirtyFields[field])
  const title = t(`${channel}.title`)

  return (
    <section className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{t(`${channel}.description`)}</p>
        </div>
        <SettingsFormActions visible={dirty} isSaving={isSaving} onReset={() => fields.forEach(field => form.resetField(field))} onSave={onSave} />
        <Switch aria-label={title} checked={enabled} onCheckedChange={checked => form.setValue(enabledField, checked, { shouldDirty: true, shouldValidate: true })} />
      </div>
      {enabled && <div className="space-y-4 border-t p-4">
        {children}
        <Button type="button" variant="outline" size="sm" disabled={testing} onClick={() => void execute(async () => {
          await onTest()
          toast.success(t(`${channel}.testSuccess`))
        })}>
          <Send className={cn("size-4", testing && "animate-pulse")} />
          {testing ? t("testing") : t(`${channel}.test`)}
        </Button>
        {help}
      </div>}
    </section>
  )
}

function WebhookFormat() {
  const { t } = useTranslation("settingsNotifications")
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />{t("webhook.formatTitle")}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-2 text-xs text-muted-foreground">
          <p>{t("webhook.formatBody")}</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-foreground">{webhookSample}</pre>
          <p>{t("webhook.formatEvents")}</p>
          <p>{t("webhook.formatSignature")}</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-foreground">{signatureSample}</pre>
          <p>{t("webhook.formatDelivery")}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
