import type { components } from "@/generated/openapi"
import { readContentJSON, type ContentChunkReader } from "@/lib/content"
import type { TaskRun, TaskEvent } from "./task-center-contracts"

export async function resolveTaskDetails(
  details: {
    run: Omit<TaskRun, "status" | "trigger_type"> & {
      status: string
      trigger_type: string
    }
    content: {
      data?: Record<string, unknown> | null
      content?: components["schemas"]["ContentReference"] | null
    }
  },
  reader: ContentChunkReader,
): Promise<TaskRun> {
  const body = details.content.content
    ? await readContentJSON<components["schemas"]["TaskBody"]>(
        details.content.content,
        reader,
      )
    : (details.content.data as components["schemas"]["TaskBody"] | undefined)
  if (!body || body.task_run_id !== details.run.id)
    throw new Error("Task content does not match the selected task")
  const status = details.run.status
  const trigger = details.run.trigger_type
  if (
    status !== "queued" &&
    status !== "running" &&
    status !== "succeeded" &&
    status !== "failed" &&
    status !== "partial_success" &&
    status !== "canceling" &&
    status !== "canceled" &&
    status !== "timeout" &&
    status !== "unknown"
  )
    throw new Error("Unsupported task status")
  if (
    trigger !== "manual" &&
    trigger !== "scheduled" &&
    trigger !== "system" &&
    trigger !== "api"
  )
    throw new Error("Unsupported task trigger")
  return {
    ...details.run,
    status,
    trigger_type: trigger,
    description: body.description,
    result_json: body.result_json,
    progress_json: body.progress_json,
  }
}
export async function resolveTaskEvents(
  page: {
    task_run_id: string
    next_after_id: number
    has_more: boolean
    events: Array<
      TaskEvent & { content?: components["schemas"]["ContentReference"] | null }
    >
  },
  reader: ContentChunkReader,
) {
  const events: TaskEvent[] = []
  for (const event of page.events) {
    const value = event.content
      ? await readContentJSON<TaskEvent>(event.content, reader)
      : event
    if (value.id !== event.id || value.task_run_id !== page.task_run_id)
      throw new Error("Task event does not match the selected task")
    events.push(value)
  }
  return { ...page, events }
}
