import type { AIAssistantWorkspaceAdapters } from "@easyssh/app/components/ai-agent/ai-assistant-workspace-view"
import { Events } from "@wailsio/runtime"
import { requestDesktopSync } from "./desktop-sync"
import type {
  AgentFileArtifact,
  AgentSessionScope,
  AgentSessionStatus,
  AgentTaskStatus,
  AgentTransportType,
  AIHistoryChange,
  AIHistoryPage,
  AITaskOutputDelta,
  AITextDelta,
  CreateSessionResponse,
  ListSessionsResponse,
  PermissionMode,
  SessionListItem,
  SessionOverview,
  SessionOverviewResponse,
  TaskView,
} from "@easyssh/app/lib/ai-agent-types"
import {
  loadAISessionHistory,
  readContentJSON,
  withEmptyHistory,
  type AIHistoryReader,
  type ContentChunk,
  type ServerConnectionConfigsApi,
} from "@easyssh/app/desktop"
import * as DesktopAIService from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopaiservice"
import * as DesktopContentService from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopcontentservice"
import { ServerReference } from "../../bindings/github.com/easyssh/shared/aichatui/models"
import {
  DesktopAIToolApprovalInput,
  DesktopAICreateSessionInput,
  type DesktopAICreateSessionResponse,
  type DesktopAIListSessionsResult,
  DesktopAIPermissionMode,
  DesktopAIRegenerateMessageInput,
  DesktopAISendMessageInput,
  DesktopAIUpdateMessageInput,
  type DesktopAISessionListItem,
  type DesktopAISessionScope,
  type DesktopAISessionView,
} from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/models"

const desktopAiConfigQueryKey = ["desktopAiConfig"]
const desktopAISessionEvent = "easyssh:desktop-ai:session-event"

/** 桌面实时事件中的工具任务，状态以字符串传递。 */
type DesktopAITaskPayload = Omit<TaskView, "status"> & { status: string }

type DesktopAISessionEvent = {
  session_id?: string
  type?: string
  session?: DesktopAISessionView
  delta?: AITextDelta
  output?: AITaskOutputDelta
  task?: DesktopAITaskPayload
  history?: AIHistoryChange
  error?: string
}

// 绑定以 Go 结构生成类，字段与实例契约一致。
const desktopHistoryReader: AIHistoryReader = {
  page: async (sessionId, kind, afterId) => (
    await DesktopAIService.History(sessionId, { kind, after_id: afterId, limit: 100 })
  ) as unknown as AIHistoryPage,
  readChunk: async (reference, offset) => (
    await DesktopContentService.ReadContent(reference.id, { sha256: reference.sha256, offset, limit: 0 })
  ) as unknown as ContentChunk,
}

/** 桌面会话概况加上本地已提交历史。 */
function loadDesktopSession(response: DesktopAICreateSessionResponse): Promise<CreateSessionResponse> {
  return loadAISessionHistory(fromDesktopSessionResponse(response), desktopHistoryReader)
}

