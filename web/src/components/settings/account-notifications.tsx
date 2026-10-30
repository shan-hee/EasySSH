import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useClientAuth } from "@easyssh/app/components/client-auth-provider"
import { Switch } from "@easyssh/app/components/ui/switch"
import { SettingsSection } from "@easyssh/app/components/settings/settings-section"
import { ownerApi, type OwnerNotificationsInput } from "../../lib/api/owner"
import { getErrorMessage } from "@easyssh/app/lib/error-utils"

const options = [
  { field: "notify_email_login", label: "notificationsEmailLoginLabel", description: "notificationsEmailLoginDescription" },
  { field: "notify_new_device", label: "notificationsNewDeviceLabel", description: "notificationsNewDeviceDescription" },
  { field: "notify_new_location", label: "notificationsNewLocationLabel", description: "notificationsNewLocationDescription" },
  { field: "notify_task_in_app", label: "notificationsTaskInAppLabel", description: "notificationsTaskInAppDescription" },
  { field: "notify_task_success", label: "notificationsTaskSuccessLabel", description: "notificationsTaskSuccessDescription" },
  { field: "notify_task_failure", label: "notificationsTaskFailureLabel", description: "notificationsTaskFailureDescription" },
  { field: "notify_task_partial", label: "notificationsTaskPartialLabel", description: "notificationsTaskPartialDescription" },
  { field: "notify_task_external", label: "notificationsTaskExternalLabel", description: "notificationsTaskExternalDescription" },
] as const

export function AccountNotifications() {
  const { t } = useTranslation("accountSettings")
  const { user, refreshUser } = useClientAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const update = async (field: keyof OwnerNotificationsInput, value: boolean) => {
    if (busy) return
    setBusy(true); setError("")
    try {
      await ownerApi.updateNotifications({ [field]: value })
      await refreshUser()
    } catch (error) { setError(getErrorMessage(error, t("notificationsUpdateFailed"))) }
    finally { setBusy(false) }
  }
  return <SettingsSection title={t("navNotifications")}>
    <div className="divide-y rounded-lg border">
      {options.map(({ field, label, description }) => <div className="flex items-center justify-between gap-4 p-4" key={field}>
        <label className="space-y-1" htmlFor={`notification-${field}`}>
          <span className="block text-sm font-medium">{t(label)}</span>
          <span className="block text-sm text-muted-foreground">{t(description)}</span>
        </label>
        <Switch id={`notification-${field}`} checked={user?.[field] ?? (field !== "notify_task_external")} disabled={busy || !user} onCheckedChange={(value) => void update(field, value)} />
      </div>)}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </SettingsSection>
}
