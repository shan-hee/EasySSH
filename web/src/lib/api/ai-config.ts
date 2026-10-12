import type { AIConfigStatus } from "@/lib/ai-agent-types"

export type { AIConfigStatus } from "@/lib/ai-agent-types"

export async function getAIConfig(): Promise<AIConfigStatus> {
  return { configured: false, models: [], has_key: false, message: "AI 执行已迁移到桌面端，服务端不再代理凭据或终端内容" }
}