export function createDesktopAIAssistantAdapters(serverApi: ServerConnectionConfigsApi): AIAssistantWorkspaceAdapters {
  return {
    aiConfig: {
      queryKey: desktopAiConfigQueryKey,
      getAIConfig: async () => DesktopAIService.GetAIConfig(),
    },
    aiSettings: {
      queryKey: desktopAiConfigQueryKey,
      getConfig: () => DesktopAIService.GetOwnerAIConfig(),
      saveConfig: async (config) => {
        const saved = await DesktopAIService.SaveOwnerAIConfig(config)
        requestDesktopSync()
        return saved
      },
      probeModels: (input) => DesktopAIService.ProbeAIModels(input),
    },
    aiSession: {
      getTaskFile: async (sessionId, taskId) => {
        const reference = await DesktopAIService.GetTaskFile(sessionId, taskId)
        return readContentJSON<AgentFileArtifact>(reference, desktopHistoryReader.readChunk)
      },
      saveTaskFile: (sessionId, taskId) => DesktopAIService.SaveTaskFile(sessionId, taskId),
      getSession: async (sessionId: string) => loadDesktopSession(await DesktopAIService.GetSession(sessionId)),
      getLatestSession: async (scope?: AgentSessionScope) => {
        const response = await DesktopAIService.GetLatestSession(toDesktopSessionScope(scope))
        return response ? loadDesktopSession(response) : null
      },
      createSession: async (input) => withEmptyHistory(fromDesktopSessionResponse(
        await DesktopAIService.CreateSession(new DesktopAICreateSessionInput({
          model: input.model,
          permission_mode: toDesktopPermissionMode(input.permission_mode),
          scope: toDesktopSessionScope(input.scope),
        }))
      )),
      sendMessage: async (input) => loadDesktopSession(
        await DesktopAIService.SendMessage(new DesktopAISendMessageInput({
          reasoning_effort: input.reasoning_effort,
          session_id: input.session_id,
          message_id: input.message_id,
          content: input.content,
          server_references: input.server_references?.map((ref) => new ServerReference(ref)),
          context: input.context,
          model: input.model,
          permission_mode: toDesktopPermissionMode(input.permission_mode),
          scope: toDesktopSessionScope(input.scope),
          attachments: input.attachments,
        }))
      ),
      updateMessage: async (input) => loadDesktopSession(
        await DesktopAIService.UpdateMessage(new DesktopAIUpdateMessageInput({
          session_id: input.session_id,
          message_id: input.message_id,
          content: input.content,
          server_references: input.server_references?.map((ref) => new ServerReference(ref)),
        }))
      ),
      regenerateMessage: async (input) => loadDesktopSession(
        await DesktopAIService.RegenerateMessage(new DesktopAIRegenerateMessageInput({
          reasoning_effort: input.reasoning_effort,
          session_id: input.session_id,
          message_id: input.message_id,
          context: input.context,
          model: input.model,
          permission_mode: toDesktopPermissionMode(input.permission_mode),
          scope: toDesktopSessionScope(input.scope),
        }))
      ),
      deleteMessage: async (input) => loadDesktopSession(
        await DesktopAIService.DeleteMessage(input.session_id, input.message_id)
      ),
      subscribeSessionEvents: (callback) => Events.On(desktopAISessionEvent, (event) => {
        const data = getDesktopAIEventData(event) as DesktopAISessionEvent | undefined
        if (!data) {
          return
        }

        callback({
          session_id: data.session_id,
          type: data.type,
          session: data.session ? fromDesktopSession(data.session) : undefined,
          delta: data.delta,
          output: data.output,
          task: data.task ? fromDesktopTask(data.task) : undefined,
          history: data.history,
          error: data.error,
        })
      }),
      respondToToolApproval: async (input) => loadDesktopSession(
        await DesktopAIService.RespondToToolApproval(new DesktopAIToolApprovalInput({
          reasoning_effort: input.reasoning_effort,
          session_id: input.session_id,
          id: input.id,
          approved: input.approved,
          reason: input.reason,
        }))
      ),
      cancelSession: async (sessionId: string) => {
        await DesktopAIService.CancelSession(sessionId)
      },
      deleteSession: async (sessionId: string) => {
        await DesktopAIService.DeleteSession(sessionId)
        requestDesktopSync()
      },
    },
    servers: {
      list: (params?: Parameters<ServerConnectionConfigsApi["list"]>[0]) => serverApi.list(params),
    },
    listAISessions: async (input: {
      page?: number
      limit?: number
      q?: string
      scope?: AgentSessionScope
    } = {}) => fromDesktopSessionListResult(await DesktopAIService.ListSessions({
      page: input.page,
      limit: input.limit,
      q: input.q,
      scope_kind: input.scope?.kind,
      terminal_session_id: input.scope?.terminal_session_id,
      server_id: input.scope?.server_id,
    })),
    renameAISession: async (sessionId: string, title: string) => {
      await DesktopAIService.RenameSession(sessionId, title)
      requestDesktopSync()
    },
    deleteAISession: async (sessionId: string) => {
      await DesktopAIService.DeleteSession(sessionId)
      requestDesktopSync()
    },
  }
}

export type DesktopAIAssistantAdapters = ReturnType<typeof createDesktopAIAssistantAdapters>

function getDesktopAIEventData(event: unknown) {
  return event && typeof event === "object" && "data" in event
    ? (event as { data?: unknown }).data
    : undefined
}

function toDesktopPermissionMode(permissionMode?: PermissionMode): DesktopAIPermissionMode | undefined {
  switch (permissionMode) {
    case "readonly":
      return DesktopAIPermissionMode.DesktopAIPermissionReadonly
    case "privileged":
      return DesktopAIPermissionMode.DesktopAIPermissionPrivileged
    case "balanced":
      return DesktopAIPermissionMode.DesktopAIPermissionBalanced
    default:
      return undefined
  }
}

