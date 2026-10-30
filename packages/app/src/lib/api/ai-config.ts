import { apiFetch } from "@/lib/api-client"
import type {
  AIConfig,
  AIConfigInput,
  AIConfigStatus,
  AIModelsProbeInput,
  AIModelsProbeResult,
} from "@/lib/ai-agent-types"

export type {
  AIConfig,
  AIConfigInput,
  AIConfigStatus,
  AIModelsProbeInput,
  AIModelsProbeResult,
} from "@/lib/ai-agent-types"

export async function getAIConfig(): Promise<AIConfigStatus> {
  return apiFetch<AIConfigStatus>("/ai/config", { method: "GET" })
}

/** 所有者 AI 服务配置的读写。 */
export const aiConfigApi = {
  get(): Promise<AIConfig> {
    return apiFetch<AIConfig>("/owner/ai-config", { method: "GET" })
  },

  save(input: AIConfigInput): Promise<AIConfig> {
    return apiFetch<AIConfig>("/owner/ai-config", { method: "PUT", body: input })
  },

  probeModels(input: AIModelsProbeInput): Promise<AIModelsProbeResult> {
    return apiFetch<AIModelsProbeResult>("/owner/ai-config/models", { method: "POST", body: input })
  },

  reset(): Promise<void> {
    return apiFetch<void>("/owner/ai-config", { method: "DELETE" })
  },
}
