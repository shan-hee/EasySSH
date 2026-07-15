import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"

import { TaskCenterView } from "@/components/task-center/task-center-view"
import { taskCenterApi } from "@/lib/api/task-center"
import { subscribeRealtimeEvents } from "@/lib/api/realtime-events"
import AutomationSchedulesPage from "@/pages/dashboard/automation-schedules-page"

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
      schedulesContent={<AutomationSchedulesPage embedded />}
      requestedRunID={requestedRunID}
      onClearRequestedRun={clearRequestedRun}
    />
  )
}
