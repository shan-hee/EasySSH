import { useQuery } from "@tanstack/react-query"
import { getAIConfig, type AIConfigStatus } from "@/lib/api/ai-config"
import { useAuthReady } from "@/hooks/use-auth-ready"

export interface AIConfigAdapter {
  queryKey?: unknown[]
  getAIConfig: () => Promise<AIConfigStatus>
}

/**
 * AI 配置状态 Hook - 检查 AI 服务是否已配置可用
 */
export function useAIConfig(adapter?: AIConfigAdapter) {
  const { ready } = useAuthReady()
  const queryFn = adapter?.getAIConfig ?? getAIConfig
  const enabled = adapter ? true : ready

  const query = useQuery({
    queryKey: adapter?.queryKey ?? ["aiConfig"],
    queryFn,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    // Web 端等待认证；桌面等自定义 runtime adapter 可直接查询本地配置。
    enabled,
  })

  return {
    ...query,
    isConfigured: query.data?.configured ?? false,
    provider: query.data?.provider,
    model: query.data?.model,
    models: query.data?.models ?? [],
    hasKey: query.data?.has_key ?? false,
  }
}

export type { AIConfigStatus }
