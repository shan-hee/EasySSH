import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"

export type ChatConnection = components["schemas"]["ChatConnection"]
export type ChatConnectionInput = components["schemas"]["ChatConnectionInput"]
export type ChatConnectionDetail = components["schemas"]["ChatConnectionDetail"]
export type ChatBindCode = components["schemas"]["ChatBindCode"]

const path = (id: string) => `/chat-connections/${encodeURIComponent(id)}`

export const chatConnectionsApi = {
  list: () => apiFetch<ChatConnection[]>("/chat-connections"),
  detail: (id: string) => apiFetch<ChatConnectionDetail>(path(id)),
  save: (id: string | undefined, body: ChatConnectionInput) => apiFetch<ChatConnection>(id ? path(id) : "/chat-connections", { method: id ? "PUT" : "POST", body }),
  setEnabled: (id: string, enabled: boolean) => apiFetch<void>(`${path(id)}/enabled`, { method: "PATCH", body: { enabled } }),
  remove: (id: string) => apiFetch<void>(path(id), { method: "DELETE" }),
  bindCode: (id: string) => apiFetch<ChatBindCode>(`${path(id)}/bind-code`, { method: "POST" }),
  revoke: (id: string, bindingId: string) => apiFetch<void>(`${path(id)}/bindings/${encodeURIComponent(bindingId)}`, { method: "DELETE" }),
}
