import { Suspense, useCallback } from "react"
import { useSearchParams } from "react-router-dom"

import { TaskCenterView } from "@/components/task-center/task-center-view"
import { taskCenterApi } from "@/lib/api/task-center"
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
  const clearRequestedRun = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete("run")
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  return (
    <TaskCenterView
      api={taskCenterApi}
      subscribeEvents={subscribeRealtimeEvents}
      schedulesContent={
        <ResourceBoundary onRetry={schedulesResource.reset}>
          <Suspense fallback={<RoutePending />}><AutomationSchedulesPage embedded /></Suspense>
        </ResourceBoundary>
      }
      requestedRunID={requestedRunID}
      onClearRequestedRun={clearRequestedRun}
    />
  )
}
