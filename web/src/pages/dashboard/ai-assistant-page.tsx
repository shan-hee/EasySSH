import {
  AIAssistantWorkspaceView,
  type AIAssistantWorkspaceAdapters,
  type AIAssistantWorkspaceViewProps,
} from "@/components/ai-agent/ai-assistant-workspace-view"
import { ViewportWorkspaceTransition } from "@/components/viewport-workspace-transition"

export type { AIAssistantWorkspaceAdapters as AIAssistantPageAdapters }

export default function AIAssistantPage(props: AIAssistantWorkspaceViewProps) {
  return (
    <ViewportWorkspaceTransition>
      <AIAssistantWorkspaceView {...props} />
    </ViewportWorkspaceTransition>
  )
}
