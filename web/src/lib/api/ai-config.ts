import { apiFetch } from "@/lib/api-client"
import type { AIConfigStatus } from "@/lib/ai-agent-types"

export type { AIConfigStatus } from "@/lib/ai-agent-types"

export async function getAIConfig(): Promise<AIConfigStatus> {
  return apiFetch<AIConfigStatus>("/ai/config", { method: "GET" })
}
