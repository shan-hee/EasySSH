import type { AIAssistantWorkspaceAdapters } from "@/components/ai-agent/ai-assistant-workspace-view"
import { ViewportWorkspaceTransition } from "@/components/viewport-workspace-transition"
import { AIWorkspace, type AIWorkspaceProps } from "@/workbench/ai-workspace"

export type { AIAssistantWorkspaceAdapters as AIAssistantPageAdapters }

/** Web AI 页：会话列表由侧边导航承载。 */
export default function AIAssistantPage(props: AIWorkspaceProps) {
  return (
    <ViewportWorkspaceTransition>
      <AIWorkspace sessionSidebar="host" {...props} />
    </ViewportWorkspaceTransition>
  )
}
