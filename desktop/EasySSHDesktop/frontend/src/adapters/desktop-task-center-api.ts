import { resolveTaskDetails, resolveTaskEvents } from "@easyssh/app/components/task-center/task-content"
import { DesktopContentService } from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app"
import { ContentReadInput, TaskEventInput } from "../../bindings/github.com/easyssh/shared/protocol/models"
import type { ContentChunkReader } from "@easyssh/app/lib/content"
import { Events } from "@wailsio/runtime"
import { DEFAULT_TABLE_PAGE_SIZE } from "@easyssh/app/lib/table-pagination"

import type {
  RealtimeEvent,
  RealtimeEventListener,
  TaskCenterApi,
  TaskRun,
  TaskRunListParams,
  TaskRunStatus,
} from "@easyssh/app/components/task-center/task-center-contracts"
import {
  DesktopTaskListInput,
  DesktopTaskService,
} from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app"

const desktopTaskChangedEvent = "desktop:task-center-changed"

const readBody: ContentChunkReader = (ref, offset) => DesktopContentService.ReadContent(ref.id, new ContentReadInput({ offset, sha256: ref.sha256 }))

export function createDesktopTaskCenterApi(): TaskCenterApi {
  return {
    async list(params: TaskRunListParams = {}) {
      const result = await DesktopTaskService.List(new DesktopTaskListInput({
        status: params.status ?? [],
        task_type: params.task_type ?? [],
        trigger_type: params.trigger_type ?? [],
        exclude_micro: params.exclude_micro ?? false,
        keyword: params.keyword ?? "",
        page: params.page ?? 1,
        page_size: params.page_size ?? DEFAULT_TABLE_PAGE_SIZE,
      }))
      return result as unknown as Awaited<ReturnType<TaskCenterApi["list"]>>
    },

    async statistics() {
      return await DesktopTaskService.Statistics() as unknown as Awaited<ReturnType<TaskCenterApi["statistics"]>>
    },

    async get(id: string) {
      const details = await DesktopTaskService.Get(id)
      const page = await DesktopTaskService.ListEvents(id, new TaskEventInput({ after_id: 0, limit: 50 }))
      if (!page) throw new Error("Task events unavailable")
      const eventPage = await resolveTaskEvents(page, readBody)
      return { run: await resolveTaskDetails(details, readBody), events: eventPage.events, eventPage }
    },

    async events(id, after) {
      const page = await DesktopTaskService.ListEvents(id, new TaskEventInput({ after_id: after, limit: 50 }))
      if (!page) throw new Error("Task events unavailable")
      return resolveTaskEvents(page, readBody)
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
    const payload = (event.data ?? {}) as {
      type?: string
      task_id?: string
      status?: string
      progress?: number
      stage?: string
    }
    const data: Record<string, unknown> = {}
    if (payload.task_id) data.task_id = payload.task_id
    if (typeof payload.status === "string" && payload.status) data.status = payload.status
    if (typeof payload.progress === "number") data.progress = payload.progress
    if (typeof payload.stage === "string") data.stage = payload.stage
    const realtimeEvent: RealtimeEvent = {
      id: `${Date.now()}`,
      type: payload.type ?? "task.updated",
      data,
      created_at: new Date().toISOString(),
    }
    listener(realtimeEvent)
  })
}
