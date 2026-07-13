import type { AIAssistantWorkspaceAdapters } from "@/components/ai-agent/ai-assistant-workspace-view"
import { Events } from "@wailsio/runtime"
import type {
  AgentSessionScope,
  AgentSessionStatus,
  AgentTaskStatus,
  AgentTransportType,
  CreateSessionResponse,
  ListSessionsResponse,
  MessageView,
  PermissionMode,
  SaveUserAIConfigRequest,
  SessionListItem,
  SessionView,
  TaskView,
  ToolView,
} from "@/lib/ai-agent-types"
import type { ServerConnectionConfigsApi } from "@easyssh/ssh-workspace/desktop"
import * as DesktopAIService from "../../bindings/github.com/easyssh/easyssh-desktop/desktopaiservice"
import {
  DesktopAIConfirmTaskInput,
  DesktopAICreateSessionInput,
  DesktopAIModelsProbeRequest,
  type DesktopAICreateSessionResponse,
  type DesktopAIListSessionsResult,
  DesktopAIPermissionMode,
  DesktopAIRegenerateMessageInput,
  DesktopAISendMessageInput,
  DesktopAIUpdateMessageInput,
  type DesktopAISessionListItem,
  type DesktopAISessionScope,
  type DesktopAISessionView,
  type DesktopAITaskView,
  type DesktopAIToolView,
  type DesktopAIMessageView,
} from "../../bindings/github.com/easyssh/easyssh-desktop/models"

const desktopAiConfigQueryKey = ["desktopAiConfig"]
const desktopAISessionEvent = "easyssh:desktop-ai:session-event"

type DesktopAITaskViewWithAssistantMessage = DesktopAITaskView & {
  assistant_message_id?: string
}

type DesktopAIUIMessage = SessionView["ui_messages"][number]

type DesktopAISessionEvent = {
  session_id?: string
  type?: string
  session?: DesktopAISessionView
  ui_message?: DesktopAIUIMessage
  error?: string
}

export function createDesktopAIAssistantAdapters(serverApi: ServerConnectionConfigsApi): AIAssistantWorkspaceAdapters {
  return {
    aiConfig: {
      queryKey: desktopAiConfigQueryKey,
      getAIConfig: async () => DesktopAIService.GetAIConfig(),
    },
    aiSettings: {
      queryKey: desktopAiConfigQueryKey,
      getUserAIConfig: async () => DesktopAIService.GetUserAIConfig(),
      saveUserAIConfig: async (config: SaveUserAIConfigRequest) => {
        await DesktopAIService.SaveUserAIConfig(config)
      },
      probeModels: async (config) => DesktopAIService.ProbeAIModels(
        new DesktopAIModelsProbeRequest(config),
      ),
    },
    aiSession: {
      getSession: async (sessionId: string) => fromDesktopSessionResponse(await DesktopAIService.GetSession(sessionId)),
      getLatestSession: async (scope?: AgentSessionScope) => {
        const response = await DesktopAIService.GetLatestSession(toDesktopSessionScope(scope))
        return response ? fromDesktopSessionResponse(response) : null
      },
      createSession: async (input) => fromDesktopSessionResponse(
        await DesktopAIService.CreateSession(new DesktopAICreateSessionInput({
          model: input.model,
          permission_mode: toDesktopPermissionMode(input.permission_mode),
          scope: toDesktopSessionScope(input.scope),
        }))
      ),
      sendMessage: async (input) => fromDesktopSessionResponse(
        await DesktopAIService.SendMessage(new DesktopAISendMessageInput({
          session_id: input.session_id,
          content: input.content,
          context: input.context,
          model: input.model,
          permission_mode: toDesktopPermissionMode(input.permission_mode),
          scope: toDesktopSessionScope(input.scope),
        }))
      ),
      updateMessage: async (input) => fromDesktopSessionResponse(
        await DesktopAIService.UpdateMessage(new DesktopAIUpdateMessageInput({
          session_id: input.session_id,
          message_id: input.message_id,
          content: input.content,
        }))
      ),
      regenerateMessage: async (input) => fromDesktopSessionResponse(
        await DesktopAIService.RegenerateMessage(new DesktopAIRegenerateMessageInput({
          session_id: input.session_id,
          message_id: input.message_id,
          context: input.context,
          model: input.model,
          permission_mode: toDesktopPermissionMode(input.permission_mode),
          scope: toDesktopSessionScope(input.scope),
        }))
      ),
      deleteMessage: async (input) => fromDesktopSessionResponse(
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
          ui_message: data.ui_message,
          error: data.error,
        })
      }),
      confirmTask: async (input) => fromDesktopSessionResponse(
        await DesktopAIService.ConfirmTask(new DesktopAIConfirmTaskInput({
          session_id: input.session_id,
          task_id: input.task_id,
          decision: input.decision,
        }))
      ),
      cancelSession: async (sessionId: string) => {
        await DesktopAIService.CancelSession(sessionId)
      },
      closeSession: async (sessionId: string) => {
        await DesktopAIService.CloseSession(sessionId)
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
    },
    deleteAISession: async (sessionId: string) => {
      await DesktopAIService.DeleteSession(sessionId)
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

function fromDesktopSessionResponse(response: DesktopAICreateSessionResponse): CreateSessionResponse {
  return {
    session_id: response.session_id,
    session: fromDesktopSession(response.session),
    default_transport: fromDesktopTransport(response.default_transport),
  }
}

function fromDesktopSession(session: DesktopAISessionView): SessionView {
  return {
    id: session.id,
    model: session.model,
    permission_mode: fromDesktopPermissionMode(session.permission_mode),
    scope: fromDesktopSessionScope(session.scope),
    status: fromDesktopSessionStatus(session.status),
    created_at: session.created_at,
    updated_at: session.updated_at,
    messages: session.messages.map(fromDesktopMessage),
    tasks: session.tasks.map(fromDesktopTask),
    ui_messages: session.ui_messages as SessionView["ui_messages"],
    available_tools: session.available_tools.map(fromDesktopTool),
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
    id: item.id,
    model: item.model,
    permission_mode: fromDesktopPermissionMode(item.permission_mode),
    status: fromDesktopSessionStatus(item.status),
    title: item.title,
    custom_title: item.custom_title,
    message_count: item.message_count,
    task_count: item.task_count,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }
}

function fromDesktopMessage(message: DesktopAIMessageView): MessageView {
  return {
    id: message.id,
    role: fromDesktopMessageRole(message.role),
    content: message.content,
    created_at: message.created_at,
  }
}

function fromDesktopTask(task: DesktopAITaskView): TaskView {
  const desktopTask = task as DesktopAITaskViewWithAssistantMessage

  return {
    id: task.id,
    assistant_message_id: desktopTask.assistant_message_id,
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
    custom_title: task.custom_title,
  }
}

function fromDesktopTool(tool: DesktopAIToolView): ToolView {
  return {
    name: tool.name,
    display_name: tool.display_name,
    description: tool.description,
    dangerous: tool.dangerous,
  }
}

function fromDesktopMessageRole(role: string): MessageView["role"] {
  switch (role) {
    case "user":
    case "assistant":
    case "system":
    case "tool":
      return role
    default:
      return "assistant"
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
    case "cancelled":
      return status
    default:
      return "queued"
  }
}

function fromDesktopTransport(transport: string): AgentTransportType {
  return transport === "ai_sdk_ui" ? "ai_sdk_ui" : "desktop_local"
}