function fromDesktopPermissionMode(permissionMode: DesktopAIPermissionMode | string): PermissionMode {
  switch (permissionMode) {
    case DesktopAIPermissionMode.DesktopAIPermissionReadonly:
    case "readonly":
      return "readonly"
    case DesktopAIPermissionMode.DesktopAIPermissionPrivileged:
    case "privileged":
      return "privileged"
    default:
      return "balanced"
  }
}

function toDesktopSessionScope(scope?: AgentSessionScope): DesktopAISessionScope | null {
  if (!scope) {
    return null
  }

  return {
    kind: scope.kind,
    terminal_session_id: scope.terminal_session_id,
    server_id: scope.server_id,
    server_name: scope.server_name,
    host: scope.host,
    port: scope.port,
    username: scope.username,
  }
}

function fromDesktopSessionScope(scope?: DesktopAISessionScope | null): AgentSessionScope | undefined {
  if (!scope) {
    return undefined
  }

  return {
    kind: scope.kind === "terminal" || scope.kind === "global" ? scope.kind : undefined,
    terminal_session_id: scope.terminal_session_id,
    server_id: scope.server_id,
    server_name: scope.server_name,
    host: scope.host,
    port: scope.port,
    username: scope.username,
  }
}

function fromDesktopSessionResponse(response: DesktopAICreateSessionResponse): SessionOverviewResponse {
  return {
    session_id: response.session_id,
    session: fromDesktopSession(response.session),
    default_transport: fromDesktopTransport(response.default_transport),
  }
}

function fromDesktopSession(session: DesktopAISessionView): SessionOverview {
  return {
    title: session.title,
    id: session.id,
    model: session.model,
    permission_mode: fromDesktopPermissionMode(session.permission_mode),
    scope: fromDesktopSessionScope(session.scope),
    status: fromDesktopSessionStatus(session.status),
    created_at: session.created_at,
    updated_at: session.updated_at,
    message_count: session.message_count,
    task_count: session.task_count,
    default_transport: fromDesktopTransport(session.default_transport),
  }
}

function fromDesktopSessionListResult(result: DesktopAIListSessionsResult): ListSessionsResponse {
  return {
    items: result.items.map(fromDesktopSessionListItem),
    total: result.total,
  }
}

function fromDesktopSessionListItem(item: DesktopAISessionListItem): SessionListItem {
  return {
    preview: item.preview,
    id: item.id,
    model: item.model,
    permission_mode: fromDesktopPermissionMode(item.permission_mode),
    status: fromDesktopSessionStatus(item.status),
    scope: fromDesktopSessionScope(item.scope),
    title: item.title,
    custom_title: item.custom_title,
    message_count: item.message_count,
    task_count: item.task_count,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }
}

function fromDesktopTask(task: DesktopAITaskPayload): TaskView {
  return {
    id: task.id,
    file: task.file,
    command_output: task.command_output,
    assistant_message_id: task.assistant_message_id,
    tool_call_id: task.tool_call_id,
    tool_name: task.tool_name,
    tool_display_name: task.tool_display_name,
    summary: task.summary,
    status: fromDesktopTaskStatus(task.status),
    dangerous: task.dangerous,
    requires_confirmation: task.requires_confirmation,
    arguments: task.arguments,
    result: task.result,
    error: task.error,
    created_at: task.created_at,
    updated_at: task.updated_at,
  }
}

function fromDesktopSessionStatus(status: string): AgentSessionStatus {
  switch (status) {
    case "running":
      return "running"
    case "waiting_confirmation":
      return "waiting_confirmation"
    case "closed":
      return "closed"
    default:
      return "idle"
  }
}

function fromDesktopTaskStatus(status: string): AgentTaskStatus {
  switch (status) {
    case "waiting_confirm":
    case "running":
    case "succeeded":
    case "failed":
    case "unknown":
    case "cancelled":
      return status
    default:
      return "queued"
  }
}

function fromDesktopTransport(transport: string): AgentTransportType {
  if (transport !== "ai_sdk_ui") throw new Error(`Unsupported AI message transport: ${transport}`)
  return transport
}
