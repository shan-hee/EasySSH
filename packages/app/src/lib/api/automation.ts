import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"

export type AccessToken = components["schemas"]["AutomationToken"]
export type CreateAccessToken = components["schemas"]["CreateAutomationToken"]

// The catalog only presents names and descriptions; clients read schemas over MCP.
export type MCPTool = { name: string; description: string }

export const automationApi = {
  listTokens: () => apiFetch<AccessToken[]>("/access-tokens"),
  createToken: (body: CreateAccessToken) =>
    apiFetch<components["schemas"]["AutomationTokenCreated"]>("/access-tokens", { method: "POST", body }),
  revokeToken: (id: string) =>
    apiFetch<void>(`/access-tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
  revealToken: (id: string) =>
    apiFetch<components["schemas"]["AutomationTokenSecret"]>(`/access-tokens/${encodeURIComponent(id)}/secret`),
  rotateToken: (id: string) =>
    apiFetch<components["schemas"]["AutomationTokenSecret"]>(`/access-tokens/${encodeURIComponent(id)}/rotate`, { method: "POST" }),
  listTools: () => apiFetch<MCPTool[]>("/automation/tools"),
}
