import { useEffect, useMemo, useRef, useState } from "react"

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
  const syncedSessionModelRef = useRef<{ sessionId: string; model: string } | null>(null)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("balanced")
  const modelOptions = useMemo(
    () => includeAutoModel && config.models.length === 0 ? ["auto"] : config.models,
    [config.models, includeAutoModel]
  )

  useEffect(() => {
    const sessionId = agentSession.session?.id
    const sessionModel = agentSession.session?.model
    if (syncedSessionModelRef.current?.sessionId !== sessionId) {
      syncedSessionModelRef.current = null
    }
    // 会话切换或会话模型变化时才同步，避免覆盖用户为下一条消息选择的模型。
    if (
      sessionId && sessionModel
      && syncedSessionModelRef.current?.model !== sessionModel
      && (config.models.includes(sessionModel) || (includeAutoModel && sessionModel === "auto"))
    ) {
      syncedSessionModelRef.current = { sessionId, model: sessionModel }
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
  }, [agentSession.session?.id, agentSession.session?.model, config.model, config.models, includeAutoModel, model, modelOptions])

  useEffect(() => {
    if (agentSession.session?.permission_mode) {
      setPermissionMode(agentSession.session.permission_mode)
    }
  }, [agentSession.session?.permission_mode])

  const isSessionRunning = agentSession.session?.status === "running"
  const isChatRequestActive = agentSession.chatStatus === "submitted" || agentSession.chatStatus === "streaming"
  const isAssistantActive = isSessionRunning || isChatRequestActive || agentSession.reconnecting
  const toolActivity = useMemo(
    () => getAgentToolActivity(agentSession.uiMessages),
    [agentSession.uiMessages]
  )
  const shouldShowLoadingIndicator = isAssistantActive && !agentSession.error && !toolActivity.hasActiveTools
  const assistantLoadingState = agentSession.reconnecting
    ? "reconnecting"
    : shouldShowLoadingIndicator
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
