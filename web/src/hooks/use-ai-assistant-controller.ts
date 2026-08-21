import { useEffect, useMemo, useState } from "react"

import type { AIConfigAdapter } from "@/hooks/use-ai-config"
import { useAIConfig } from "@/hooks/use-ai-config"
import type { AgentSessionAdapter } from "@/hooks/use-agent-session"
import { useAgentSession } from "@/hooks/use-agent-session"
import type { PermissionMode } from "@/lib/api/ai-agent"
import { getAgentToolActivity } from "@/lib/ai-agent/timeline-utils"

export function useAIAssistantController({
  aiConfigAdapter,
  aiSessionAdapter,
  includeAutoModel = false,
}: {
  aiConfigAdapter?: AIConfigAdapter
  aiSessionAdapter?: AgentSessionAdapter
  includeAutoModel?: boolean
}) {
  const config = useAIConfig(aiConfigAdapter)
  const agentSession = useAgentSession(aiSessionAdapter)
  const [model, setModel] = useState(includeAutoModel ? "auto" : "")
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("balanced")
  const modelOptions = useMemo(
    () => includeAutoModel && config.models.length === 0 ? ["auto"] : config.models,
    [config.models, includeAutoModel]
  )

  useEffect(() => {
    const sessionModel = agentSession.session?.model
    if (sessionModel && (config.models.includes(sessionModel) || (includeAutoModel && sessionModel === "auto"))) {
      setModel(sessionModel)
      return
    }
    if (modelOptions.length === 0) {
      setModel("")
      return
    }
    if (!model || !modelOptions.includes(model)) {
      const configuredDefault = config.model && modelOptions.includes(config.model) ? config.model : undefined
      setModel(configuredDefault ?? modelOptions[0])
    }
  }, [agentSession.session?.model, config.model, config.models, includeAutoModel, model, modelOptions])

  useEffect(() => {
    if (agentSession.session?.permission_mode) {
      setPermissionMode(agentSession.session.permission_mode)
    }
  }, [agentSession.session?.permission_mode])

  const isSessionRunning = agentSession.session?.status === "running"
  const isChatRequestActive = agentSession.chatStatus === "submitted" || agentSession.chatStatus === "streaming"
  const isAssistantActive = isSessionRunning || isChatRequestActive
  const toolActivity = useMemo(
    () => getAgentToolActivity(agentSession.uiMessages),
    [agentSession.uiMessages]
  )
  const shouldShowLoadingIndicator = isAssistantActive && !toolActivity.hasActiveTools
  const assistantLoadingState = shouldShowLoadingIndicator
    ? agentSession.chatStatus === "streaming"
      ? "generating"
      : agentSession.chatStatus === "submitted"
        ? "waiting"
        : "thinking"
    : false

  return {
    config,
    agentSession,
    model,
    setModel,
    modelOptions,
    activeModel: model && model !== "auto" ? model : undefined,
    permissionMode,
    setPermissionMode,
    isChatRequestActive,
    isAssistantActive,
    assistantLoadingState,
  } as const
}
