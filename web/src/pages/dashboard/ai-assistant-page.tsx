import {
  AIAssistantWorkspaceView,
  type AIAssistantWorkspaceAdapters,
  type AIAssistantWorkspaceViewProps,
} from "@/components/ai-agent/ai-assistant-workspace-view"

export type { AIAssistantWorkspaceAdapters as AIAssistantPageAdapters }

export default function AIAssistantPage(props: AIAssistantWorkspaceViewProps) {
  return <AIAssistantWorkspaceView {...props} />
}
