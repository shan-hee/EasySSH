import type { UIMessage } from "@ai-sdk/react"

export function resolveOutgoingUserMessageId(
  latestMessage: UIMessage | undefined,
  requestedMessageId: string | undefined,
) {
  return latestMessage?.role === "user" ? latestMessage.id : requestedMessageId
}
