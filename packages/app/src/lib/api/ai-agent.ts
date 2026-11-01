import { apiFetch } from "@/lib/api-client"
import { readInstanceContentChunk } from "@/lib/api/content"
import { loadAISessionHistory, withEmptyHistory, type AIHistoryReader } from "@/lib/ai-agent/history"
import { readContentJSON, type ContentReference } from "@/lib/content"
import type {
  AgentFileArtifact,
  AgentSessionScope,
  AIHistoryPage,
  CreateSessionInput,
  CreateSessionResponse,
  ListSessionsResponse,
  SessionOverviewResponse,
  UpdateMessageInput,
} from "@/lib/ai-agent-types"

export type {
  AgentSessionScope,
  AgentServerReference,
  AgentSessionStatus,
  AgentImageAttachment,
  AgentProviderMetadata,
  AgentUsage,
  AgentTaskStatus,
  AgentTransportType,
  CreateSessionInput,
  CreateSessionResponse,
  ListSessionsResponse,
  MessageView,
  PermissionMode,
  SessionListItem,
  SessionOverview,
  SessionView,
  TaskView,
} from "@/lib/ai-agent-types"

export async function listAISessions(input: {
  page?: number
  limit?: number
  q?: string
  scope?: AgentSessionScope
} = {}): Promise<ListSessionsResponse> {
  const params = new URLSearchParams()
  if (input.page) {
    params.set("page", String(input.page))
  }
  if (input.limit) {
    params.set("limit", String(input.limit))
  }
  if (input.q?.trim()) {
    params.set("q", input.q.trim())
  }
  if (input.scope?.kind) {
    params.set("scope_kind", input.scope.kind)
  }
  if (input.scope?.terminal_session_id?.trim()) {
    params.set("terminal_session_id", input.scope.terminal_session_id.trim())
  }
  if (input.scope?.server_id?.trim()) {
    params.set("server_id", input.scope.server_id.trim())
  }
  const query = params.toString()
  return apiFetch<ListSessionsResponse>(`/ai/sessions${query ? `?${query}` : ""}`)
}

export async function getLatestAISession(scope?: AgentSessionScope): Promise<CreateSessionResponse | null> {
  const sessions = await listAISessions({ limit: 1, scope })
  const latest = sessions.items[0]
  if (!latest) {
    return null
  }
  return getAISession(latest.id)
}

const historyReader: AIHistoryReader = {
  page: (sessionId, kind, afterId) => {
    const params = new URLSearchParams({ kind, limit: "100" })
    if (afterId) params.set("after_id", afterId)
    return apiFetch<AIHistoryPage>(`/ai/sessions/${encodeURIComponent(sessionId)}/history?${params.toString()}`, { retry: false })
  },
  readChunk: readInstanceContentChunk,
}

/** 会话概况加上全部已提交历史。 */
export async function getAISession(sessionId: string): Promise<CreateSessionResponse> {
  const overview = await apiFetch<SessionOverviewResponse>(`/ai/sessions/${encodeURIComponent(sessionId)}`)
  return loadAISessionHistory(overview, historyReader)
}

export async function createAISession(input: CreateSessionInput): Promise<CreateSessionResponse> {
  return withEmptyHistory(await apiFetch<SessionOverviewResponse>("/ai/sessions", {
    method: "POST",
    body: input,
  }))
}

export async function cancelAISession(sessionId: string): Promise<void> {
  await apiFetch<{ cancelled: boolean }>(`/ai/sessions/${sessionId}/cancel`, {
    method: "POST",
  })
}

export async function renameAISession(sessionId: string, title: string): Promise<void> {
  await apiFetch<{ updated: boolean }>(`/ai/sessions/${sessionId}`, {
    method: "PATCH",
    body: { title },
  })
}

export async function deleteAISession(sessionId: string): Promise<void> {
  await apiFetch<string>(`/ai/sessions/${sessionId}`, {
    method: "DELETE",
  })
}

export async function updateAIMessage(sessionId: string, messageId: string, input: UpdateMessageInput): Promise<CreateSessionResponse> {
  const overview = await apiFetch<SessionOverviewResponse>(`/ai/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    body: input,
  })
  return loadAISessionHistory(overview, historyReader)
}

export async function deleteAIMessage(sessionId: string, messageId: string): Promise<CreateSessionResponse> {
  const overview = await apiFetch<SessionOverviewResponse>(`/ai/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`, {
    method: "DELETE",
  })
  return loadAISessionHistory(overview, historyReader)
}

/** 任务文件快照以内容引用返回，正文通过内容接口读取。 */
export async function getAITaskFile(sessionId: string, taskId: string): Promise<AgentFileArtifact> {
  const reference = await apiFetch<ContentReference>(`/ai/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskId)}/file`)
  return readContentJSON<AgentFileArtifact>(reference, readInstanceContentChunk)
}
