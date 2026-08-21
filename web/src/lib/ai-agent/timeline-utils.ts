import type { TaskView } from "@/lib/api/ai-agent"
import { isToolUIPart, type UIMessage } from "ai"

type TimelineTranslateValues = Record<string, string | number | Date>

export type TimelineTranslate = (key: string, values?: TimelineTranslateValues) => string
export type AssistantLoadingState = false | "waiting" | "thinking" | "generating"

export function getAgentToolActivity(messages: UIMessage[]) {
  let hasToolParts = false
  let hasActiveTools = false
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue
      hasToolParts = true
      if (part.state !== "output-available" && part.state !== "output-error" && part.state !== "output-denied") {
        hasActiveTools = true
      }
    }
  }
  return { hasActiveTools, hasToolParts }
}

export function getTaskStatusLabel(status: TaskView["status"], tText: TimelineTranslate) {
  switch (status) {
    case "queued":
      return tText("taskStatusQueued")
    case "waiting_confirm":
      return tText("taskStatusWaitingConfirm")
    case "running":
      return tText("taskStatusRunning")
    case "succeeded":
      return tText("taskStatusSucceeded")
    case "failed":
      return tText("taskStatusFailed")
    case "cancelled":
      return tText("taskStatusCancelled")
    default:
      return status
  }
}
