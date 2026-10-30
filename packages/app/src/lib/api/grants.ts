import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"

export type Grant = components["schemas"]["Grant"]
export type GrantDetail = components["schemas"]["GrantDetail"]
export type GrantInput = components["schemas"]["CreateGrantInput"]
export type AccessContext = components["schemas"]["AccessContext"]
export type AccessResource = components["schemas"]["AccessResource"]
export type Action = components["schemas"]["Action"]
export const grantsApi = {
  list: (offset = 0) =>
    apiFetch<components["schemas"]["GrantList"]>(
      `/grants?limit=30&offset=${offset}`,
    ),
  detail: (id: string) =>
    apiFetch<GrantDetail>(`/grants/${encodeURIComponent(id)}`),
  create: (body: GrantInput) =>
    apiFetch<components["schemas"]["GrantCreated"]>("/grants", {
      method: "POST",
      body,
    }),
  update: (id: string, version: number, body: GrantInput) =>
    apiFetch<void>(`/grants/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: { ...body, version },
    }),
  revoke: (id: string) =>
    apiFetch<void>(`/grants/${encodeURIComponent(id)}`, { method: "DELETE" }),
  rotate: (id: string) =>
    apiFetch<components["schemas"]["GrantCreated"]>(
      `/grants/${encodeURIComponent(id)}/rotate-secret`,
      { method: "POST" },
    ),
  confirm: (id: string, serverId: string, revision: number) =>
    apiFetch<void>(
      `/grants/${encodeURIComponent(id)}/resources/${encodeURIComponent(serverId)}/confirm`,
      { method: "POST", body: { connection_revision: revision } },
    ),
  endSession: (id: string) =>
    apiFetch<void>(`/grants/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
}
