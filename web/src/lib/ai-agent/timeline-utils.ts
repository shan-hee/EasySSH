import { isToolUIPart, type UIMessage } from "ai"

type TimelineTranslateValues = Record<string, string | number | Date>

export type TimelineTranslate = (key: string, values?: TimelineTranslateValues) => string
export type AssistantLoadingState = false | "waiting" | "thinking" | "generating" | "reconnecting"

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
