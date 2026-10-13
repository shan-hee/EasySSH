import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useClientAuth } from "@/components/client-auth-provider"
import { Switch } from "@/components/ui/switch"
import { SettingsSection } from "./settings-section"
import { notificationsApi, type NotificationSettings } from "@/lib/api/notifications"
import { getErrorMessage } from "@/lib/error-utils"

const options = [
  { field: "email_login", userField: "notify_email_login", label: "notificationsEmailLoginLabel", description: "notificationsEmailLoginDescription" },
  { field: "new_device", userField: "notify_new_device", label: "notificationsNewDeviceLabel", description: "notificationsNewDeviceDescription" },
  { field: "new_location", userField: "notify_new_location", label: "notificationsNewLocationLabel", description: "notificationsNewLocationDescription" },
  { field: "task_in_app", userField: "notify_task_in_app", label: "notificationsTaskInAppLabel", description: "notificationsTaskInAppDescription" },
  { field: "task_success", userField: "notify_task_success", label: "notificationsTaskSuccessLabel", description: "notificationsTaskSuccessDescription" },
  { field: "task_failure", userField: "notify_task_failure", label: "notificationsTaskFailureLabel", description: "notificationsTaskFailureDescription" },
  { field: "task_partial", userField: "notify_task_partial", label: "notificationsTaskPartialLabel", description: "notificationsTaskPartialDescription" },
  { field: "task_external", userField: "notify_task_external", label: "notificationsTaskExternalLabel", description: "notificationsTaskExternalDescription" },
] as const

export function AccountNotifications() {
  const { t } = useTranslation("accountSettings")
  const { user, refreshUser } = useClientAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const update = async (field: keyof NotificationSettings, value: boolean) => {
    if (busy) return
    setBusy(true); setError("")
    try {
      await notificationsApi.update({ [field]: value })
      await refreshUser()
    } catch (error) { setError(getErrorMessage(error, t("notificationsUpdateFailed"))) }
    finally { setBusy(false) }
  }
  return <SettingsSection title={t("navNotifications")}>
    <div className="divide-y rounded-lg border">
      {options.map(({ field, userField, label, description }) => <div className="flex items-center justify-between gap-4 p-4" key={field}>
        <label className="space-y-1" htmlFor={`notification-${field}`}>
          <span className="block text-sm font-medium">{t(label)}</span>
          <span className="block text-sm text-muted-foreground">{t(description)}</span>
        </label>
        <Switch id={`notification-${field}`} checked={user?.[userField] ?? (field !== "task_external")} disabled={busy || !user} onCheckedChange={(value) => void update(field, value)} />
      </div>)}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </SettingsSection>
}
