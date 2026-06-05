import { apiFetch } from "@/lib/api-client"
import type { AgentSessionScope, CreateSessionInput, CreateSessionResponse, ListSessionsResponse } from "@/lib/ai-agent-types"

export type {
  AgentSessionScope,
  AgentSessionStatus,
  AgentTaskStatus,
  AgentTransportType,
  CreateSessionInput,
  CreateSessionResponse,
  ListSessionsResponse,
  MessageView,
  PermissionMode,
  SessionListItem,
  SessionView,
  TaskView,
  ToolView,
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

export async function getAISession(sessionId: string): Promise<CreateSessionResponse> {
  return apiFetch<CreateSessionResponse>(`/ai/sessions/${sessionId}`)
}

export async function createAISession(input: CreateSessionInput): Promise<CreateSessionResponse> {
  return apiFetch<CreateSessionResponse>("/ai/sessions", {
    method: "POST",
    body: input,
  })
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

export async function closeAISession(sessionId: string): Promise<void> {
  await deleteAISession(sessionId)
}
