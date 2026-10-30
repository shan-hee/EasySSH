import { useMemo, useState } from "react"
import type { UIMessage } from "ai"
import type { FeedbackAdapter } from "@assistant-ui/react"
import { useTranslation } from "react-i18next"
import { toast } from "@/components/ui/sonner"

type Votes = Record<string, "positive" | "negative">

function readVotes(key: string): Votes {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? "{}")
    if (!data || typeof data !== "object" || Array.isArray(data)) return {}
    return Object.fromEntries(
      Object.entries(data).filter(([, value]) => value === "positive" || value === "negative")
    )
  } catch {
    return {}
  }
}

// Per-device message ratings. No message text or credentials are stored or sent to a provider.
export function useAgentFeedback(sessionId: string | null, messages: UIMessage[]) {
  const { t } = useTranslation("aiAssistant")
  const key = sessionId ? `easyssh-ai-feedback:${sessionId}` : null
  const stored = useMemo(() => (key ? readVotes(key) : {}), [key])
  const [current, setCurrent] = useState<{ key: string; votes: Votes } | null>(null)
  const votes = current?.key === key ? current.votes : stored
  const feedback = useMemo<FeedbackAdapter>(
    () => ({
      submit: ({ message, type }) => {
        if (!key) return
        const next = { ...votes, [message.id]: type }
        setCurrent({ key, votes: next })
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          toast.error(t("auiFeedbackSaveFailed"))
        }
      }
    }),
    [key, t, votes]
  )
  const ratedMessages = useMemo(
    () =>
      messages.map((message) => {
        const type = votes[message.id]
        return type && message.role === "assistant"
          ? {
              ...message,
              metadata: {
                ...(message.metadata as Record<string, unknown> | undefined),
                submittedFeedback: { type }
              }
            }
          : message
      }),
    [messages, votes]
  )
  return { messages: ratedMessages, feedback }
}
