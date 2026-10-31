import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { Path, UseFormReturn } from "react-hook-form"
import type { z } from "zod"
import { ChevronRight, Mail, MessageCircle, MessageSquare, Send, Webhook } from "lucide-react"
import { toast } from "sonner"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { useSettingsAPI } from "@/hooks/settings/use-settings-api"
import { notificationConfigSchema } from "@/schemas/settings/integrations.schema"
import { settingsApi, type NotificationConfigUpdate, type NotificationConfigView } from "@/lib/api/settings"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { FormInput, FormSelect } from "@/components/settings/form-field"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

type NotificationForm = z.input<typeof notificationConfigSchema>

// Stored passwords, secrets and webhook URLs are never returned; the form only
// knows whether they exist and leaves them untouched unless a new value is typed.
function fromView(view: NotificationConfigView): NotificationForm {
  return {
    enabled: view.smtp.enabled,
    host: view.smtp.host,
    port: view.smtp.port,
    username: view.smtp.username,
    password: "",
    has_password: view.smtp.has_password,
    from_email: view.smtp.from_email,
    from_name: view.smtp.from_name,
    use_tls: view.smtp.use_tls,
    webhook_enabled: view.webhook.enabled,
    webhook_url: "",
    has_webhook_url: view.webhook.has_url,
    webhook_method: view.webhook.method === "GET" ? "GET" : "POST",
    webhook_secret: "",
    has_webhook_secret: view.webhook.has_secret,
    dingtalk_enabled: view.dingtalk.enabled,
    dingtalk_webhook_url: "",
    has_dingtalk_webhook_url: view.dingtalk.has_webhook_url,
    dingtalk_secret: "",
    has_dingtalk_secret: view.dingtalk.has_secret,
    wecom_enabled: view.wecom.enabled,
    wecom_webhook_url: "",
    has_wecom_webhook_url: view.wecom.has_webhook_url,
  }
}

// Omitted fields keep the stored value; an explicit "" clears it.
const writeOnly = (value: string, saved: boolean) => value || (saved ? undefined : "")

function toUpdate(data: NotificationForm): NotificationConfigUpdate {
  return {
    smtp: {
      enabled: data.enabled,
      host: data.host,
      port: data.port,
      username: data.username,
      password: writeOnly(data.password, data.has_password),
      from_email: data.from_email,
      from_name: data.from_name,
      use_tls: data.use_tls,
    },
    webhook: {
      enabled: data.webhook_enabled,
      url: writeOnly(data.webhook_url, data.has_webhook_url),
      method: data.webhook_method,
      secret: writeOnly(data.webhook_secret, data.has_webhook_secret),
    },
    dingtalk: {
      enabled: data.dingtalk_enabled,
      webhook_url: writeOnly(data.dingtalk_webhook_url, data.has_dingtalk_webhook_url),
      secret: writeOnly(data.dingtalk_secret, data.has_dingtalk_secret),
    },
    wecom: {
      enabled: data.wecom_enabled,
      webhook_url: writeOnly(data.wecom_webhook_url, data.has_wecom_webhook_url),
    },
  }
}

const enabledFields = {
  email: "enabled",
  webhook: "webhook_enabled",
  dingtalk: "dingtalk_enabled",
  wecom: "wecom_enabled",
} satisfies Record<string, Path<NotificationForm>>

