import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Call } from "@wailsio/runtime"
import { toast } from "@easyssh/ssh-workspace/desktop"

export function DesktopInstanceNotice() {
  const { t } = useTranslation("settingsManagementBackup")
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const info = await Call.ByName("main.DesktopBackupService.GetInstanceActivation") as {
        operation?: { id: string; status: string }
      }
      const operation = info.operation
      if (cancelled || !operation || operation.status === "switching") return
      const key = "easyssh:last-instance-operation"
      if (localStorage.getItem(key) === operation.id) return
      localStorage.setItem(key, operation.id)
      if (operation.status === "succeeded") toast.success(t("instanceDesktopRestartSucceeded"))
      else toast.warning(t("instanceDesktopRestartRolledBack"), { duration: 15000 })
    })().catch(error => { console.error("Could not read instance activation status", error) })
    return () => { cancelled = true }
  }, [t])
  return null
}
