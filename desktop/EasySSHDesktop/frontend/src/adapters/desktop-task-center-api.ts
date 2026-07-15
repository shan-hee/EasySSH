import { Events } from "@wailsio/runtime"

import type {
  RealtimeEvent,
  RealtimeEventListener,
  TaskCenterApi,
  TaskRun,
  TaskRunListParams,
  TaskRunStatus,
} from "@/components/task-center/task-center-contracts"
import {
  DesktopTaskListInput,
  DesktopTaskService,
} from "../../bindings/github.com/easyssh/easyssh-desktop"

const desktopTaskChangedEvent = "desktop:task-center-changed"

export function createDesktopTaskCenterApi(): TaskCenterApi {
  return {
    async list(params: TaskRunListParams = {}) {
      const result = await DesktopTaskService.List(new DesktopTaskListInput({
        status: params.status ?? [],
        task_type: params.task_type ?? [],
        trigger_type: params.trigger_type ?? [],
        keyword: params.keyword ?? "",
        page: params.page ?? 1,
        page_size: params.page_size ?? 50,
      }))
      return result as unknown as Awaited<ReturnType<TaskCenterApi["list"]>>
    },

    async statistics() {
      return await DesktopTaskService.Statistics() as unknown as Awaited<ReturnType<TaskCenterApi["statistics"]>>
    },

    async cleanup(retentionDays: number) {
      return await DesktopTaskService.Cleanup(retentionDays) as unknown as Awaited<ReturnType<TaskCenterApi["cleanup"]>>
    },

    async get(id: string) {
      return await DesktopTaskService.Get(id) as unknown as Awaited<ReturnType<TaskCenterApi["get"]>>
    },

    async cancel(id: string) {
      const run = await DesktopTaskService.Cancel(id) as unknown as TaskRun
      return { id: run.id, status: run.status as TaskRunStatus }
    },

    async retry(id: string) {
      const result = await DesktopTaskService.Retry(id)
      const retriedRunID = result.id?.trim()
      if (!retriedRunID) {
        throw new Error("Desktop task retry did not return a task ID")
      }
      return {
        id: retriedRunID,
        retry_of_id: result.retry_of_id ?? id,
      }
    },
  }
}

export function subscribeDesktopTaskEvents(listener: RealtimeEventListener): () => void {
  return Events.On(desktopTaskChangedEvent, (event) => {
    const payload = (event.data ?? {}) as { type?: string; task_id?: string }
    const realtimeEvent: RealtimeEvent = {
      id: `${Date.now()}`,
      type: payload.type ?? "task.updated",
      data: payload.task_id ? { task_id: payload.task_id } : {},
      created_at: new Date().toISOString(),
    }
    listener(realtimeEvent)
  })
}