type Channel = keyof typeof enabledFields

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
  const { form, isLoading } = useSettingsForm({
    cacheKey: "notifications",
    schema: notificationConfigSchema,
    loadFn: async () => fromView(await settingsApi.getNotificationConfig()),
    saveFn: data => settingsApi.saveNotificationConfig(toUpdate(data)),
  })

  if (isLoading) {
    return <SettingsLoading />
  }

  const current = () => toUpdate(form.getValues())
  const saved = (field: "has_password" | "has_webhook_url" | "has_webhook_secret" | "has_dingtalk_webhook_url" | "has_dingtalk_secret" | "has_wecom_webhook_url") => form.watch(field)
  const savedPlaceholder = t("savedPlaceholder")
  // Optional secrets can be removed; required ones are dropped by disabling the channel.
  const clearable = (field: "has_webhook_secret" | "has_dingtalk_secret") => saved(field) && <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => form.setValue(field, false, { shouldDirty: true })}>{t("clearSaved")}</button>

  return (
    <div className="space-y-4 p-4">
      <ChannelCard form={form} channel="email" icon={<Mail className="size-4" />} onTest={() => settingsApi.testSMTPConnection(current().smtp!)}>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <FormInput form={form} name="host" label={t("email.host")} placeholder="smtp.example.com" required />
          <FormInput form={form} name="port" label={t("email.port")} type="number" placeholder="465" min={1} max={65535} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput form={form} name="username" label={t("email.username")} placeholder="name@example.com" required />
          <FormInput form={form} name="password" label={t("email.password")} type="password" placeholder={saved("has_password") ? savedPlaceholder : undefined} required={!saved("has_password")} />
          <FormInput form={form} name="from_email" label={t("email.fromEmail")} type="email" placeholder="noreply@example.com" required />
          <FormInput form={form} name="from_name" label={t("email.fromName")} placeholder="EasySSH" required />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.watch("use_tls")} onCheckedChange={checked => form.setValue("use_tls", checked, { shouldDirty: true })} />
          {t("email.useTls")}
        </label>
      </ChannelCard>

      <ChannelCard form={form} channel="webhook" icon={<Webhook className="size-4" />} onTest={() => settingsApi.testWebhookConnection(current().webhook!)} help={<WebhookFormat />}>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <FormInput form={form} name="webhook_url" label={t("webhook.url")} type="url" placeholder={saved("has_webhook_url") ? savedPlaceholder : "https://example.com/webhook/easyssh"} required={!saved("has_webhook_url")} />
          <FormSelect form={form} name="webhook_method" label={t("webhook.method")} options={methodOptions} required />
        </div>
        <FormInput form={form} name="webhook_secret" label={t("webhook.secret")} type="password" placeholder={saved("has_webhook_secret") ? savedPlaceholder : t("webhook.secretPlaceholder")} description={clearable("has_webhook_secret")} />
      </ChannelCard>

      <ChannelCard form={form} channel="dingtalk" icon={<MessageSquare className="size-4" />} onTest={() => settingsApi.testDingTalkConnection(current().dingtalk!)}>
        <FormInput form={form} name="dingtalk_webhook_url" label={t("chatbot.url")} type="url" placeholder={saved("has_dingtalk_webhook_url") ? savedPlaceholder : "https://oapi.dingtalk.com/robot/send?access_token=…"} required={!saved("has_dingtalk_webhook_url")} />
        <FormInput form={form} name="dingtalk_secret" label={t("dingtalk.secret")} type="password" placeholder={saved("has_dingtalk_secret") ? savedPlaceholder : "SEC…"} description={clearable("has_dingtalk_secret")} />
      </ChannelCard>

      <ChannelCard form={form} channel="wecom" icon={<MessageCircle className="size-4" />} onTest={() => settingsApi.testWeComConnection(current().wecom!)}>
        <FormInput form={form} name="wecom_webhook_url" label={t("chatbot.url")} type="url" placeholder={saved("has_wecom_webhook_url") ? savedPlaceholder : "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"} required={!saved("has_wecom_webhook_url")} />
      </ChannelCard>
    </div>
  )
}

function ChannelCard({ channel, icon, form, onTest, help, children }: {
  channel: Channel
  icon: ReactNode
  form: UseFormReturn<NotificationForm>
  onTest: () => Promise<void>
  help?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation("settingsNotifications")
  const { execute, isLoading: testing } = useSettingsAPI()
  const enabledField = enabledFields[channel]
  const enabled = !!form.watch(enabledField)
  const title = t(`${channel}.title`)

  return (
    <section className="rounded-lg border">
      <div className="flex items-center gap-3 p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{t(`${channel}.description`)}</p>
        </div>
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
