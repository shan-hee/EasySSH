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

// Present the actual targets covered by the revision, including remote desktop ports.
export async function reviewGrantTarget(resource: AccessResource) {
  const server = await apiFetch<{ host: string; port: number; username: string; connection_revision: number }>(`/servers/${resource.id}`)
  if (!Number.isInteger(server.connection_revision)) throw new Error("Server revision is unavailable")
  const lines = [`SSH: ${server.username}@${server.host}:${server.port}`]
  for (const protocol of ["vnc", "rdp"] as const) {
    if (!resource.actions.includes(`${protocol}.connect`)) continue
    const config = await apiFetch<{ port: number; enabled: boolean; tls?: boolean; security?: string; ignore_certificate?: boolean }>(`/${protocol}/${resource.id}/config`)
    lines.push(`${protocol.toUpperCase()}: ${server.host}:${config.port} · ${config.enabled ? "enabled" : "disabled"} · ${protocol === "rdp" ? `${config.security?.toUpperCase()} · certificate verification: ${!config.ignore_certificate}` : `TLS: ${!!config.tls}`}`)
  }
  return { revision: server.connection_revision, summary: lines.join("\n") }
}
