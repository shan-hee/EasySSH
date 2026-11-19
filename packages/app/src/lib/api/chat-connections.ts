import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"

export type ChatConnection = components["schemas"]["ChatConnection"]
export type ChatConnectionInput = components["schemas"]["ChatConnectionInput"]
export type ChatConnectionDetail = components["schemas"]["ChatConnectionDetail"]
export type ChatBindRequest = components["schemas"]["ChatBindRequest"]
export type ChatSession = components["schemas"]["ChatSession"]
export type ChatTranscriptMessage = components["schemas"]["ChatTranscriptMessage"]

const path = (id: string) => `/chat-connections/${encodeURIComponent(id)}`

export const chatConnectionsApi = {
  list: () => apiFetch<ChatConnection[]>("/chat-connections"),
  detail: (id: string) => apiFetch<ChatConnectionDetail>(path(id)),
  save: (id: string | undefined, body: ChatConnectionInput) => apiFetch<ChatConnection>(id ? path(id) : "/chat-connections", { method: id ? "PUT" : "POST", body }),
  setEnabled: (id: string, enabled: boolean) => apiFetch<void>(`${path(id)}/enabled`, { method: "PATCH", body: { enabled } }),
  remove: (id: string) => apiFetch<void>(path(id), { method: "DELETE" }),
  approve: (id: string, requestId: string) => apiFetch<void>(`${path(id)}/requests/${encodeURIComponent(requestId)}/approve`, { method: "POST" }),
  ignore: (id: string, requestId: string) => apiFetch<void>(`${path(id)}/requests/${encodeURIComponent(requestId)}`, { method: "DELETE" }),
  revoke: (id: string, bindingId: string) => apiFetch<void>(`${path(id)}/bindings/${encodeURIComponent(bindingId)}`, { method: "DELETE" }),
  sessions: (id: string) => apiFetch<ChatSession[]>(`${path(id)}/sessions`),
  transcript: (id: string, sessionId: string) => apiFetch<ChatTranscriptMessage[]>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}`),
}
