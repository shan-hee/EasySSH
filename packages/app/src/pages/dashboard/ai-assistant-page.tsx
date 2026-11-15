import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { webAIAssistantAdapters, webAISettingsAdapter } from "./web-ai-adapters"
import type { AIAssistantWorkspaceAdapters } from "@/components/ai-agent/ai-assistant-workspace-view"
import { ViewportWorkspaceTransition } from "@/components/viewport-workspace-transition"
import { AIWorkspace, type AIWorkspaceProps } from "@/workbench/ai-workspace"

export type { AIAssistantWorkspaceAdapters as AIAssistantPageAdapters }

/** Web AI 页：会话列表由侧边导航承载，当前会话记录在 `?session=`。 */
export default function AIAssistantPage(props: Omit<AIWorkspaceProps, "adapters">) {
  const [params, setParams] = useSearchParams()
  const setSessionParam = useCallback((sessionId: string | undefined) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (sessionId) next.set("session", sessionId)
      else next.delete("session")
      return next
    }, { replace: true })
  }, [setParams])

  return (
    <ViewportWorkspaceTransition>
      <AIWorkspace
        adapters={{ ...webAIAssistantAdapters, aiSettings: webAISettingsAdapter }}
        sessionSidebar="host"
        {...props}
        routeSession={{ id: params.get("session") ?? undefined, onChange: setSessionParam }}
      />
    </ViewportWorkspaceTransition>
  )
}
