import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { openWorkspaceTask } from "@/lib/workspace-task-navigation"
import type { components } from "@/generated/openapi"

export function ActivityLinks({
  sourceTable,
  sourceId,
  resources = [],
}: {
  sourceTable?: string
  sourceId?: string
  resources?: components["schemas"]["ActivityResourceSnapshot"][]
}) {
  const { t } = useTranslation("activityOverview")
  const taskId =
    sourceTable === "task_runs" || sourceTable === "desktop_task_runs"
      ? sourceId
      : undefined
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {taskId && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => openWorkspaceTask(taskId)}
        >
          {t("viewTask")}
        </Button>
      )}
      {resources.map((r) => (
        <span key={r.server_id} className="rounded border px-2 py-1">
          {r.name || r.server_id}
          {r.deleted ? ` · ${t("deletedResource")}` : ""}
        </span>
      ))}
    </div>
  )
}
