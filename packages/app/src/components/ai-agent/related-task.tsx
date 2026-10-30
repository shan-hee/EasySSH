import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { openWorkspaceTask } from "@/lib/workspace-task-navigation"

/** Tool call IDs are not task-center IDs. Link only an explicit execution result reference. */
export function RelatedTask({ result }: { result?: string }) {
  const { t } = useTranslation("aiAssistant")
  if (!result) return null
  let id: unknown
  try {
    const value = JSON.parse(result.slice(result.indexOf("{")))
    id = value.task_run_id ?? value.task_id ?? value.operation?.task_id
  } catch {
    return null
  }
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
  )
    return null
  const taskId = id
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => openWorkspaceTask(taskId)}
    >
      {t("workspaceRelatedTask")}
    </Button>
  )
}
