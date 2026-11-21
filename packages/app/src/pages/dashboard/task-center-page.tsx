import { Suspense, useCallback, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { TaskCenterView } from "@/components/task-center/task-center-view"
import type { TaskRun } from "@/components/task-center/task-center-contracts"
import { taskCenterApi } from "@/lib/api/task-center"
import { transferJobsApi } from "@/lib/api/transfer-jobs"
import { subscribeRealtimeEvents } from "@/lib/api/realtime-events"
import { createPreloadableComponent } from "@/lib/preloadable-component"
import { preloadNamespaces } from "@/i18n"
import { RoutePending } from "@/components/route-pending"
import { ResourceBoundary } from "@/components/resource-boundary"

const schedulesResource = createPreloadableComponent(async () => {
  const [module] = await Promise.all([
    import("@/pages/dashboard/automation-schedules-page"),
    preloadNamespaces(["automationSchedules"]),
  ])
  return module
})
const AutomationSchedulesPage = schedulesResource.Component

export default function TaskCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedRunID = searchParams.get("run")
  const activeTab = searchParams.get("tab") === "schedules" ? "schedules" : "runs"
  const definitionId = searchParams.get("definition")
  const [definitionName, setDefinitionName] = useState<string | undefined>(undefined)

  const handleTabChange = useCallback((tab: "runs" | "schedules") => {
    const next = new URLSearchParams(searchParams)
    if (tab === "schedules") next.set("tab", "schedules")
    else next.delete("tab")
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const clearRequestedRun = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete("run")
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const clearDefinitionFilter = useCallback(() => {
    setDefinitionName(undefined)
    const next = new URLSearchParams(searchParams)
    next.delete("definition")
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const handleViewScheduleRuns = useCallback((task: { id: string; task_name: string }) => {
    setDefinitionName(task.task_name)
    const next = new URLSearchParams(searchParams)
    next.delete("tab")
    next.set("definition", task.id)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const handleDownloadArtifact = useCallback(async (run: TaskRun) => {
    if (!run.source_id) return
    const job = await transferJobsApi.getById(run.source_id)
    await transferJobsApi.downloadArtifact(job)
  }, [])

  return (
    <TaskCenterView
      api={taskCenterApi}
      subscribeEvents={subscribeRealtimeEvents}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      definitionFilter={definitionId ? { id: definitionId, name: definitionName } : null}
      onClearDefinitionFilter={clearDefinitionFilter}
      onDownloadArtifact={handleDownloadArtifact}
      schedulesContent={
        <ResourceBoundary onRetry={schedulesResource.reset}>
          <Suspense fallback={<RoutePending />}>
            <AutomationSchedulesPage embedded onViewRuns={handleViewScheduleRuns} />
          </Suspense>
        </ResourceBoundary>
      }
      requestedRunID={requestedRunID}
      onClearRequestedRun={clearRequestedRun}
    />
  )
}
