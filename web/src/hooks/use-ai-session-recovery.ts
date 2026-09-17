import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai"
import type { SessionView } from "@/lib/ai-agent-types"
import { AIStreamConnectionError, isRecoverableAIStreamError } from "@/lib/ai-agent/stream-transport"

export function isSessionView(value: unknown): value is SessionView {
  if (!value || typeof value !== "object") return false
  const session = value as Partial<SessionView>
  return typeof session.id === "string" && Array.isArray(session.messages)
    && Array.isArray(session.tasks) && Array.isArray(session.ui_messages)
}

export function useAISessionRecovery({
  sessionId, revision, enabled, transport, onSnapshot, onError,
}: {
  sessionId: string | null
  revision: number
  enabled: boolean
  transport: ChatTransport<UIMessage>
  onSnapshot: (session: SessionView) => void
  onError: (message: string) => void
}) {
  const [connection, setConnection] = useState<{ sessionId: string; reconnecting: boolean } | null>(null)
  const callbacks = useRef({ onSnapshot, onError })
  const controllerRef = useRef<AbortController | null>(null)
  useEffect(() => { callbacks.current = { onSnapshot, onError } }, [onSnapshot, onError])

  useEffect(() => {
    if (!enabled || !sessionId) return
    const lifetime = new AbortController()
    controllerRef.current = lifetime
    let wake: (() => void) | undefined
    const online = () => wake?.()
    window.addEventListener("online", online)
    lifetime.signal.addEventListener("abort", online)

    const wait = (delay: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(finish, delay)
      function finish() {
        clearTimeout(timer)
        wake = undefined
        resolve()
      }
      wake = finish
      if (lifetime.signal.aborted) finish()
    })

    const recover = async () => {
      let attempt = 0
      let providerError: string | undefined
      while (!lifetime.signal.aborted) {
        setConnection({ sessionId, reconnecting: true })
        if (attempt > 0 || !navigator.onLine) {
          await wait(Math.min(1000 * 2 ** Math.min(attempt, 4), 15_000) + Math.random() * 250)
        }
        if (lifetime.signal.aborted) return
        if (!navigator.onLine) continue
        let reader: ReadableStreamDefaultReader<UIMessageChunk> | undefined
        try {
          const stream = await transport.reconnectToStream({ chatId: sessionId, abortSignal: lifetime.signal })
          if (!stream) throw new AIStreamConnectionError()
          reader = stream.getReader()
          while (!lifetime.signal.aborted) {
            const { value: chunk, done } = await reader.read()
            if (lifetime.signal.aborted) return
            if (done) throw new AIStreamConnectionError()
            if (chunk.type === "error") {
              providerError = chunk.errorText
              continue
            }
            if (chunk.type !== "data-session-snapshot" || !isSessionView(chunk.data) || chunk.data.id !== sessionId) continue
            attempt = 0
            setConnection({ sessionId, reconnecting: false })
            callbacks.current.onSnapshot(chunk.data)
            if (chunk.data.status !== "running") {
              if (providerError) callbacks.current.onError(providerError)
              return
            }
          }
        } catch (error) {
          if (lifetime.signal.aborted) return
          if (!isRecoverableAIStreamError(error)) {
            setConnection(null)
            callbacks.current.onError(error instanceof Error ? error.message : String(error))
            return
          }
          attempt++
        } finally {
          await reader?.cancel().catch(() => {})
        }
      }
    }
    void recover()
    return () => {
      lifetime.abort()
      window.removeEventListener("online", online)
      lifetime.signal.removeEventListener("abort", online)
      if (controllerRef.current === lifetime) controllerRef.current = null
    }
  }, [enabled, revision, sessionId, transport])

  const stopRecovery = useCallback(() => controllerRef.current?.abort(), [])
  return {
    reconnecting: enabled && connection?.sessionId === sessionId && connection.reconnecting,
    stopRecovery,
  }
}
