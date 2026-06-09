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
import * as DesktopScriptService from "../../bindings/github.com/easyssh/easyssh-desktop/desktopscriptservice"

function mapDesktopScript(script: DesktopScriptService.DesktopScript): Script {
  return {
    id: script.id,
    user_id: script.user_id || "local",
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

function mapDesktopBatchTask(task: DesktopScriptService.DesktopBatchTask): BatchTask {
  return {
    id: task.id,
    user_id: task.user_id || "local",
    task_name: task.task_name,
    task_type: task.task_type === "command" || task.task_type === "file" ? task.task_type : "script",
    content: task.content || "",
    script_id: task.script_id || undefined,
    server_ids: task.server_ids || [],
    execution_mode: task.execution_mode === "sequential" ? "sequential" : "parallel",
    status: task.status === "running" || task.status === "completed" || task.status === "failed" ? task.status : "pending",
    success_count: task.success_count || 0,
    failed_count: task.failed_count || 0,
    started_at: task.started_at || undefined,
    completed_at: task.completed_at || undefined,
    duration: task.duration || undefined,
    created_at: task.created_at,
    updated_at: task.updated_at,
  }
}

function toDesktopScriptInput(input: CreateScriptRequest | UpdateScriptRequest): DesktopScriptService.DesktopScriptInput {
  return {
    name: input.name || "",
    description: input.description || "",
    content: input.content || "",
    language: input.language || "bash",
    tags: input.tags || [],
  }
}

function toDesktopBatchTaskInput(input: CreateBatchTaskRequest): DesktopScriptService.DesktopBatchTaskInput {
  return {
    task_name: input.task_name,
    task_type: input.task_type,
    content: input.content || "",
    script_id: input.script_id || "",
    server_ids: input.server_ids,
    execution_mode: input.execution_mode || "parallel",
  }
}

async function updateDesktopScript(id: string, input: UpdateScriptRequest): Promise<{ data: Script }> {
  const current = await DesktopScriptService.GetById(id)
  const updated = await DesktopScriptService.Update(id, toDesktopScriptInput({
    name: input.name ?? current.name,
    description: input.description ?? current.description,
    content: input.content ?? current.content,
    language: input.language ?? current.language,
    tags: input.tags ?? current.tags ?? [],
  }))

  return { data: mapDesktopScript(updated) }
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
      async create(input: CreateScriptRequest): Promise<{ data: Script }> {
        return { data: mapDesktopScript(await DesktopScriptService.Create(toDesktopScriptInput(input))) }
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
      async create(input: CreateBatchTaskRequest): Promise<{ data: BatchTask }> {
        return { data: mapDesktopBatchTask(await DesktopScriptService.CreateBatchTask(toDesktopBatchTaskInput(input))) }
      },
      async start(id: string): Promise<{ data: { message: string } }> {
        const result = await DesktopScriptService.StartBatchTask(id)
        return { data: { message: result.message || "batch task started" } }
      },
    },
  }
}
