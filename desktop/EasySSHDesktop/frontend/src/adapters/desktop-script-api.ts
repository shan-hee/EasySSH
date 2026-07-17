import type {
  BatchTask,
  CreateBatchTaskRequest,
  CreateScriptRequest,
  ListScriptsParams,
  ListScriptsResponse,
  Script,
  ScriptsPageAdapters,
  Server,
  ServerListResponse,
  UpdateScriptRequest,
} from "@easyssh/ssh-workspace/desktop"
import type { ServerConnectionConfigsApi } from "@easyssh/ssh-workspace/desktop"
import type {
  DesktopBatchTask,
  DesktopBatchTaskInput,
  DesktopScript,
  DesktopScriptInput,
} from "../../bindings/github.com/easyssh/easyssh-desktop"
import * as DesktopScriptService from "../../bindings/github.com/easyssh/easyssh-desktop/desktopscriptservice"
import { DESKTOP_LOCAL_DATA_USER_ID } from "./desktop-local-identity"

function mapDesktopScript(script: DesktopScript): Script {
  return {
    id: script.id,
    user_id: script.user_id || DESKTOP_LOCAL_DATA_USER_ID,
    name: script.name,
    description: script.description || "",
    content: script.content,
    language: script.language || "bash",
    tags: script.tags || [],
    executions: script.executions || 0,
    author: script.author || "desktop",
    created_at: script.created_at,
    updated_at: script.updated_at,
  }
}

function mapDesktopBatchTask(task: DesktopBatchTask): BatchTask {
  if (task.task_type !== "command" && task.task_type !== "script") {
    throw new Error(`Unsupported desktop batch task type: ${task.task_type}`)
  }
  if (
    task.status !== "pending" &&
    task.status !== "queued" &&
    task.status !== "running" &&
    task.status !== "completed" &&
    task.status !== "failed"
  ) {
    throw new Error(`Unsupported desktop batch task status: ${task.status}`)
  }
  return {
    id: task.id,
    user_id: task.user_id || DESKTOP_LOCAL_DATA_USER_ID,
    task_name: task.task_name,
    task_type: task.task_type,
    content: task.content || "",
    script_id: task.script_id || undefined,
    server_ids: task.server_ids || [],
    execution_mode: task.execution_mode === "sequential" ? "sequential" : "parallel",
    status: task.status,
    success_count: task.success_count || 0,
    failed_count: task.failed_count || 0,
    started_at: task.started_at || undefined,
    completed_at: task.completed_at || undefined,
    duration: task.duration || undefined,
    created_at: task.created_at,
    updated_at: task.updated_at,
  }
}

function toDesktopScriptInput(input: CreateScriptRequest | UpdateScriptRequest): DesktopScriptInput {
  return {
    name: input.name || "",
    description: input.description || "",
    content: input.content || "",
    language: input.language || "bash",
    tags: input.tags || [],
  }
}

function toDesktopBatchTaskInput(input: CreateBatchTaskRequest): DesktopBatchTaskInput {
  return {
    task_name: input.task_name,
    task_type: input.task_type,
    content: input.content || "",
    script_id: input.script_id || "",
    server_ids: input.server_ids,
    execution_mode: input.execution_mode || "parallel",
  }
}

async function updateDesktopScript(id: string, input: UpdateScriptRequest): Promise<Script> {
  const current = await DesktopScriptService.GetById(id)
  const updated = await DesktopScriptService.Update(id, toDesktopScriptInput({
    name: input.name ?? current.name,
    description: input.description ?? current.description,
    content: input.content ?? current.content,
    language: input.language ?? current.language,
    tags: input.tags ?? current.tags ?? [],
  }))

  return mapDesktopScript(updated)
}

export function createDesktopScriptAdapters(serverApi: ServerConnectionConfigsApi): ScriptsPageAdapters {
  return {
    scripts: {
      async list(params?: ListScriptsParams): Promise<ListScriptsResponse> {
        const result = await DesktopScriptService.List({
          page: params?.page,
          limit: params?.limit,
          search: params?.search,
          tags: params?.tags,
          language: params?.language,
        })

        return {
          data: (result.data || []).map(mapDesktopScript),
          total: result.total,
          page: result.page,
          limit: result.limit,
          total_pages: result.total_pages,
        }
      },
      async create(input: CreateScriptRequest): Promise<Script> {
        return mapDesktopScript(await DesktopScriptService.Create(toDesktopScriptInput(input)))
      },
      update: updateDesktopScript,
      async delete(id: string): Promise<void> {
        await DesktopScriptService.Delete(id)
      },
      async execute(id: string): Promise<void> {
        await DesktopScriptService.Execute(id)
      },
    },
    servers: {
      async list(params?: {
        page?: number
        limit?: number
        group?: string
        search?: string
      }): Promise<ServerListResponse> {
        const result = await serverApi.list(params)

        return {
          data: (result.data as Server[]).map((server) => ({
            ...server,
            status: "online" as const,
          })),
          total: result.total,
          page: result.page,
          limit: result.limit,
        }
      },
    },
    batchTasks: {
      async create(input: CreateBatchTaskRequest): Promise<BatchTask> {
        return mapDesktopBatchTask(await DesktopScriptService.CreateBatchTask(toDesktopBatchTaskInput(input)))
      },
      async start(id: string): Promise<{ message: string }> {
        const result = await DesktopScriptService.StartBatchTask(id)
        return { message: result.message || "batch task started" }
      },
    },
  }
}
